"""Socket.IO server: token-authenticated, per-company rooms, emit helpers."""
import logging
import socketio

from app.core.db import database, companies, user_sessions

log = logging.getLogger("realtime")
sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", socketio_path="socket.io")


async def _company_for_token(token: str | None):
    if not token:
        return None
    comp = await database.fetch_one(companies.select().where(companies.c.session_token == token))
    if comp:
        return str(comp["company_id"])
    us = await database.fetch_one(user_sessions.select().where(user_sessions.c.token == token))
    return str(us["company_id"]) if us else None


@sio.event
async def connect(sid, environ, auth):
    token = (auth or {}).get("token") or (auth or {}).get("session_token")
    company_id = await _company_for_token(token)
    if not company_id:
        await sio.emit("error", {"message": "authentication required"}, room=sid)
        return False
    await sio.save_session(sid, {"company_id": company_id})
    await sio.enter_room(sid, str(company_id))
    log.info("socket %s joined company %s", sid, company_id)
    # Deferred import avoids a circular dependency with attendance.service.
    from app.modules.attendance import service as att
    await sio.emit("initial_attendance_data", await att.list_attendance(company_id), room=sid)
    await sio.emit("attendance_statistics_update", await att.stats(company_id), room=sid)


@sio.event
async def disconnect(sid):
    log.info("socket %s disconnected", sid)


async def emit_new_entry(company_id, entry):
    await sio.emit("new_attendance_entry", entry, room=str(company_id))


async def emit_stats(company_id, payload):
    await sio.emit("attendance_statistics_update", payload, room=str(company_id))

"""Attendance HTTP routes."""
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.db import database, companies, user_sessions
from app.core.config import settings
from app.core.deps import Principal, get_principal, require
from app.modules.attendance import service
from app.modules.erp import service as erp
from app.modules.realtime import socket as rt
from app.modules.audit import service as audit

log = logging.getLogger("attendance.router")
router = APIRouter(prefix="/api/attendance", tags=["attendance"])


class EntryIn(BaseModel):
    emp_id: str
    first_name: str = ""
    last_name: str = ""
    check_type: str = "in"
    image_url: str | None = None
    image_b64: str | None = None   # live face snapshot (proof-of-presence)


async def _company_from_auth(authorization: str | None) -> str:
    """Resolve company for the webhook: accepts api_key OR a session token."""
    token = authorization.split(" ", 1)[1].strip() if authorization and " " in (authorization or "") else None
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    for column in (companies.c.api_key, companies.c.session_token):
        row = await database.fetch_one(select(companies.c.company_id).where(column == token))
        if row:
            return str(row["company_id"])
    us = await database.fetch_one(select(user_sessions.c.company_id).where(user_sessions.c.token == token))
    if us:
        return str(us["company_id"])
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token / api key")


@router.post("/entry", status_code=status.HTTP_201_CREATED)
async def create_entry(payload: EntryIn, authorization: str | None = Header(default=None)):
    """Webhook from the recognition pipeline (api-key auth)."""
    company_id = await _company_from_auth(authorization)
    row = await service.add_entry(company_id, payload.emp_id, payload.first_name,
                                  payload.last_name, payload.check_type, payload.image_url,
                                  payload.image_b64)
    if not row:
        return {"status": "skipped"}
    client_entry = service.prepare_entry(row, company_id)
    await rt.emit_new_entry(company_id, client_entry)
    await rt.emit_stats(company_id, await service.stats(company_id))
    ok, resp = await erp.push_record(row, company_id)
    if ok:
        await erp.mark_sent(row["id"], resp)
    return {"status": "ok", "entry": client_entry, "erp_synced": ok}


@router.get("")
async def list_entries(p: Principal = Depends(get_principal)):
    return await service.list_attendance(p.company_id)


@router.get("/stats")
async def get_stats(p: Principal = Depends(get_principal)):
    return await service.stats(p.company_id)


@router.get("/hourly")
async def get_hourly(p: Principal = Depends(get_principal)):
    return await service.hourly_today(p.company_id)


@router.delete("")
async def clear_entries(p: Principal = Depends(require("manage_attendance"))):
    await service.clear(p.company_id)
    await rt.emit_stats(p.company_id, await service.stats(p.company_id))
    await audit.record(p.company_id, p.actor, p.role, "attendance.clear")
    return {"status": "cleared"}

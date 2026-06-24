"""Audit trail — records security/admin actions for compliance."""
import logging
import datetime

from app.core.db import database, audit_log

log = logging.getLogger("audit")


async def record(company_id, actor, role, action, detail=None, ip=None):
    """Best-effort: never let auditing break the underlying action."""
    try:
        await database.execute(audit_log.insert().values(
            company_id=str(company_id), actor=actor, role=role, action=action,
            detail=(str(detail)[:500] if detail else None), ip=ip,
            created_at=datetime.datetime.now()))
    except Exception as e:
        log.warning("audit record failed (%s): %s", action, e)


async def list_events(company_id, limit=200):
    rows = await database.fetch_all(
        audit_log.select().where(audit_log.c.company_id == company_id)
        .order_by(audit_log.c.id.desc()).limit(limit))
    return [{
        "id": r["id"], "actor": r["actor"], "role": r["role"], "action": r["action"],
        "detail": r["detail"], "ip": r["ip"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]

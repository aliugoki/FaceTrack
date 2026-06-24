"""ERP integration — push attendance records to a tenant's external API."""
import json
import logging
import datetime

import httpx
from sqlalchemy import select, update

from app.core.config import settings
from app.core.db import database, companies, attendance

log = logging.getLogger("erp")


async def push_record(record: dict, company_id: str):
    """Send one attendance record to the company's configured ERP endpoint."""
    cfg = await database.fetch_one(
        select(companies.c.attendance_api, companies.c.api_key).where(companies.c.company_id == company_id))
    if not cfg or not cfg["attendance_api"] or not cfg["api_key"]:
        return False, "ERP not configured"

    def _iso(v):
        return v.isoformat() if isinstance(v, (datetime.datetime, datetime.date, datetime.time)) else v

    payload = {
        "emp_id": str(record.get("emp_id")),
        "first_name": record.get("first_name"),
        "last_name": record.get("last_name"),
        "check_type": record.get("check_type"),
        "attendance_time": _iso(record.get("attendance_time")),
        "attendance_date": _iso(record.get("attendance_date")),
    }
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=float(settings.EXTERNAL_SYNC_TIMEOUT)) as client:
            resp = await client.post(cfg["attendance_api"], json=payload, headers=headers)
            resp.raise_for_status()
            try:
                return True, resp.json()
            except json.JSONDecodeError:
                return True, resp.text
    except httpx.HTTPStatusError as e:
        return False, f"HTTP {e.response.status_code}"
    except Exception as e:
        return False, f"{e.__class__.__name__}"


async def status(company_id: str) -> dict:
    cfg = await database.fetch_one(
        select(companies.c.attendance_api, companies.c.api_key).where(companies.c.company_id == company_id))
    today = datetime.date.today()
    recs = await database.fetch_all(select(attendance.c.sent_to_webhook).where(
        (attendance.c.company_id == company_id) & (attendance.c.attendance_date >= today)))
    sent = sum(1 for r in recs if r["sent_to_webhook"])
    return {
        "configured": bool(cfg and cfg["attendance_api"] and cfg["api_key"]),
        "url": cfg["attendance_api"] if cfg else None,
        "sent_today": sent, "pending_today": len(recs) - sent, "realtime": True,
    }


async def resync_pending(company_id: str) -> dict:
    rows = await database.fetch_all(attendance.select().where(
        (attendance.c.company_id == company_id)
        & ((attendance.c.sent_to_webhook == False) | (attendance.c.sent_to_webhook.is_(None)))))  # noqa: E712
    ok = 0
    for r in rows:
        rec = dict(r)
        success, resp = await push_record(rec, company_id)
        if success:
            await database.execute(update(attendance).where(attendance.c.id == rec["id"])
                                   .values(sent_to_webhook=True, webhook_response=str(resp)[:500]))
            ok += 1
    return {"resynced": ok, "attempted": len(rows)}


async def mark_sent(record_id: int, resp):
    await database.execute(update(attendance).where(attendance.c.id == record_id)
                           .values(sent_to_webhook=True, webhook_response=str(resp)[:500]))

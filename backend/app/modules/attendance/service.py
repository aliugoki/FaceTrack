"""Attendance business logic (DB + ERP + realtime side-effects live here)."""
import os
import base64
import datetime
import logging
from uuid import UUID
from urllib.parse import urlparse

from sqlalchemy import select, delete

from app.core.config import settings
from app.core.db import database, attendance, user_data

log = logging.getLogger("attendance")


def prepare_entry(entry: dict, company_id: str) -> dict:
    """Serialize a DB row for the client + resolve the image URL."""
    out = dict(entry)
    for k, v in out.items():
        if isinstance(v, UUID):
            out[k] = str(v)
        elif isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
            out[k] = v.isoformat()
    img = out.get("image_url")
    if not img:
        out["image_url"] = None
    elif img.startswith("/api/"):          # live capture (already a served path)
        out["image_url"] = img
    else:                                   # legacy: enrolled gallery photo basename
        out["image_url"] = f"/api/images/{company_id}/{os.path.basename(img)}"
    return out


def save_capture(company_id: str, emp_id: str, image_b64: str) -> str | None:
    """Decode a base64 face snapshot to disk; return its served URL."""
    try:
        if "," in image_b64:                # strip data URL prefix if present
            image_b64 = image_b64.split(",", 1)[1]
        raw = base64.b64decode(image_b64)
        day = datetime.date.today().isoformat()
        rel_dir = os.path.join(company_id, day)
        abs_dir = os.path.join(settings.CAPTURES_DIR, rel_dir)
        os.makedirs(abs_dir, exist_ok=True)
        fname = f"{emp_id}_{datetime.datetime.now().strftime('%H%M%S_%f')}.jpg"
        with open(os.path.join(abs_dir, fname), "wb") as f:
            f.write(raw)
        return f"/api/captures/{rel_dir}/{fname}"
    except Exception as e:
        log.warning("capture save failed: %s", e)
        return None


async def list_attendance(company_id: str) -> list[dict]:
    rows = await database.fetch_all(
        attendance.select().where(attendance.c.company_id == company_id)
        .order_by(attendance.c.attendance_date.desc(), attendance.c.attendance_time.desc()))
    return [prepare_entry(dict(r), company_id) for r in rows]


async def _distinct_in(company_id, **extra):
    today = datetime.date.today()
    cond = ((attendance.c.company_id == company_id) & (attendance.c.check_type == "in")
            & (attendance.c.attendance_date >= today))
    for col, val in extra.items():
        cond &= (getattr(attendance.c, col) == val)
    rows = await database.fetch_all(select(attendance.c.emp_id).distinct().where(cond))
    return len(rows)


async def stats(company_id: str) -> dict:
    reg = await database.fetch_all(select(user_data.c.user_id).where(user_data.c.company_id == company_id))
    return {
        "total_present_today": await _distinct_in(company_id),
        "total_on_time_today": await _distinct_in(company_id, status="On Time"),
        "total_late_today": await _distinct_in(company_id, status="Late"),
        "total_registered_employees": len(reg),
    }


async def hourly_today(company_id: str) -> dict:
    today = datetime.date.today()
    rows = await database.fetch_all(
        select(attendance.c.attendance_time, attendance.c.check_type).where(
            (attendance.c.company_id == company_id) & (attendance.c.attendance_date >= today)))
    b = {h: {"in": 0, "out": 0} for h in range(24)}
    for r in rows:
        t = r["attendance_time"]
        if isinstance(t, datetime.datetime):
            ct = (r["check_type"] or "in").lower()
            if ct in ("in", "out"):
                b[t.hour][ct] += 1
    return {"hours": list(range(24)), "in": [b[h]["in"] for h in range(24)], "out": [b[h]["out"] for h in range(24)]}


async def clear(company_id: str):
    await database.execute(delete(attendance).where(attendance.c.company_id == company_id))


async def add_entry(company_id: str, emp_id: str, first_name: str, last_name: str,
                    check_type: str, image_url: str | None = None,
                    image_b64: str | None = None) -> dict | None:
    """Insert an in/out event (idempotent for same-day check-in).

    If `image_b64` (a live face snapshot from the pipeline) is provided it is
    stored as proof-of-presence and used as the record image; otherwise we fall
    back to the enrolled gallery photo basename.
    """
    now = datetime.datetime.now()
    if image_b64:
        img = save_capture(company_id, str(emp_id), image_b64) or (
            os.path.basename(urlparse(image_url).path) if image_url else None)
    else:
        img = os.path.basename(urlparse(image_url).path) if image_url else None
    ct = (check_type or "in").lower()

    if ct == "in":
        dup = await database.fetch_one(select(attendance.c.id).where(
            (attendance.c.company_id == company_id) & (attendance.c.check_type == "in")
            & (attendance.c.attendance_date >= now.date()) & (attendance.c.emp_id == str(emp_id))))
        if dup:
            return None
        # On-time cutoff = tenant policy start_time + grace (configurable in Settings)
        from app.modules.settings import service as policy_svc
        cutoff = await policy_svc.late_threshold(company_id)
        status_v = "On Time" if now.time() <= cutoff else "Late"
        values = dict(company_id=company_id, emp_id=str(emp_id), first_name=first_name,
                      last_name=last_name, attendance_time=now, attendance_date=now.date(),
                      check_type="in", image_url=img, status=status_v)
    elif ct == "out":
        open_in = await database.fetch_one(
            select(attendance.c.id, attendance.c.attendance_time).where(
                (attendance.c.company_id == company_id) & (attendance.c.check_type == "in")
                & (attendance.c.check_in_id.is_(None)) & (attendance.c.emp_id == str(emp_id)))
            .order_by(attendance.c.attendance_time.desc()).limit(1))
        if not open_in:
            return None
        # Checkout status from tenant policy: Present / Left Early / Half Day / Overtime.
        from app.modules.settings import service as policy_svc
        policy = await policy_svc.get_settings(company_id)
        check_in_dt = open_in["attendance_time"]
        if isinstance(check_in_dt, datetime.time):
            check_in_dt = datetime.datetime.combine(now.date(), check_in_dt)
        status_v, _worked = policy_svc.classify_checkout(check_in_dt, now, policy)
        values = dict(company_id=company_id, emp_id=str(emp_id), first_name=first_name,
                      last_name=last_name, attendance_time=now, attendance_date=now.date(),
                      check_type="out", check_in_id=open_in["id"], image_url=img, status=status_v)
    else:
        return None

    new_id = await database.execute(attendance.insert().values(**values))
    row = await database.fetch_one(attendance.select().where(attendance.c.id == new_id))
    return dict(row) if row else None

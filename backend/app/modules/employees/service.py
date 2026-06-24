"""Employee directory + per-employee attendance card / calendar."""
import os
import datetime
import calendar as _cal

from sqlalchemy import select

from app.core.db import database, user_data, attendance


def _photo(company_id, image_path):
    return f"/api/images/{company_id}/{os.path.basename(image_path)}" if image_path else None


async def _present_today(company_id):
    today = datetime.date.today()
    rows = await database.fetch_all(select(attendance.c.emp_id).distinct().where(
        (attendance.c.company_id == company_id) & (attendance.c.check_type == "in")
        & (attendance.c.attendance_date >= today)))
    return {r["emp_id"] for r in rows}


async def list_employees(company_id):
    rows = await database.fetch_all(
        user_data.select().where(user_data.c.company_id == company_id).order_by(user_data.c.first_name))
    present = await _present_today(company_id)
    return [{
        "emp_id": str(r["emp_id"]), "first_name": r["first_name"], "last_name": r["last_name"],
        "photo": _photo(company_id, r["image_path"]), "present": str(r["emp_id"]) in present,
    } for r in rows]


async def employee_card(company_id, emp_id, year, month):
    first = datetime.date(year, month, 1)
    last = datetime.date(year, month, _cal.monthrange(year, month)[1])
    prof = await database.fetch_one(user_data.select().where(
        (user_data.c.company_id == company_id) & (user_data.c.emp_id == str(emp_id))))
    name, photo = str(emp_id), None
    if prof:
        name = f"{prof['first_name']} {prof['last_name']}".strip() or str(emp_id)
        photo = _photo(company_id, prof["image_path"])

    rows = await database.fetch_all(attendance.select().where(
        (attendance.c.company_id == company_id) & (attendance.c.emp_id == str(emp_id))
        & (attendance.c.attendance_date >= first) & (attendance.c.attendance_date <= last))
        .order_by(attendance.c.attendance_time))
    days = {}
    for r in rows:
        ds = str(r["attendance_date"])[:10]
        ct = (r["check_type"] or "").lower()
        t = r["attendance_time"]
        ts = t.strftime("%H:%M") if isinstance(t, datetime.datetime) else None
        d = days.setdefault(ds, {"status": None, "in_time": None, "out_time": None})
        if ct == "in":
            d["in_time"] = d["in_time"] or ts
            d["status"] = "late" if r["status"] == "Late" else "on_time"
        elif ct == "out":
            d["out_time"] = ts
            if d["status"] is None:
                d["status"] = "present"
    present = sorted(k for k, v in days.items() if v["status"])
    today = datetime.date.today()
    end = min(last, today)
    elapsed = sum(1 for n in range((end - first).days + 1)
                  if (first + datetime.timedelta(days=n)).weekday() < 5) if end >= first else 0
    return {
        "emp_id": str(emp_id), "name": name, "photo": photo, "month": f"{year:04d}-{month:02d}",
        "summary": {
            "present": len(present),
            "on_time": sum(1 for v in days.values() if v["status"] == "on_time"),
            "late": sum(1 for v in days.values() if v["status"] == "late"),
            "attendance_pct": round(100 * len(present) / elapsed) if elapsed else 0,
            "working_days": elapsed,
            "first_seen": present[0] if present else None,
            "last_seen": present[-1] if present else None,
        },
        "days": days,
    }

"""Per-tenant attendance policy + holiday calendar."""
import datetime

from sqlalchemy import select, delete

from app.core.db import database, tenant_settings, holidays

DEFAULTS = {"start_time": "09:00", "grace_minutes": 0, "workdays": "1,2,3,4,5", "timezone": "Asia/Karachi"}


async def get_settings(company_id):
    row = await database.fetch_one(tenant_settings.select().where(tenant_settings.c.company_id == company_id))
    if not row:
        return {"company_id": company_id, **DEFAULTS}
    return {"company_id": company_id, "start_time": row["start_time"], "grace_minutes": row["grace_minutes"],
            "workdays": row["workdays"], "timezone": row["timezone"]}


async def update_settings(company_id, data):
    vals = {k: data[k] for k in ("start_time", "grace_minutes", "workdays", "timezone") if k in data and data[k] is not None}
    vals["updated_at"] = datetime.datetime.now()
    exists = await database.fetch_one(select(tenant_settings.c.company_id).where(tenant_settings.c.company_id == company_id))
    if exists:
        await database.execute(tenant_settings.update().where(tenant_settings.c.company_id == company_id).values(**vals))
    else:
        await database.execute(tenant_settings.insert().values(company_id=company_id, **{**DEFAULTS, **vals}))
    return await get_settings(company_id)


async def list_holidays(company_id):
    rows = await database.fetch_all(holidays.select().where(holidays.c.company_id == company_id).order_by(holidays.c.day))
    return [{"id": r["id"], "day": str(r["day"]), "name": r["name"]} for r in rows]


async def add_holiday(company_id, day, name):
    await database.execute(holidays.insert().values(company_id=company_id, day=day, name=name))


async def del_holiday(company_id, hid):
    await database.execute(delete(holidays).where((holidays.c.id == hid) & (holidays.c.company_id == company_id)))


async def late_threshold(company_id) -> datetime.time:
    """Effective on-time cutoff = start_time + grace, for the late/on-time decision."""
    s = await get_settings(company_id)
    try:
        h, m = (int(x) for x in s["start_time"].split(":")[:2])
        base = datetime.datetime.combine(datetime.date.today(), datetime.time(h, m))
        cutoff = (base + datetime.timedelta(minutes=int(s["grace_minutes"] or 0))).time()
        return cutoff
    except Exception:
        return datetime.time(9, 0)

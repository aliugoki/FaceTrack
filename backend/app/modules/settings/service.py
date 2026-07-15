"""Per-tenant attendance policy + holiday calendar + status classification."""
import datetime

from sqlalchemy import select, delete

from app.core.db import database, tenant_settings, holidays

# recordings_retention_days: NULL = MediaMTX default (48h), 0 = keep forever, N = N days.
DEFAULTS = {
    "start_time": "09:00", "end_time": "18:00",
    "break_start": None, "break_end": None,
    "grace_minutes": 0, "early_leave_grace_minutes": 0,
    "half_day_after_minutes": 240, "min_work_minutes": 0,
    "overtime_after_minutes": 0,          # 0 = overtime disabled
    "workdays": "1,2,3,4,5", "timezone": "Asia/Karachi",
    "recordings_retention_days": None,
    # Face-recognition tuning (applied to the pipeline on next (re)launch).
    "rec_threshold": 0.35, "rec_margin": 0.05, "rec_min_votes": 3,
}
FIELDS = tuple(DEFAULTS.keys())


async def get_settings(company_id):
    row = await database.fetch_one(
        tenant_settings.select().where(tenant_settings.c.company_id == company_id))
    if not row:
        return {"company_id": company_id, **DEFAULTS}
    return {"company_id": company_id, **{k: row[k] for k in FIELDS}}


async def update_settings(company_id, data):
    vals = {k: data[k] for k in FIELDS if k in data}
    vals["updated_at"] = datetime.datetime.now()
    exists = await database.fetch_one(
        select(tenant_settings.c.company_id).where(tenant_settings.c.company_id == company_id))
    if exists:
        await database.execute(tenant_settings.update()
                               .where(tenant_settings.c.company_id == company_id).values(**vals))
    else:
        await database.execute(tenant_settings.insert().values(
            company_id=company_id, **{**DEFAULTS, **vals}))
    return await get_settings(company_id)


async def list_holidays(company_id):
    rows = await database.fetch_all(
        holidays.select().where(holidays.c.company_id == company_id).order_by(holidays.c.day))
    return [{"id": r["id"], "day": str(r["day"]), "name": r["name"]} for r in rows]


async def add_holiday(company_id, day, name):
    await database.execute(holidays.insert().values(company_id=company_id, day=day, name=name))


async def del_holiday(company_id, hid):
    await database.execute(delete(holidays).where((holidays.c.id == hid) & (holidays.c.company_id == company_id)))


# --------------------------------------------------------------------------- #
# Status classification helpers (shared by attendance + reports)
# --------------------------------------------------------------------------- #
def _hhmm(s) -> datetime.time | None:
    """Parse 'HH:MM' -> time, or None."""
    try:
        h, m = (int(x) for x in str(s).split(":")[:2])
        return datetime.time(h, m)
    except Exception:
        return None


def _mins(t: datetime.time | None) -> int | None:
    return t.hour * 60 + t.minute if t else None


def _out_minutes(check_in: datetime.datetime, check_out: datetime.datetime) -> tuple[int, int]:
    """Minute-of-day for check-in and check-out, unwrapping a single midnight crossing."""
    in_m = check_in.hour * 60 + check_in.minute
    out_m = check_out.hour * 60 + check_out.minute
    if out_m < in_m:
        out_m += 24 * 60
    return in_m, out_m


def worked_minutes(check_in, check_out, policy) -> int:
    """Minutes worked between two datetimes, minus overlap with the unpaid break window."""
    if not check_in or not check_out or check_out <= check_in:
        return 0
    in_m, out_m = _out_minutes(check_in, check_out)
    gross = out_m - in_m
    bs, be = _mins(_hhmm(policy.get("break_start"))), _mins(_hhmm(policy.get("break_end")))
    if bs is not None and be is not None and be > bs:
        gross -= max(0, min(out_m, be) - max(in_m, bs))   # subtract break overlap
    return max(0, gross)


def classify_checkout(check_in, check_out, policy) -> tuple[str, int]:
    """Return (status, worked_minutes) for a checkout event.

    Priority: Half Day (too short) -> Left Early (before shift end) -> Overtime
    (worked beyond the scheduled day) -> Present. Late is decided at check-in.
    """
    worked = worked_minutes(check_in, check_out, policy)
    half = int(policy.get("half_day_after_minutes") or 0)
    if half and worked < half:
        return "Half Day", worked
    end = _mins(_hhmm(policy.get("end_time")))
    if end is not None:
        _, out_m = _out_minutes(check_in, check_out)
        if out_m < end - int(policy.get("early_leave_grace_minutes") or 0):
            return "Left Early", worked
    ot = int(policy.get("overtime_after_minutes") or 0)
    start_t, end_t = _hhmm(policy.get("start_time")), _hhmm(policy.get("end_time"))
    if ot and start_t and end_t:
        d = check_in.date()
        scheduled = worked_minutes(datetime.datetime.combine(d, start_t),
                                   datetime.datetime.combine(d, end_t), policy)
        if worked >= scheduled + ot:
            return "Overtime", worked
    return "Present", worked


async def late_threshold(company_id) -> datetime.time:
    """Effective on-time cutoff = start_time + grace, for the late/on-time decision."""
    s = await get_settings(company_id)
    try:
        h, m = (int(x) for x in s["start_time"].split(":")[:2])
        base = datetime.datetime.combine(datetime.date.today(), datetime.time(h, m))
        return (base + datetime.timedelta(minutes=int(s["grace_minutes"] or 0))).time()
    except Exception:
        return datetime.time(9, 0)

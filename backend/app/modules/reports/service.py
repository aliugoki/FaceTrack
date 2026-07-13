"""Reporting engine — date-range attendance analytics."""
import datetime

from sqlalchemy import select

from app.core.db import database, attendance, user_data
from app.modules.settings import service as policy_svc


async def build_report(company_id, d_from, d_to):
    rows = await database.fetch_all(attendance.select().where(
        (attendance.c.company_id == company_id)
        & (attendance.c.attendance_date >= d_from) & (attendance.c.attendance_date <= d_to)))
    roster = await database.fetch_all(
        select(user_data.c.emp_id, user_data.c.first_name, user_data.c.last_name)
        .where(user_data.c.company_id == company_id))
    names = {str(r["emp_id"]): f"{r['first_name']} {r['last_name']}".strip() for r in roster}
    policy = await policy_svc.get_settings(company_id)
    min_work = int(policy.get("min_work_minutes") or 0)

    # Index check-ins by id so checkout rows can pair back for worked-minutes.
    in_by_id = {r["id"]: r for r in rows if (r["check_type"] or "").lower() == "in"}

    def _dt(v, ds):
        if isinstance(v, datetime.time):
            return datetime.datetime.combine(datetime.date.fromisoformat(ds), v)
        return v

    by_day, by_emp, work_days, first_in = {}, {}, set(), []
    total_in = total_out = on_time = late = 0
    left_early = half_days = overtime = total_worked = 0
    for r in rows:
        emp = str(r["emp_id"])
        ds = str(r["attendance_date"])[:10]
        ct = (r["check_type"] or "").lower()
        st = r["status"] or ""
        dd = by_day.setdefault(ds, {"present": set(), "on_time": set(), "late": set()})
        ee = by_emp.setdefault(emp, {"name": names.get(emp, emp), "days": set(), "on_time": 0,
                                     "late": 0, "worked_min": 0, "full_days": 0, "last_seen": None})
        if ct == "in":
            total_in += 1
            work_days.add(ds); dd["present"].add(emp); ee["days"].add(ds)
            t = r["attendance_time"]
            if isinstance(t, datetime.datetime):
                first_in.append(t.hour * 3600 + t.minute * 60 + t.second)
            if st == "Late":
                late += 1; dd["late"].add(emp); ee["late"] += 1
            else:
                on_time += 1; dd["on_time"].add(emp); ee["on_time"] += 1
        elif ct == "out":
            total_out += 1
            if st == "Left Early":
                left_early += 1
            elif st == "Half Day":
                half_days += 1
            elif st == "Overtime":
                overtime += 1
            parent = in_by_id.get(r["check_in_id"])
            if parent is not None:
                w = policy_svc.worked_minutes(_dt(parent["attendance_time"], ds),
                                              _dt(r["attendance_time"], ds), policy)
                total_worked += w; ee["worked_min"] += w
                if not min_work or w >= min_work:
                    ee["full_days"] += 1
        ts = r["attendance_time"]
        ts = ts.isoformat() if isinstance(ts, (datetime.datetime, datetime.date)) else ts
        if ts and (ee["last_seen"] is None or ts > ee["last_seen"]):
            ee["last_seen"] = ts

    ndays = max(len(work_days), 1)
    by_emp_out = sorted(
        [{"emp_id": k, "name": v["name"], "days_present": len(v["days"]), "on_time": v["on_time"],
          "late": v["late"], "worked_hours": round(v["worked_min"] / 60, 1), "full_days": v["full_days"],
          "last_seen": v["last_seen"], "attendance_pct": round(100 * len(v["days"]) / ndays)}
         for k, v in by_emp.items()],
        key=lambda x: (-x["days_present"], x["name"]))
    avg = int(sum(first_in) / len(first_in)) if first_in else None
    return {
        "from": str(d_from), "to": str(d_to),
        "summary": {
            "working_days": len(work_days), "total_checkins": total_in, "total_checkouts": total_out,
            "unique_present": len(by_emp), "roster": len(names), "on_time": on_time, "late": late,
            "left_early": left_early, "half_days": half_days, "overtime": overtime,
            "total_worked_hours": round(total_worked / 60, 1),
            "avg_worked_hours": round((total_worked / 60) / max(total_out, 1), 1),
            "avg_first_in": f"{avg//3600:02d}:{(avg%3600)//60:02d}" if avg is not None else "—",
        },
        "by_day": [{"date": k, "present": len(v["present"]), "on_time": len(v["on_time"]), "late": len(v["late"])}
                   for k, v in sorted(by_day.items())],
        "by_employee": by_emp_out,
    }

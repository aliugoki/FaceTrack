"""Reporting engine — date-range attendance analytics."""
import datetime

from sqlalchemy import select

from app.core.db import database, attendance, user_data


async def build_report(company_id, d_from, d_to):
    rows = await database.fetch_all(attendance.select().where(
        (attendance.c.company_id == company_id)
        & (attendance.c.attendance_date >= d_from) & (attendance.c.attendance_date <= d_to)))
    roster = await database.fetch_all(
        select(user_data.c.emp_id, user_data.c.first_name, user_data.c.last_name)
        .where(user_data.c.company_id == company_id))
    names = {str(r["emp_id"]): f"{r['first_name']} {r['last_name']}".strip() for r in roster}

    by_day, by_emp, work_days, first_in = {}, {}, set(), []
    total_in = total_out = on_time = late = 0
    for r in rows:
        emp = str(r["emp_id"])
        ds = str(r["attendance_date"])[:10]
        ct = (r["check_type"] or "").lower()
        st = r["status"] or ""
        dd = by_day.setdefault(ds, {"present": set(), "on_time": set(), "late": set()})
        ee = by_emp.setdefault(emp, {"name": names.get(emp, emp), "days": set(), "on_time": 0, "late": 0, "last_seen": None})
        if ct == "in":
            total_in += 1
            work_days.add(ds)
            dd["present"].add(emp)
            ee["days"].add(ds)
            t = r["attendance_time"]
            if isinstance(t, datetime.datetime):
                first_in.append(t.hour * 3600 + t.minute * 60 + t.second)
            if st == "Late":
                late += 1; dd["late"].add(emp); ee["late"] += 1
            else:
                on_time += 1; dd["on_time"].add(emp); ee["on_time"] += 1
        elif ct == "out":
            total_out += 1
        ts = r["attendance_time"]
        ts = ts.isoformat() if isinstance(ts, (datetime.datetime, datetime.date)) else ts
        if ts and (ee["last_seen"] is None or ts > ee["last_seen"]):
            ee["last_seen"] = ts

    ndays = max(len(work_days), 1)
    by_emp_out = sorted(
        [{"emp_id": k, "name": v["name"], "days_present": len(v["days"]), "on_time": v["on_time"],
          "late": v["late"], "last_seen": v["last_seen"], "attendance_pct": round(100 * len(v["days"]) / ndays)}
         for k, v in by_emp.items()],
        key=lambda x: (-x["days_present"], x["name"]))
    avg = int(sum(first_in) / len(first_in)) if first_in else None
    return {
        "from": str(d_from), "to": str(d_to),
        "summary": {
            "working_days": len(work_days), "total_checkins": total_in, "total_checkouts": total_out,
            "unique_present": len(by_emp), "roster": len(names), "on_time": on_time, "late": late,
            "avg_first_in": f"{avg//3600:02d}:{(avg%3600)//60:02d}" if avg is not None else "—",
        },
        "by_day": [{"date": k, "present": len(v["present"]), "on_time": len(v["on_time"]), "late": len(v["late"])}
                   for k, v in sorted(by_day.items())],
        "by_employee": by_emp_out,
    }

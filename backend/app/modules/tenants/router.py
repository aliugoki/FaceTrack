"""Cross-tenant overview (super-admin via view_tenants permission)."""
from fastapi import APIRouter, Depends

from app.core.db import database, companies
from app.core.deps import Principal, require
from app.modules.attendance import service as att

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


@router.get("")
async def list_tenants(p: Principal = Depends(require("view_tenants"))):
    rows = await database.fetch_all(companies.select())
    out = []
    for r in rows:
        cid = str(r["company_id"])
        s = await att.stats(cid)
        out.append({
            "company_id": cid, "company_name": r["company_name"], "status": r["status"],
            "present_today": s["total_present_today"], "on_time_today": s["total_on_time_today"],
            "late_today": s["total_late_today"], "registered": s["total_registered_employees"],
        })
    out.sort(key=lambda x: (x["company_name"] or "").lower())
    return out

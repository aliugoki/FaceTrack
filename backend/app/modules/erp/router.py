"""ERP integration routes."""
from fastapi import APIRouter, Depends

from app.core.deps import Principal, get_principal, require
from app.modules.erp import service
from app.modules.audit import service as audit

router = APIRouter(prefix="/api/erp", tags=["erp"])


@router.get("")
async def erp_status(p: Principal = Depends(get_principal)):
    data = await service.status(p.company_id)
    data["can_manage"] = "manage_attendance" in p.permissions
    return data


@router.post("/resync")
async def erp_resync(p: Principal = Depends(require("manage_attendance"))):
    result = await service.resync_pending(p.company_id)
    await audit.record(p.company_id, p.actor, p.role, "erp.resync", f"{result['resynced']}/{result['attempted']}")
    return result

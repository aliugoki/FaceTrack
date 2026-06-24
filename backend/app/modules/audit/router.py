"""Audit log routes (view_audit permission)."""
from fastapi import APIRouter, Depends, Query

from app.core.deps import Principal, require
from app.modules.audit import service

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
async def list_audit(limit: int = Query(200, le=1000), p: Principal = Depends(require("view_audit"))):
    return await service.list_events(p.company_id, limit)

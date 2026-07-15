"""Company management routes — super-admin (view_tenants / manage_tenants)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import Principal, require
from app.modules.companies import service
from app.modules.pipeline import service as pipeline_service
from app.modules.audit import service as audit

router = APIRouter(prefix="/api/companies", tags=["companies"])


class CompanyIn(BaseModel):
    company_name: str
    admin_username: str
    password: str
    image_folder: str | None = None
    webrtc_url: str | None = None
    attendance_api: str | None = None


class CompanyUpdate(BaseModel):
    company_name: str | None = None
    status: str | None = None
    webrtc_url: str | None = None
    image_folder: str | None = None
    attendance_api: str | None = None


class PasswordIn(BaseModel):
    password: str


@router.get("")
async def list_companies(p: Principal = Depends(require("view_tenants"))):
    return await service.list_companies()


@router.post("")
async def create_company(body: CompanyIn, p: Principal = Depends(require("manage_tenants"))):
    if len(body.password) < 6:
        raise HTTPException(400, "password must be >= 6 chars")
    if await service.username_taken(body.admin_username):
        raise HTTPException(409, "admin_username already taken")
    out = await service.create_company(body.company_name, body.admin_username, body.password,
                                       body.image_folder, body.webrtc_url, body.attendance_api)
    await audit.record(p.company_id, p.actor, p.role, "company.create", body.company_name)
    return out


@router.put("/{cid}")
async def update_company(cid: str, body: CompanyUpdate, p: Principal = Depends(require("manage_tenants"))):
    await service.update_company(cid, body.model_dump(exclude_none=True))
    await audit.record(p.company_id, p.actor, p.role, "company.update", cid)
    return {"status": "ok"}


@router.delete("/{cid}")
async def delete_company(cid: str, p: Principal = Depends(require("manage_tenants"))):
    if str(cid) == str(p.company_id):
        raise HTTPException(400, "cannot delete the company you are signed in as")
    out = await service.delete_company(cid)
    if not out:
        raise HTTPException(404, "company not found")
    await audit.record(p.company_id, p.actor, p.role, "company.delete", f"{cid} ({out['admin_username']})")
    # Best-effort: stop any running pipeline for the removed tenant (its container
    # would otherwise keep running and posting to a now-missing company).
    try:
        await pipeline_service.enqueue_stop(out["admin_username"], cid)
    except Exception:
        pass
    return {"status": "deleted", "admin_username": out["admin_username"],
            "image_folder": out["image_folder"]}


@router.post("/{cid}/rotate-key")
async def rotate_key(cid: str, p: Principal = Depends(require("manage_tenants"))):
    out = await service.rotate_api_key(cid)
    await audit.record(p.company_id, p.actor, p.role, "company.rotate_key", cid)
    return out


@router.post("/{cid}/password")
async def set_password(cid: str, body: PasswordIn, p: Principal = Depends(require("manage_tenants"))):
    if len(body.password) < 6:
        raise HTTPException(400, "password must be >= 6 chars")
    await service.set_password(cid, body.password)
    await audit.record(p.company_id, p.actor, p.role, "company.set_password", cid)
    return {"status": "ok"}

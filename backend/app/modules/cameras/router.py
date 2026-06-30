"""Camera routes — read for all (view), manage gated by manage_cameras."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.deps import Principal, get_principal, require
from app.modules.cameras import service
from app.modules.audit import service as audit

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraIn(BaseModel):
    name: str
    location: str | None = None
    type: str = "entrance"
    rtsp_url: str | None = None
    hls_url: str | None = None
    webrtc_url: str | None = None
    enabled: bool = True


@router.get("")
async def list_cameras(p: Principal = Depends(get_principal)):
    return await service.list_cameras(p.company_id)


@router.get("/live")
async def list_live_cameras(p: Principal = Depends(get_principal)):
    """Live Wall feed — fleet-wide for super-admins, own-company otherwise."""
    return await service.list_live_cameras(p)


@router.post("")
async def create_camera(body: CameraIn, p: Principal = Depends(require("manage_cameras"))):
    cid = await service.create(p.company_id, body.model_dump())
    await audit.record(p.company_id, p.actor, p.role, "camera.create", body.name)
    return {"status": "ok", "id": cid}


@router.put("/{cid}")
async def update_camera(cid: int, body: CameraIn, p: Principal = Depends(require("manage_cameras"))):
    await service.update(p.company_id, cid, body.model_dump())
    await audit.record(p.company_id, p.actor, p.role, "camera.update", body.name)
    return {"status": "ok"}


@router.delete("/{cid}")
async def delete_camera(cid: int, p: Principal = Depends(require("manage_cameras"))):
    await service.remove(p.company_id, cid)
    await audit.record(p.company_id, p.actor, p.role, "camera.delete", str(cid))
    return {"status": "ok"}

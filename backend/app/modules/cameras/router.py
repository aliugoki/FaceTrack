"""Camera routes — read for all (view), manage gated by manage_cameras."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.deps import Principal, get_principal, require
from app.modules.cameras import service
from app.modules.pipeline import service as pipeline_service
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
    detection_area: list | None = None   # polygon [[x,y],...] normalized 0..1
    # NVR access (Hikvision) — for gap backfill when the live stream drops.
    nvr_host: str | None = None
    nvr_port: int | None = None
    nvr_user: str | None = None
    nvr_password: str | None = None
    nvr_channel: int | None = None


class AreaIn(BaseModel):
    detection_area: list   # polygon [[x,y],...] normalized 0..1; [] clears it


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


@router.put("/{cid}/area")
async def set_detection_area(cid: int, body: AreaIn,
                            p: Principal = Depends(require("manage_cameras"))):
    """Save just the per-camera detection zone (drawn in the dashboard). Send an
    empty list to clear it (whole frame). Takes effect on the next pipeline (re)start."""
    await service.update(p.company_id, cid, {"detection_area": body.detection_area})
    await audit.record(p.company_id, p.actor, p.role, "camera.area",
                       f"{cid} points={len(body.detection_area)}")
    # Auto-apply: if this company's pipeline is running, queue a restart so the
    # new zone takes effect without a manual Restart on the Pipeline page.
    job = await pipeline_service.enqueue_restart_on_change(p.company_id)
    return {"status": "ok", "restart_queued": bool(job)}


@router.delete("/{cid}")
async def delete_camera(cid: int, p: Principal = Depends(require("manage_cameras"))):
    await service.remove(p.company_id, cid)
    await audit.record(p.company_id, p.actor, p.role, "camera.delete", str(cid))
    return {"status": "ok"}

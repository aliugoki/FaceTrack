"""Pipeline control panel API — provisioning + live ops (status/health/lifecycle).

Safe by design: the dashboard NEVER runs docker. It (a) generates config text it
owns the data for, (b) reads live health straight off each pipeline's /healthz
(host networking), and (c) enqueues bounded start/stop/restart jobs that the
token-holding host agent executes and reports back on (plus a GPU/container
heartbeat). See service.py for the status/health logic.
"""
import datetime

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel

from app.core.db import database, cameras, companies, pipeline_jobs
from app.core.deps import Principal, require
from app.modules.audit import service as audit
from app.modules.pipeline import service

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])

ACTIONS = ("start", "stop", "restart")


class LaunchIn(BaseModel):
    company: str            # target company admin_username
    action: str = "start"   # start | stop | restart
    index: int = 0


def _toml(company_name, admin_username, cams, index):
    n = max(len(cams), 1)
    rtsp = 8555 + index
    health = 9108 + index
    lines = [
        f"# Generated for {company_name} ({admin_username}) — pipeline config",
        "[pipeline]",
        "display = 1",                       # render annotated output on the host's local monitor
        f"num_sources = {n}",
        f"muxer_batch_size = {n}",
        "rec_threshold = 0.35",
        "rec_margin = 0.05",
        'known_face_dir = "/workspace/data/known_faces"',
        f"health_port = {health}",
        "",
        "[streammux]",
        "gpu_id = 0",
        f"batch-size = {n}",
        "width = 1280", "height = 720", "live-source = 1",
        "nvbuf-memory-type = 0", "batched-push-timeout = 40000",
        "",
        "[nvosd]", "process-mode = 0", "display-text = 1",
        "",
        '[pgie]', 'config-file-path = "/workspace/config/config_yolo.txt"',
        '[sgie]', 'config-file-path = "/workspace/config/config_arcface.txt"',
        '[tracker]', 'config-file-path = "/workspace/config/config_tracker_perf.txt"',
        "",
        "[tiler]", "width = 1280", "height = 720",
        "",
        # One annotated RTSP mount per camera (/cam0, /cam1, …) on this company's
        # RTSP port; MediaMTX pulls each into a {admin_username}_cam{i} path for
        # browser HLS/WebRTC. udpsink ports are offset by index to avoid collisions
        # between concurrently-running company pipelines.
        "[rtsp_server]",
        "enable_rtsp_streaming = true",
        f"port = {rtsp}", 'codec = "H264"', 'udpsink-host = "127.0.0.1"',
        "mount-points = [" + ", ".join(f'"/cam{i}"' for i in range(n)) + "]",
        "udpsink-ports = [" + ", ".join(str(5400 + index * 16 + i) for i in range(n)) + "]",
        "",
    ]
    for c in cams:
        uri = (c["rtsp_url"] or "").replace('"', "")
        lines += ["[[sources]]", f'id = "{c["name"]}"', f'uri = "{uri}"',
                  f'type = "{c["type"] or "general"}"', "num-retry = 5",
                  "rtsp-reconnect-interval-sec = 10", "latency = 200", ""]
    return "\n".join(lines), rtsp, health


async def _resolve_company(admin_username: str):
    row = await database.fetch_one(
        companies.select().where(companies.c.admin_username == admin_username))
    if not row:
        raise HTTPException(404, "company not found")
    return row


# --------------------------------------------------------------------------- #
# Live ops — status / health / agent (super-admin reads)
# --------------------------------------------------------------------------- #
@router.get("/status")
async def status(p: Principal = Depends(require("manage_tenants"))):
    """Whole-fleet status: per-company state + agent/GPU summary."""
    return await service.fleet_status()


@router.get("/health/{index}")
async def health(index: int, p: Principal = Depends(require("manage_tenants"))):
    """Detailed live health for one pipeline (per-source frame flow)."""
    if index < 0 or index > 50:
        raise HTTPException(400, "index out of range")
    return await service.fetch_health(index)


@router.get("/agent")
async def agent(p: Principal = Depends(require("manage_tenants"))):
    """Host-agent heartbeat: online?, GPU telemetry, container list."""
    return await service.agent_state()


# --------------------------------------------------------------------------- #
# Provisioning — generate config + command (super-admin)
# --------------------------------------------------------------------------- #
@router.get("/provision")
async def provision(company: str = Query(..., description="target company admin_username"),
                    index: int = Query(0, ge=0, le=50),
                    p: Principal = Depends(require("manage_tenants"))):
    row = await _resolve_company(company)
    cid = str(row["company_id"])
    cams = await database.fetch_all(
        cameras.select().where((cameras.c.company_id == cid) & (cameras.c.enabled == True)  # noqa: E712
                               & (cameras.c.rtsp_url.isnot(None)) & (cameras.c.rtsp_url != ""))
        .order_by(cameras.c.name))
    cam_list = [{"name": c["name"], "type": c["type"], "rtsp_url": c["rtsp_url"]} for c in cams]
    config, rtsp, hport = _toml(row["company_name"], company, cam_list, index)
    return {
        "company": row["company_name"], "admin_username": company,
        "camera_count": len(cam_list), "index": index,
        "rtsp_port": rtsp, "health_port": hport,
        "config_filename": f"{company}.toml",
        "config": config,
        "launch_command": f"./tools/run_company_pipeline.sh {company} {index}",
    }


# --------------------------------------------------------------------------- #
# Lifecycle — enqueue start/stop/restart for the host agent (super-admin)
# --------------------------------------------------------------------------- #
@router.post("/launch")
async def launch(body: LaunchIn, p: Principal = Depends(require("manage_tenants"))):
    if body.action not in ACTIONS:
        raise HTTPException(400, f"action must be one of {ACTIONS}")
    row = await _resolve_company(body.company)
    now = datetime.datetime.now()
    jid = await database.execute(pipeline_jobs.insert().values(
        company_id=str(row["company_id"]), username=body.company, action=body.action,
        idx=body.index, status="pending", created_at=now, updated_at=now))
    await audit.record(p.company_id, p.actor, p.role, f"pipeline.{body.action}",
                       f"{body.company} index={body.index}")
    return {"job_id": jid, "status": "pending"}


@router.get("/jobs")
async def jobs(p: Principal = Depends(require("manage_tenants"))):
    rows = await database.fetch_all(
        pipeline_jobs.select().order_by(pipeline_jobs.c.id.desc()).limit(30))
    return [{"id": r["id"], "company": r["username"], "action": r["action"], "index": r["idx"],
             "status": r["status"], "log": r["log"],
             "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None}
            for r in rows]


# --------------------------------------------------------------------------- #
# Host-agent endpoints — token-authed, NOT user endpoints
# --------------------------------------------------------------------------- #
def _agent_ok(token: str) -> bool:
    from app.core.config import settings
    return bool(settings.AGENT_TOKEN) and token == settings.AGENT_TOKEN


@router.get("/agent/jobs")
async def agent_jobs(token: str = ""):
    """Host agent polls pending jobs."""
    if not _agent_ok(token):
        raise HTTPException(403, "invalid agent token")
    rows = await database.fetch_all(
        pipeline_jobs.select().where(pipeline_jobs.c.status == "pending").order_by(pipeline_jobs.c.id))
    return [{"id": r["id"], "username": r["username"], "action": r["action"], "index": r["idx"]} for r in rows]


class AgentUpdate(BaseModel):
    token: str
    status: str
    log: str | None = None


@router.post("/agent/jobs/{jid}")
async def agent_update(jid: int, body: AgentUpdate):
    if not _agent_ok(body.token):
        raise HTTPException(403, "invalid agent token")
    await database.execute(pipeline_jobs.update().where(pipeline_jobs.c.id == jid)
                           .values(status=body.status, log=(body.log or "")[:2000],
                                   updated_at=datetime.datetime.now()))
    return {"status": "ok"}


class Heartbeat(BaseModel):
    token: str
    containers: list = []
    gpus: list = []


@router.post("/agent/heartbeat")
async def agent_heartbeat(body: Heartbeat):
    """Host agent pushes container + GPU telemetry (every few seconds)."""
    if not _agent_ok(body.token):
        raise HTTPException(403, "invalid agent token")
    await service.save_heartbeat(body.containers, body.gpus)
    return {"status": "ok"}

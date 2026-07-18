"""Pipeline control panel API — provisioning + live ops (status/health/lifecycle).

Safe by design: the dashboard NEVER runs docker. It (a) generates config text it
owns the data for, (b) reads live health straight off each pipeline's /healthz
(host networking), and (c) enqueues bounded start/stop/restart jobs that the
token-holding host agent executes and reports back on (plus a GPU/container
heartbeat). See service.py for the status/health logic.
"""
import asyncio
import datetime
import json
import os
import re
import shutil
import uuid

from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import and_

from app.core.config import settings
from app.core.db import database, cameras, companies, pipeline_jobs, stream_gaps
from app.core.deps import Principal, require
from app.modules.audit import service as audit
from app.modules.pipeline import service
from app.modules.pipeline import nvr

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
                    p: Principal = Depends(require("manage_tenants"))):
    row = await _resolve_company(company)
    cid = str(row["company_id"])
    # Index is assigned by the server (unique per company) — not caller-chosen — so
    # ports never collide between companies. See service.company_index.
    index = await service.company_index(row["company_id"])
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
    # Server-assigned unique slot — ignore any caller-supplied index so two
    # companies can never be launched onto the same ports.
    idx = await service.company_index(row["company_id"])
    now = datetime.datetime.now()
    jid = await database.execute(pipeline_jobs.insert().values(
        company_id=str(row["company_id"]), username=body.company, action=body.action,
        idx=idx, status="pending", created_at=now, updated_at=now))
    await audit.record(p.company_id, p.actor, p.role, f"pipeline.{body.action}",
                       f"{body.company} index={idx}")
    return {"job_id": jid, "status": "pending", "index": idx}


@router.get("/jobs")
async def jobs(p: Principal = Depends(require("manage_tenants"))):
    rows = await database.fetch_all(
        pipeline_jobs.select().order_by(pipeline_jobs.c.id.desc()).limit(30))
    return [{"id": r["id"], "company": r["username"], "action": r["action"], "index": r["idx"],
             "status": r["status"], "log": r["log"],
             "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None}
            for r in rows]


# --------------------------------------------------------------------------- #
# Backfill / stream gaps — high-speed offline reprocessing (super-admin)
#
# The heavy lifting already exists: the gap monitor + the host agent's
# run_backfill.sh pull the missed window from the NVR and reprocess it
# UNTHROTTLED (file source, live-source=0) with correct timestamps. These
# endpoints just surface the gap ledger and let an operator queue a backfill on
# demand — for a detected outage window or any custom range.
# --------------------------------------------------------------------------- #
def _dur(a, b):
    return (b - a).total_seconds() if a and b else None


@router.get("/gaps")
async def list_gaps(company: str | None = Query(None, description="filter by company admin_username"),
                    status: str | None = Query(None, description="open|queued|done|failed|skipped"),
                    limit: int = Query(50, ge=1, le=200),
                    p: Principal = Depends(require("manage_tenants"))):
    """Recent detected stream gaps (+ manual backfills), newest first."""
    conds = []
    if company:
        row = await _resolve_company(company)
        conds.append(stream_gaps.c.company_id == str(row["company_id"]))
    if status:
        conds.append(stream_gaps.c.status == status)
    q = stream_gaps.select()
    if conds:
        q = q.where(and_(*conds))
    rows = await database.fetch_all(q.order_by(stream_gaps.c.id.desc()).limit(limit))
    comps = {str(c["company_id"]): c for c in await database.fetch_all(companies.select())}
    out = []
    for r in rows:
        c = comps.get(str(r["company_id"]))
        out.append({
            "id": r["id"], "company_id": r["company_id"],
            "company": c["company_name"] if c else r["company_id"],
            "admin_username": c["admin_username"] if c else None,
            "camera_id": r["camera_id"], "camera_name": r["camera_name"],
            "started_at": r["started_at"].isoformat() if r["started_at"] else None,
            "ended_at": r["ended_at"].isoformat() if r["ended_at"] else None,
            "duration_sec": _dur(r["started_at"], r["ended_at"]),
            "status": r["status"],
        })
    return out


@router.get("/cameras")
async def backfill_cameras(company: str = Query(..., description="company admin_username"),
                           p: Principal = Depends(require("manage_tenants"))):
    """Cameras for a company + whether each has NVR creds (required to backfill)."""
    row = await _resolve_company(company)
    rows = await database.fetch_all(
        cameras.select().where(cameras.c.company_id == str(row["company_id"]))
        .order_by(cameras.c.name))
    return [{"id": c["id"], "name": c["name"],
             "nvr_configured": bool(c["nvr_host"] and c["nvr_channel"])} for c in rows]


class BackfillIn(BaseModel):
    camera_id: int
    start: datetime.datetime
    end: datetime.datetime


@router.post("/backfill")
async def backfill(body: BackfillIn, p: Principal = Depends(require("manage_tenants"))):
    """Manually queue an NVR backfill for a camera + window (offline high-speed reprocess)."""
    if body.end <= body.start:
        raise HTTPException(400, "end must be after start")
    if (body.end - body.start).total_seconds() > 12 * 3600:
        raise HTTPException(400, "window too large (max 12h per backfill job)")
    # Reject future windows: the NVR can't have recorded them, and the gap would
    # otherwise be marked done over an empty fetch (misleading). Small skew allowed.
    now = datetime.datetime.now()
    if body.start > now + datetime.timedelta(minutes=1):
        raise HTTPException(400, "start is in the future — no footage to reprocess")
    if body.end > now + datetime.timedelta(minutes=1):
        raise HTTPException(400, "end is in the future — clamp it to now")
    cam = await database.fetch_one(cameras.select().where(cameras.c.id == body.camera_id))
    if not cam:
        raise HTTPException(404, "camera not found")
    if not (cam["nvr_host"] and cam["nvr_channel"]):
        raise HTTPException(400, "camera has no NVR configured — cannot backfill")
    cid = str(cam["company_id"])
    comp = await database.fetch_one(
        companies.select().where(companies.c.company_id == cam["company_id"]))
    now = datetime.datetime.now()
    gap_id = await database.execute(stream_gaps.insert().values(
        company_id=cid, camera_id=cam["id"], camera_name=cam["name"],
        started_at=body.start, ended_at=body.end, status="queued", created_at=now))
    payload = json.dumps({
        "gap_id": gap_id, "camera_id": cam["id"], "camera_name": cam["name"],
        "channel": cam["nvr_channel"], "start": body.start.isoformat(),
        "end": body.end.isoformat(), "manual": True,
    })
    jid = await database.execute(pipeline_jobs.insert().values(
        company_id=cid, username=comp["admin_username"] if comp else "",
        action="backfill", idx=await service.company_index(cam["company_id"]),
        status="pending", payload=payload, created_at=now, updated_at=now))
    await audit.record(p.company_id, p.actor, p.role, "pipeline.backfill",
                       f'{cam["name"]} [{body.start.isoformat()} -> {body.end.isoformat()}]')
    return {"job_id": jid, "gap_id": gap_id, "status": "pending"}


# Uploaded-clip reprocessing — the file lands in CAPTURES_DIR/backfill_uploads, which
# is bind-mounted to the host so the pipeline agent can mount it into DeepStream and
# reprocess it unthrottled (run_backfill_file.sh). Attendance is stamped from clip_start.
UPLOAD_SUBDIR = "backfill_uploads"
_ALLOWED_EXT = {".mp4", ".mkv", ".avi", ".mov", ".m4v", ".ts", ".h264"}
_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB


async def _queue_clip_reprocess(company_row, fname, label, clip_start, camera_id, size=None):
    """Insert the gap + job rows for a clip sitting in backfill_uploads.

    Shared by the file-upload and the reprocess-a-recording flows so both emit the
    IDENTICAL job payload the host agent already knows how to run
    (run_backfill_file.sh): file source, live-source=0, attendance stamped from
    clip_start. Returns (job_id, gap_id).
    """
    cid = str(company_row["company_id"])
    now = datetime.datetime.now()
    gap_id = await database.execute(stream_gaps.insert().values(
        company_id=cid, camera_id=camera_id, camera_name=f"upload:{label}",
        started_at=clip_start, ended_at=None, status="queued", created_at=now))
    payload = json.dumps({
        "gap_id": gap_id, "upload": True, "filename": fname,
        "clip_start": clip_start.isoformat(), "camera_id": camera_id, "manual": True,
    })
    jid = await database.execute(pipeline_jobs.insert().values(
        company_id=cid, username=company_row["admin_username"], action="backfill",
        idx=await service.company_index(company_row["company_id"]),
        status="pending", payload=payload, created_at=now, updated_at=now))
    return jid, gap_id


@router.post("/backfill/upload")
async def backfill_upload(
    file: UploadFile = File(...),
    company: str = Form(..., description="company admin_username"),
    clip_start: datetime.datetime = Form(..., description="real-world time the footage begins"),
    camera_id: int | None = Form(None),
    p: Principal = Depends(require("manage_tenants")),
):
    """Upload a recorded clip and queue a high-speed offline reprocess (no NVR needed)."""
    row = await _resolve_company(company)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(400, f"unsupported type '{ext}' (allowed: {sorted(_ALLOWED_EXT)})")
    up_dir = os.path.join(settings.CAPTURES_DIR, UPLOAD_SUBDIR)
    os.makedirs(up_dir, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(file.filename or f"clip{ext}"))
    fname = f"{uuid.uuid4().hex}_{safe}"
    dest = os.path.join(up_dir, fname)
    size = 0
    try:
        with open(dest, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "file too large (max 2 GB)")
                out.write(chunk)
    except Exception:
        if os.path.exists(dest):
            os.remove(dest)
        raise
    jid, gap_id = await _queue_clip_reprocess(row, fname, safe, clip_start, camera_id, size)
    await audit.record(p.company_id, p.actor, p.role, "pipeline.backfill_upload",
                       f"{company} {safe} ({size}B) clip_start={clip_start.isoformat()}")
    return {"job_id": jid, "gap_id": gap_id, "status": "pending", "filename": fname, "bytes": size}


class ReprocessRecordingIn(BaseModel):
    path: str                       # recording path relative to RECORDINGS_DIR
    company: str                    # target company admin_username
    clip_start: datetime.datetime   # real-world time the footage begins
    camera_id: int | None = None


@router.post("/backfill/recording")
async def backfill_recording(body: ReprocessRecordingIn,
                             p: Principal = Depends(require("manage_tenants"))):
    """Run inference on an existing MediaMTX recording — no re-upload.

    RECORDINGS_DIR is mounted read-only, so we copy the (path-safe) recording into
    backfill_uploads (which the host agent already mounts) and queue it exactly
    like an uploaded clip. Attendance is stamped from clip_start.
    """
    row = await _resolve_company(body.company)
    # Path-safety: resolve within RECORDINGS_DIR (mirrors main.recording_file).
    base = os.path.realpath(settings.RECORDINGS_DIR)
    src = os.path.realpath(os.path.join(base, body.path))
    if not src.startswith(base + os.sep) or not os.path.isfile(src):
        raise HTTPException(404, "recording not found")
    ext = os.path.splitext(src)[1].lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(400, f"unsupported type '{ext}' (allowed: {sorted(_ALLOWED_EXT)})")
    up_dir = os.path.join(settings.CAPTURES_DIR, UPLOAD_SUBDIR)
    os.makedirs(up_dir, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(src))
    fname = f"{uuid.uuid4().hex}_{safe}"
    dest = os.path.join(up_dir, fname)
    try:
        # Off-thread: recordings can be large; don't block the event loop.
        await asyncio.to_thread(shutil.copyfile, src, dest)
    except OSError as e:
        if os.path.exists(dest):
            os.remove(dest)
        raise HTTPException(500, f"could not stage recording: {e}")
    jid, gap_id = await _queue_clip_reprocess(row, fname, safe, body.clip_start, body.camera_id)
    await audit.record(p.company_id, p.actor, p.role, "pipeline.backfill_recording",
                       f"{body.company} {body.path} clip_start={body.clip_start.isoformat()}")
    return {"job_id": jid, "gap_id": gap_id, "status": "pending", "filename": fname}


# --------------------------------------------------------------------------- #
# NVR footage — browse recorded segments + on-demand RTSP->HLS playback proxy
# (super-admin). Search hits the camera's ISAPI; playback registers an on-demand
# MediaMTX path so the recorded window can be watched in the browser. "Send to
# inference" reuses POST /backfill above for the chosen window.
# --------------------------------------------------------------------------- #
async def _nvr_camera(camera_id: int):
    cam = await database.fetch_one(cameras.select().where(cameras.c.id == camera_id))
    if not cam:
        raise HTTPException(404, "camera not found")
    if not nvr.has_nvr(cam):
        raise HTTPException(400, "camera has no NVR configured")
    return cam


@router.get("/nvr/recordings")
async def nvr_recordings(camera_id: int = Query(...),
                         start: datetime.datetime = Query(...),
                         end: datetime.datetime = Query(...),
                         p: Principal = Depends(require("manage_tenants"))):
    """Recorded segments the NVR holds for a camera + window (via ISAPI search)."""
    if end <= start:
        raise HTTPException(400, "end must be after start")
    cam = await _nvr_camera(camera_id)
    try:
        segments = await nvr.search_recordings(cam, start, end)
        return {"searched": True, "segments": segments}
    except Exception as e:
        # Search is device/firmware-specific — surface the error but still let the
        # UI play / send-to-inference the raw requested window.
        return {"searched": False, "error": str(e), "segments": []}


class NvrPlayIn(BaseModel):
    camera_id: int
    start: datetime.datetime
    end: datetime.datetime


@router.post("/nvr/play")
async def nvr_play(body: NvrPlayIn, p: Principal = Depends(require("manage_tenants"))):
    """Register an on-demand MediaMTX path for a recorded window; returns its name.

    The browser plays it as HLS (``/{path}/index.m3u8`` on the HLS gateway).
    """
    if body.end <= body.start:
        raise HTTPException(400, "end must be after start")
    if (body.end - body.start).total_seconds() > 6 * 3600:
        raise HTTPException(400, "playback window too large (max 6h)")
    cam = await _nvr_camera(body.camera_id)
    try:
        name = await nvr.ensure_play_path(cam, body.start, body.end)
    except Exception as e:
        raise HTTPException(502, f"could not start NVR playback: {e}")
    return {"path": name}


@router.delete("/nvr/play/{name}")
async def nvr_play_stop(name: str, p: Principal = Depends(require("manage_tenants"))):
    """Tear down a playback path when the viewer is done (idle-close backs this up)."""
    await nvr.remove_play_path(name)
    return {"status": "ok"}


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
    return [{"id": r["id"], "username": r["username"], "action": r["action"], "index": r["idx"],
             "payload": r["payload"]} for r in rows]


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

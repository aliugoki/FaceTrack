# System Architecture

FaceTrack is one product built from **two repositories** — a web control plane and
a GPU vision engine — that communicate through a shared PostgreSQL database, a job
queue drained by a host agent, and an attendance webhook. This document describes
both halves and how they fit together. (For deploying it, see
[`DEPLOYMENT.md`](./DEPLOYMENT.md); for the DeepStream repo's internal file map,
see `ARCHITECTURE.md` in that repo.)

```
FaceTrack (dashboard)  ──enqueue start/stop/restart──►  pipeline_jobs (Postgres)
                                                              │ polled by
                                  tools/pipeline_agent.py (DeepStream host agent)
                                                              │ docker run
                                        deepstream-<company>  (main_enterprise.py, GPU)
                                                              │ recognizes a face
                       POST /api/attendance/entry ◄───────────┘  (webhook, company API key)
                              │
                       FaceTrack writes attendance1  ──►  live feed / reports / ERP sync
```

**The web app never runs Docker.** It only enqueues bounded jobs and reads a
heartbeat; the host-side agent (holding `AGENT_TOKEN`) is the only component that
runs Docker and touches the GPU.

---

## Repo 1 — FaceTrack (`aliugoki/FaceTrack`, this repo) — control plane

The web application: **FastAPI backend + React frontend, served single-origin on
`:5002`, containerized.**

```
backend/app/
  core/         config · db (async Postgres tables) · security (RBAC) · deps (auth)
  modules/      one folder per domain (router → service → db):
    auth attendance employees enrollment cameras companies pipeline
    reports erp users tenants audit settings realtime recordings
  main.py       app factory: routers + Socket.IO + serves the built SPA
frontend/src/   React + Vite + TS + Tailwind (pages · components · context · lib)
Dockerfile      multi-stage: build React → serve from FastAPI (single origin)
docker-compose.yml
deploy/         production deploy kit (scripts + systemd units)  — see DEPLOYMENT.md
infra/nginx/    TLS reverse-proxy vhost
```

Key module responsibilities:

| Module | Responsibility |
|---|---|
| `auth` / `users` / `tenants` | login, RBAC (`super_admin · admin · manager · viewer`), multi-tenancy |
| `enrollment` | capture/upload a face → **aligned ArcFace** embedding → gallery `.npy` + `user_data` |
| `employees` | employee directory + per-employee attendance |
| `cameras` | per-company camera CRUD (RTSP + playback), per-camera detection zone |
| `companies` | super-admin tenant management, API keys |
| `pipeline` | provision config + enqueue start/stop/restart jobs for the agent; read heartbeat |
| `attendance` | **receives recognition webhooks**, records attendance |
| `realtime` | Socket.IO live feed |
| `reports` / `erp` / `audit` / `settings` | analytics, ERP push, audit log, policy |

**Role:** everything a human interacts with — auth, tenant/camera management,
enrollment, live monitoring, reporting, ERP sync, audit — plus *recording*
attendance from pipeline webhooks.

---

## Repo 2 — DeepStream (`aliugoki/DeepStream`) — GPU recognition pipeline

The NVIDIA DeepStream face-recognition engine, run **one container per company** on
the GPU host. A large repo with many experimental variants; the canonical live path
is:

```
main_enterprise.py         production pipeline entry point
utils/
  probe_enterprise.py      recognition probe (YOLO-face landmarks → align → ArcFace → match)
  recognition.py           gallery match + threshold/margin + per-track voting
  arcface_embedder.py      ArcFace embedder (ONNX + TensorRT; interchangeable)
  face_align.py            Umeyama alignment + letterbox math
  db_service.py            attendance webhook + pooled DB writes
  reliability.py           RTSP reconnect, bus watchdog, health
tools/
  pipeline_agent.py        host agent: drains pipeline_jobs, runs Docker, pushes heartbeat
  run_company_pipeline.sh  launches a company's container (mounts gallery + generated config)
  enroll.py                offline aligned gallery enrollment
  gen_company_config.py    generates config/companies/<user>.toml from DB cameras
config/                    model + tracker configs; config/companies/*.toml (per company)
models/                    YOLO-face, ArcFace, res10, YuNet weights (ONNX / TensorRT)
```

> The many other `main_*.py` (`main_git`, `main_iaa`, `main_kafka`, `main_udp`,
> `merged_main`, …) and legacy `probe_*.py` are historical/experimental — not used
> by the live path. See that repo's own `ARCHITECTURE.md` for the canonical vs.
> legacy file map.

**Pipeline flow (per frame):** nvstreammux muxes each company's camera RTSP streams
→ YOLO-face PGIE detects faces + 5 landmarks → tracker → `probe_enterprise` aligns
each face (landmarks inverse-letterboxed to **muxer** resolution) and embeds it with
ArcFace → matched against that company's gallery (cosine ≥ threshold, top-1/top-2
margin, stabilized by per-track voting) → on a committed identity inside the
camera's detection zone, POSTs to FaceTrack's attendance webhook. Also streams to
MediaMTX for the live video wall.

**Role:** ingest cameras, recognize enrolled faces on the GPU, report recognitions.

---

## The connective tissue

Three shared touchpoints bind the two repos:

1. **PostgreSQL `facial_recognition_db`** — shared by both: `companies`, `cameras`,
   `user_data` (employees), `pipeline_jobs` (the job queue), `attendance1` (records).
2. **The face gallery on disk** — `COMPANY_IMAGES_ROOT/<company_folder>/` holds each
   employee's `<id>.png` + `<id>.npy` (512-d ArcFace embedding) + `gallery_meta.json`.
   FaceTrack enrollment *writes* it; the pipeline container *mounts* it read-write and
   loads it into memory at startup (a restart is required to pick up new enrollments —
   FaceTrack auto-queues that restart).
3. **`AGENT_TOKEN`** — the shared secret the host agent uses to poll jobs and push
   heartbeats to FaceTrack, plus each company's **API key** used as the bearer token
   on the attendance webhook.

### Ports

| Port | Component |
|---|---|
| `443` / `80` | nginx (public HTTPS) |
| `5002` | FaceTrack dashboard (uvicorn, behind nginx) |
| `5432` | PostgreSQL |
| `9108 + idx` | per-pipeline health (`/healthz`) |
| `8555 + idx` | per-pipeline RTSP out → MediaMTX |
| `8554 / 8888 / 8889` | MediaMTX RTSP / HLS / WebRTC |

Each company is assigned a unique 0-based slot (its position in the name-ordered
company list) so its pipeline's ports never collide with another tenant's.

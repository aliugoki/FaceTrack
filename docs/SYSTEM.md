# FaceTrack — Complete System Documentation

Face-recognition attendance + live video platform. This document explains the
whole system end to end: what each piece does, how data flows, where things live
on disk and in the database, and how to operate it.

It spans **two repositories** under `/home/meta/deploy`:

| Repo | Role |
|------|------|
| `attendance-system` | The web app — FastAPI backend + React dashboard, multi-tenant, attendance/enrollment/reporting + the **pipeline control panel**. |
| `deepstream` | The GPU video pipeline — DeepStream/GStreamer that ingests camera RTSP, detects + recognizes faces, draws overlays, re-publishes annotated RTSP, and POSTs attendance events back to the web app. |

A third moving part, **MediaMTX** (a Docker container), is the media gateway that
turns the pipeline's RTSP into browser-friendly HLS/WebRTC and records video.

---

## 1. High-level architecture

```
                    ┌──────────────────────────────────────────────────────────┐
   IP cameras       │                     GPU host (this machine)               │
   (RTSP, LAN)      │                                                           │
        │           │   ┌───────────────┐         ┌────────────────────────┐    │
        ├──────────────▶│  deepstream-  │  RTSP   │       MediaMTX         │    │
        │           │   │  <company>    │────────▶│  (Docker, host net)    │    │
        │           │   │  container    │ :8555+N │  HLS :8888 WebRTC :8889│    │
        │           │   │  (DeepStream) │         │  records → /opt/...    │    │
        │           │   └──────┬────────┘         └───────────┬────────────┘    │
        │           │          │ attendance POST              │ HLS/WebRTC      │
        │           │          │ /api/attendance/entry        │                 │
        │           │   ┌──────▼────────────────┐             │                 │
        │           │   │  attendance-system    │             │                 │
        │           │   │  container (FastAPI + │◀────────────┘ browser pulls   │
        │           │   │  React, host net :5002│   streams directly            │
        │           │   └──────┬────────────────┘                               │
        │           │          │ SQL                                            │
        │           │   ┌──────▼────────────────┐   ┌────────────────────────┐  │
        │           │   │ Postgres (HOST svc)   │   │ pipeline_agent.py      │  │
        │           │   │ facial_recognition_db │   │ (host agent, systemd)  │  │
        │           │   │ :5432                 │◀──│ polls jobs, runs docker│  │
        │           │   └───────────────────────┘   └────────────────────────┘  │
        │           └──────────────────────────────────────────────────────────┘
        ▼
   browser (dashboard + live wall)
```

**Key design rule: the web app never runs Docker.** The dashboard only (a) reads
data, (b) reads pipeline health straight off each pipeline's `/healthz`, and (c)
**enqueues** start/stop/restart jobs. A separate host-side agent
(`pipeline_agent.py`) holds the privileges to run Docker and executes those jobs.
This keeps the Docker socket off the web app.

### Components

| Component | Where | Port(s) | Notes |
|-----------|-------|---------|-------|
| Dashboard backend + frontend | `attendance-system` container, `network_mode: host` | `5002` | FastAPI + Socket.IO; serves the built React SPA |
| Postgres | **host service** (not Docker) | `5432` | DB `facial_recognition_db` |
| DeepStream pipeline | `deepstream-<company>` container, host net, `--gpus all` | RTSP `8555+N`, health `9108+N` | one container per company |
| MediaMTX | `mediamtx` container, host net | HLS `8888`, WebRTC `8889`/ICE `8000`/`8189`, RTSP `8554` | config `/home/meta/deploy/mediamtx.yml` |
| Host pipeline agent | host process / systemd `pipeline-agent.service` | — | runs Docker on the dashboard's behalf |

---

## 2. Database — where it is and how it's created

- **Engine:** PostgreSQL running as a **host service** (`localhost:5432`), *not* in a
  container. The dashboard container uses host networking specifically so it can
  reach host Postgres and the pipeline health ports.
- **Database name:** `facial_recognition_db`. Connection string is env-only via
  `DATABASE_URL` (`backend/app/core/config.py`), set in `backend/.env`. The backend
  connects with async SQLAlchemy Core (`databases` + `asyncpg`), **no ORM**
  (`backend/app/core/db.py`).
- **How schema is created:** there are **no migrations** (no Alembic, no `.sql`).
  - The "legacy" tables — **`companies`, `attendance_logs`, `user_data`** — pre-exist
    in `facial_recognition_db` (the DB predates this dashboard; the dashboard
    operates over the existing database).
  - The newer RBAC/ops tables are created idempotently at **every startup** by
    `connect_and_init()` running `CREATE TABLE IF NOT EXISTS` (`db.py`,
    invoked from the FastAPI lifespan in `app/main.py`). `metadata.create_all` is
    never called.

### Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `companies` | Tenants | `company_id` (UUID), `company_name`, `admin_username`, `admin_password_hash`, `company_image_folder`, `api_key` (per-tenant webhook key), `session_token`, `status`, `attendance_api` (ERP push URL) |
| `attendance_logs` | **Attendance events** | `id`, `company_id`, `emp_id`, `first_name`, `last_name`, `attendance_date`, `attendance_time`, `check_type` (`in`/`out`), `check_in_id` (links an `out` to its `in`), `camera_name`, `duration`, `image_url`, `sent_to_webhook`, `webhook_response`, `status` (`On Time`/`Late`/`Exit`) |
| `attendance1` | Pipeline-side attendance table (auto-created by the pipeline's DB layer; in/out pairing) | same shape as `attendance_logs` |
| `user_data` | **Enrolled employees / face gallery index** | `user_id`, `company_id`, `emp_id` (unique), `first_name`, `last_name`, `image_path` (`.png`), `feature_path` (`.npy` embedding), `registration_date` |
| `cameras` | Camera config | `id`, `company_id`, `name`, `location`, `type` (`entrance`/`exit`/`general`), `rtsp_url` (source), `hls_url`, `webrtc_url` (manual overrides), `enabled` |
| `dashboard_users` | RBAC users | `id`, `company_id`, `username`, `password_hash`, `role` |
| `user_sessions` | RBAC bearer tokens | `token`, `user_id`, `company_id`, `role` |
| `tenant_settings` | Attendance policy | `company_id`, `start_time`, `grace_minutes`, `workdays`, `timezone` |
| `holidays` | Per-tenant holidays | `company_id`, `day`, `name` |
| `audit_log` | Audit trail | `company_id`, `actor`, `role`, `action`, `detail`, `ip`, `created_at` |
| `pipeline_jobs` | Start/stop/restart job queue | `company_id`, `username`, `action`, `idx`, `status`, `log` |
| `pipeline_agent_state` | Host-agent heartbeat (single row id=1) | `payload` (JSON: containers + GPU), `updated_at` |

> Note: embeddings are **not** stored in the DB — `user_data.feature_path` holds the
> `.npy` filename; the actual vector lives on disk (see §4).

---

## 3. Attendance logging — the full path

A face becoming a row in `attendance_logs` involves the pipeline, a webhook, the
backend, and the realtime layer.

1. **Recognition (pipeline).** Per frame, the recognition probe
   (`deepstream/utils/probe_enterprise.py`) aligns each detected face to a 112×112
   chip, embeds it with ArcFace, and matches against the gallery. A track's identity
   is **committed** only after `track_min_votes` (default 3) accepted votes, where a
   vote is accepted iff cosine `score ≥ rec_threshold` (0.35) **and**
   `margin ≥ rec_margin` (0.05). Identity is then sticky for the track's life.
2. **Event creation.** When a committed person is inside the detection area, the
   camera `type` decides the check type: `entrance → in`, `exit → out`; `general`
   cameras produce **no** events. The probe enqueues a task (multiprocessing queue)
   carrying `emp_id`, names, `company_id`, `camera_name`, timestamps, and a base64
   JPEG crop of the face.
3. **Worker → webhook.** `attendance_worker` (`deepstream/utils/db_service.py`)
   drains the queue. It throttles per-employee (`ATTENDANCE_THROTTLE_SEC` = 30s),
   re-validates the employee, does in/out pairing, writes its own `attendance1` row,
   and **POSTs to the dashboard webhook** with up to 3 retries:
   - **URL:** `WEBHOOK_URL` = `<dashboard>/api/attendance/entry` (set by the launcher).
   - **Auth:** `Authorization: Bearer <company api_key>` (`WEBHOOK_TOKEN`).
   - **Body:** `emp_id, company_id, first_name, last_name, check_type, check_in_id,
     attendance_date, attendance_time, image_url, image_b64`.
4. **Backend records it.** `POST /api/attendance/entry`
   (`backend/app/modules/attendance/`):
   - Authenticates by matching the bearer against `companies.api_key`
     (then `session_token`, then `user_sessions.token`).
   - **Dedup:** for `check_type=in`, if an `in` already exists today for that
     employee → returns `{"status":"skipped"}` (once-per-day idempotency).
   - **On-time vs Late:** cutoff = `tenant_settings.start_time + grace_minutes`;
     `status="On Time"` if now ≤ cutoff else `"Late"`.
   - **out:** pairs to the latest open `in` (where `check_in_id IS NULL`), writes an
     `out` row with `status="Exit"`.
   - **Proof image:** if `image_b64` present, saves
     `CAPTURES_DIR/<company>/<date>/<emp>_<time>.jpg`, served at `/api/captures/...`.
   - Writes the row to **`attendance_logs`**, emits a Socket.IO `new_attendance_entry`
     to the company room (live dashboard update), and pushes the record to the
     tenant's ERP if configured.

**Reading attendance:** `GET /api/attendance` (list), `/api/attendance/stats`
(present/on-time/late today), `/api/attendance/hourly` (24-bucket), `/api/reports`
(date-range analytics), `GET /api/employees/{emp_id}` (monthly card),
`DELETE /api/attendance` (clear, needs `manage_attendance`).

---

## 4. Enrollment — how a face gets into the system

Enrollment turns a photo into a stored face the pipeline can recognize.

- **UI:** *Employees* page → "+ Enroll" opens a live-capture modal
  (`frontend/src/components/EnrollModal.tsx`). It runs **MediaPipe BlazeFace** in the
  browser, draws a face-oval overlay, and auto-captures after 12 consecutive aligned
  frames (distance/centering/yaw/roll checks). "⭱ Bulk import" enrolls many photos at
  once where **filename (minus extension) = `emp_id`**, with an optional
  `emp_id,first_name,last_name` CSV.
- **API:** `POST /api/employees/enroll` with `{emp_id, first_name, last_name,
  image_b64}` (requires `manage_employees`).
- **Backend face engine** (`backend/app/modules/enrollment/face_engine.py`, models
  from `MODELS_DIR`, mounted read-only):
  - **Detector / quality gate:** YuNet ONNX (preferred — 5 landmarks, frontal checks:
    score ≥0.85, face ≥20% of width, centered, yaw 0.34–0.66, roll ≤15°), falling
    back to **res10 SSD** Caffe detector.
  - **Embedder:** **ArcFace** ONNX (CPU) → L2-normalized 512-d float32 vector.
  - Quality failure → HTTP 422 with a reason.
- **Storage:** under `COMPANY_IMAGES_ROOT/<company_image_folder>` (mounted
  read-write):
  - `{emp_id}.png` — the face crop
  - `{emp_id}.npy` — the ArcFace embedding
  - DB upsert into `user_data` with `image_path`/`feature_path` = those filenames.
- The pipeline consumes this same folder as its **known-faces gallery**
  (`known_face_dir` in the generated config). The pipeline hot-reloads the gallery
  when the folder changes (see §8), so a newly enrolled face is recognized **without
  restarting the pipeline**.

---

## 5. Live video — camera to browser

```
camera RTSP ─▶ deepstream-<company> ─▶ annotated RTSP rtsp://127.0.0.1:8555+N/camI
                                          │
                                          ▼ (MediaMTX pulls, sourceOnDemand:no)
                                MediaMTX path  {admin_username}_camI
                                          │
                        ┌─────────────────┴───────────────────┐
                        ▼                                       ▼
            HLS  :8888/{u}_camI/index.m3u8        WebRTC :8889/{u}_camI (WHEP)
                        └───────────── browser (Live Wall) ────┘
```

- The pipeline serves **one annotated RTSP mount per camera** at
  `rtsp://127.0.0.1:{8555+index}/cam{i}` (built in `deepstream/main_udp.py:
  add_udp_rtsp_branches`).
- MediaMTX pulls each into a path named **`{admin_username}_cam{i}`** (e.g.
  `comet_cam0`) and republishes HLS + WebRTC, while recording to
  `/opt/mediamtx/recordings`.
- **Browser URLs are built host-relative** from `window.location`
  (`frontend/src/lib/streams.ts`): HLS `:8888/{path}/index.m3u8`,
  WebRTC `:8889/{path}`. No IP is baked in — any client that can reach the dashboard
  can reach the streams. `cameras.hls_url`/`webrtc_url` are optional manual overrides.
- **Player** (`frontend/src/pages/Live.tsx`): WebRTC first (embeds MediaMTX's own WHEP
  reader page in an `<iframe>`), HLS fallback via **hls.js** (native HLS on Safari).
- **Naming convention must stay in sync across 3 places:** camera `i` = 0-based
  position among a company's enabled, RTSP-backed cameras **ordered by name**:
  the pipeline config (`gen_company_config.py`), the MediaMTX path generator
  (`gen_mediamtx_paths.py`), and the backend `cameras/service.py` (`stream_path`).

> **Mixed-content caveat:** MediaMTX serves plain HTTP on 8888/8889. If the dashboard
> is served over HTTPS, those ports must be TLS-terminated/proxied or the browser
> blocks them.

---

## 6. Pipeline lifecycle — what "Start" actually does

The *Pipeline* control panel (super-admin, `manage_tenants`) drives company pipelines
without ever touching Docker from the web app.

1. **Start/Stop/Restart** → `POST /api/pipeline/launch` inserts a row into
   `pipeline_jobs` (status `pending`). The UI toasts `Queued <action> for <company>
   (idx N)`. **That is all the web app does.**
2. The **host agent** `deepstream/tools/pipeline_agent.py` (holds `AGENT_TOKEN`):
   - polls `GET /api/pipeline/agent/jobs`, runs the job, and reports status back via
     `POST /api/pipeline/agent/jobs/{id}`;
   - every few seconds POSTs a **heartbeat** (`docker ps`/`logs` of `deepstream-*` +
     `nvidia-smi` GPU telemetry) to `/api/pipeline/agent/heartbeat`, stored in
     `pipeline_agent_state`.
3. `start`/`restart` both run **`tools/run_company_pipeline.sh <user> <index>`**,
   which:
   - regenerates the company TOML from the DB cameras (`gen_company_config.py`);
   - records the company's index in `config/companies/_indices.json`;
   - resolves `company_id` + `api_key` from the DB, writes a gitignored `.db.env`;
   - runs a **GPU pre-flight** (a throwaway `--gpus all` container doing
     `cuInit`/`cuCtxCreate`/`cuMemAlloc`) and **refuses to launch if CUDA is wedged**
     (prevents a crash-loop from re-wedging the host GPU);
   - `docker rm -f deepstream-<user>` then `docker run -d --restart on-failure:5
     --runtime nvidia --gpus all --network host …` with the company env;
   - regenerates the MediaMTX paths.
4. The container entry `tools/pipeline_entry.sh` installs the Python deps (skipped if
   baked into `deepstream-facepipe:latest`) and `exec python3 main_enterprise.py`.

**If "Start" shows "Queued …" and nothing happens, the host agent isn't running.**
The dashboard shows an **agent Online/Offline** badge ("seen Xs ago") and an explicit
warning banner when the agent is offline.

### Per-company port map (index N)

| Purpose | Port |
|---------|------|
| Annotated RTSP out | `8555 + N` |
| Health / Prometheus metrics | `9108 + N` |
| UDP sink (camera i) | `5400 + N*16 + i` |
| MediaMTX HLS / WebRTC (shared) | `8888` / `8889` |

> **Each concurrently-running company needs a distinct index** or they collide on
> these ports. (Known data issue: `_indices.json` currently has both `comet` and
> `iaa` at index 0.)

---

## 7. The DeepStream pipeline internals

Element chain (`deepstream/main_enterprise.py`), the deployed "enterprise" pipeline:

```
nvurisrcbin (per camera, TCP RTSP, auto-reconnect)
  → nvstreammux  (batch, live-source, nvbuf-memory-type=UNIFIED)
  → nvinfer PGIE  — YOLOv8n-face detector (5 facial landmarks via custom parser)
  → nvtracker     — NvDCF
  → nvvideoconvert → capsfilter (RGBA, NVMM, UNIFIED)
        ▲ recognition probe attached here (per-source frame space, CPU-readable surface)
  → nvmultistreamtiler → nvvideoconvert → nvdsosd (overlays)
  → tee
       ├─ queue → nveglglessink (local monitor) | fakesink
       └─ per-camera: nvvideoconvert → H264 encode → RTP → udpsink → RTSP server
```

- **Recognition is in a pad probe, not an SGIE** (unlike the legacy `main_udp.py`,
  which runs ArcFace as an inline SGIE). The probe aligns faces with a Umeyama
  similarity transform to the canonical ArcFace template, batches one
  `embedder.embed(...)` per frame, and matches via a single matmul over normalized
  embeddings.
- **Models:** PGIE = `yolov8n-face2.engine` (`config/config_yolo.txt`), embedder =
  ArcFace TensorRT engine `arc1.engine` (`config/config_arcface.txt` parameters),
  tracker = NvDCF (`config/config_tracker_perf.txt`).
- **Surface memory:** `streammux`/`nvvidconv_rgba` use
  `nvbuf-memory-type = NVBUF_MEM_CUDA_UNIFIED (3)` so the probe can read the surface
  as a NumPy array on the dGPU. (This is the constant fixed in
  `deepstream` PR — `2`/`CUDA_DEVICE` caused a probe segfault.)
- **Reliability** (`deepstream/utils/reliability.py`): `nvurisrcbin` forces RTSP over
  TCP with infinite reconnect; source-level errors are non-fatal (the bin reconnects)
  while core-element errors trigger a supervised restart; a watchdog logs stale feeds.
- **Health server** on `9108+N`: `GET /healthz` (200 healthy / 503 degraded, JSON with
  per-source `frames`, `seconds_since_frame`, `reconnects`, `errors`, `stale`) and
  `GET /metrics` (Prometheus). The dashboard reads this directly.
- **VisionTrack (optional):** on each committed recognition, publishes identity to a
  Redis stream `vt:face:identities:<tenant>` (never blocks the pipeline if Redis is
  down).

---

## 8. Hot reload — what is dynamic vs what needs a restart

This answers a common question directly.

**Reloads live, no restart:**
- **The face gallery.** The pipeline watches the known-faces directory and atomically
  swaps the gallery when its signature changes (`start_gallery_reloader` in
  `main_enterprise.py`). So **enrolling/removing employees takes effect immediately** —
  no pipeline restart.

**Requires a pipeline container restart:**
- **Adding / removing / changing a camera.** The GStreamer graph requests **one
  `nvstreammux` sink pad per camera at startup** and never adds/removes sources at
  runtime — there is no dynamic pad add/release in the live path. So a camera change
  means: regenerate the company TOML and **recreate the container**
  (`run_company_pipeline.sh` is literally `docker rm -f` + `docker run`; this is what
  `restart` does). There is no per-camera hot-add today.
- **Model / threshold changes** (config_pipeline.toml) — read once at startup.

**MediaMTX:**
- MediaMTX **does** watch `mediamtx.yml` and hot-reloads the `paths:` block, and paths
  use `sourceOnDemand: no` so it continuously pulls each pipeline's RTSP. Rewriting the
  paths block therefore does **not** by itself require restarting MediaMTX.
- **But** the upstream RTSP feed is the *pipeline container's* RTSP server. Changing
  cameras changes that feed, which only changes when the **pipeline** is recreated.
- **Practical gotcha:** when an existing path's `source:` URL changes (e.g. a company
  moves from index 1/`:8556` to index 0/`:8555`), MediaMTX has been observed to keep
  dialing the old upstream until restarted. If a path's source changed and the stream
  doesn't follow, `docker restart mediamtx` reliably reloads it. New paths are picked
  up without a restart.

**Why no per-camera hot-reload exists:** it's a deliberate simplicity trade-off —
DeepStream dynamic source add/remove (request/release pads, renegotiation, batch-size
changes on a live `nvstreammux`) is fragile, so the system favors a clean
regenerate-config + recreate-container model. A company typically has a small, stable
camera set, and recreate takes seconds once the baked image
(`deepstream-facepipe:latest`) is built.

---

## 9. Authentication & roles

- **Two identity systems, one `Principal`:**
  - *Legacy company admin* — lives in `companies`; login matches
    `admin_username`/`admin_password_hash`; bearer stored in `companies.session_token`.
    Role is `super_admin` if `admin_username ∈ SUPERADMIN_USERS` (env), else `admin`.
  - *RBAC users* — `dashboard_users` (per-company username/password/role); login
    creates a `user_sessions` row; role comes from the session.
- **Permission model** (`backend/app/core/security.py`): `super_admin` (everything incl.
  `manage_tenants`/`view_tenants`), `admin` (own-tenant management), `manager`
  (`view`/`view_reports`/`export`), `viewer` (`view`/`view_reports`). The UI gates pages
  and actions by **permission**, not role.
- **Super-admin vs company-admin** is exactly the `manage_tenants`/`view_tenants`
  permissions — they unlock the *Companies*, *Pipeline*, and *Tenants* (cross-tenant)
  pages.
- **Machine tokens:**
  - `companies.api_key` — per tenant; authenticates the pipeline's attendance webhook
    and outbound ERP push; rotatable from the *Companies* page.
  - `AGENT_TOKEN` (env) — shared secret for the host agent's job/heartbeat endpoints.
- Frontend stores the bearer in `localStorage` (`ft_token`); every API call attaches
  `Authorization: Bearer …`; a `401` clears it and redirects to `/login`. Socket.IO
  authenticates with the same token.

---

## 10. Dashboard features (by page)

| Page | Permission | What you can do |
|------|-----------|-----------------|
| **Overview** | any | KPIs (present/on-time/late/registered), check-ins-by-hour chart, punctuality pie, live recent-activity feed (Socket.IO) |
| **Live Wall** | any | grid of enabled cameras; WebRTC (preferred) / HLS annotated streams |
| **Attendance** | any | real-time, filterable attendance log (search/date/in-out/status); CSV export; row → employee card |
| **Employees** | view; enroll/delete need `manage_employees` | directory with present/absent; live-capture enroll; bulk import; delete (also removes face files) |
| **Cameras** | view; edit needs `manage_cameras` | CRUD cameras (name/location/type/RTSP); auto-derived HLS/WebRTC URLs + manual overrides |
| **Recordings** | `manage_cameras` | browse + play MediaMTX recordings |
| **Reports** | `view_reports` | date-range analytics, daily/late charts, per-employee attendance-% table, CSV |
| **ERP Sync** | view; resync needs `manage_attendance` | ERP endpoint status, synced/pending counts, resync pending |
| **Pipeline** | `manage_tenants` | per-company Start/Stop/Restart, fleet + agent + GPU status, per-source health, container logs, config provisioning |
| **Companies** | `manage_tenants` | super-admin tenant CRUD, API-key (shown once) + rotation, suspend/activate, set admin password |
| **Users** | `manage_users` | in-tenant RBAC user CRUD (viewer/manager/admin) |
| **Settings** | `manage_settings` | shift start time, grace minutes, timezone, working days, holidays |
| **Audit** | `view_audit` | read-only audit log |
| **Tenants** | `view_tenants` | cross-tenant stats overview |

---

## 11. Operations

### Launch a company pipeline (manually)
```bash
cd /home/meta/deploy/deepstream
./tools/run_company_pipeline.sh <admin_username> <index>   # e.g. comet 0
docker logs -f deepstream-<admin_username>
curl -s localhost:$((9108+<index>))/healthz | jq
```

### The host agent (so the dashboard buttons work)
The agent is the only thing that runs Docker for the web app. Install it as a service
so it survives reboots:
```bash
sudo cp /home/meta/deploy/deepstream/deploy/pipeline-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pipeline-agent
journalctl -u pipeline-agent -f
```
It reads `AGENT_TOKEN` from `attendance-system/backend/.env` and (under the service)
launches pipelines with the local display **off** (`fakesink`); the browser stream is
unaffected.

### Faster starts: build the baked image (once)
```bash
cd /home/meta/deploy/deepstream
docker build -t deepstream-facepipe:latest -f Dockerfile.facepipe .
```
Without it, each pipeline (re)start re-installs ~1 GB of TensorRT/cuda-python from
pypi.nvidia.com. With it, starts take seconds.

### Reboot recovery (current behavior)
After a host reboot:
1. Containers using `--restart on-failure` (the pipelines) do **not** auto-start; the
   agent (if systemd-enabled) is running but only acts on **jobs**, so pipelines stay
   down until someone clicks **Start** (or you run `run_company_pipeline.sh`).
2. If the GPU's first heavy CUDA init transiently fails (`error 100 / no
   CUDA-capable device`) right after a cold boot, "warm" CUDA with a throwaway
   `docker run --rm --gpus all … python3 -c 'import ctypes; ctypes.CDLL("libcuda.so.1").cuInit(0)'`
   then relaunch. The launcher's GPU pre-flight will refuse to start until CUDA is
   healthy.

---

## 12. Troubleshooting & known issues

| Symptom | Cause / fix |
|---------|-------------|
| "Start" toasts **Queued …** then nothing happens | Host agent not running. Start/enable `pipeline-agent` (§11). |
| Live wall **404 / "no stream available"** | No pipeline publishing that path, **or** you're viewing the wrong company's path (e.g. `admin_cam0` when only `comet_cam0` exists). Browser path = `{admin_username}_cam{i}`. |
| Pipeline reaches `PLAYING` then **segfaults** | Surface memory type bug — `NVBUF_MEM_CUDA_UNIFIED` must be `3`, not `2` (`2` is device-only). Fixed in `deepstream` (PR on `fix/probe-nvbuf-memtype-segfault`). |
| `[TRT] CUDA initialization failure with error: 3` host-wide | UVM wedged. `sudo modprobe -r nvidia_uvm && sudo modprobe nvidia_uvm`, or reboot. |
| `error 100 / no CUDA-capable device` right after reboot | Transient cold-GPU first init; warm CUDA then relaunch (§11). |
| MediaMTX keeps dialing an **old port** after a config change | Hot-reload didn't re-pull an existing path's changed source; `docker restart mediamtx`. |
| Two companies' streams collide | Both share an **index** in `_indices.json`; give each concurrently-running company a unique index. |
| Camera change not reflected in the stream | Cameras aren't hot-reloaded — **restart the pipeline** (Pipeline → Restart). |
| Camera blocked in enroll modal over plain HTTP | Browser requires a secure context for `getUserMedia`; use HTTPS/localhost or the Upload fallback. |

---

## 13. Repos & key paths

```
/home/meta/deploy/
├── attendance-system/
│   ├── backend/app/
│   │   ├── core/{db.py, config.py, deps.py, security.py}   # schema, settings, auth
│   │   ├── modules/{attendance,enrollment,employees,cameras,
│   │   │            pipeline,companies,users,settings,reports,
│   │   │            erp,audit,tenants,auth,realtime}/        # routers + services
│   │   └── main.py                                          # app + static SPA + media routes
│   ├── frontend/src/{pages,components,lib}/                 # React dashboard
│   ├── docker-compose.yml                                   # host-net container, :5002
│   └── docs/SYSTEM.md                                       # this file
├── deepstream/
│   ├── main_enterprise.py                                   # deployed pipeline
│   ├── main_udp.py                                          # legacy + add_udp_rtsp_branches
│   ├── utils/{probe_enterprise.py,recognition.py,
│   │          arcface_embedder.py,db_service.py,reliability.py}
│   ├── config/{config_yolo.txt,config_arcface.txt,
│   │           config_tracker_perf.txt, companies/*.toml,_indices.json}
│   ├── tools/{run_company_pipeline.sh,pipeline_entry.sh,
│   │          pipeline_agent.py,gen_company_config.py,gen_mediamtx_paths.py}
│   ├── Dockerfile.facepipe                                  # baked deps image
│   └── deploy/pipeline-agent.service                        # host agent systemd unit
├── mediamtx.yml                                             # MediaMTX config (paths block generated)
└── docker-compose.mediamtx.yml                              # MediaMTX container
```

# FaceTrack — Production Deployment Guide

End-to-end steps to stand up FaceTrack on a fresh production server, plus the
day-2 operations (updates, backups, troubleshooting) you'll actually need.

> **The one gotcha that bites everyone first:** clicking **Start** on the
> Pipeline page does *not* launch anything by itself. It only enqueues a job.
> A separate host process — the **pipeline agent** — drains that queue and runs
> Docker. If the agent isn't running, every Start click just piles up as a
> `pending` job and "nothing happens." Installing the agent (§6) is not optional.

---

## 1. Architecture & components

```
                        ┌───────────────────────── prod server(s) ─────────────────────────┐
   browser ──HTTPS──►  nginx (443, TLS)  ──►  attendance-system container  ──►  PostgreSQL
                        facetrack.<domain>      (uvicorn :5002, single origin)   facial_recognition_db
                                                     ▲        │
                                                     │        │ enqueues start/stop/restart jobs
                                       heartbeat +   │        ▼          reads heartbeat
                                       job polling   │   pipeline_jobs (table)
                                                     │        ▲
                                                ┌────┴────────┴─────┐
                                                │  pipeline agent    │  (systemd: facetrack-agent)
                                                │  pipeline_agent.py │  ── the ONLY thing that runs Docker
                                                └────────┬───────────┘
                                                         │ docker run
                                                         ▼
                                    deepstream-<company> containers (GPU)  ──RTSP──►  MediaMTX ──HLS──► browser
                                    health on :9108+index                            (recordings)
```

| Component | What it is | Runs as | Port(s) |
|---|---|---|---|
| **Dashboard** | FastAPI + built React SPA, single origin | Docker container `attendance-system` (`restart: always`) | `5002` |
| **PostgreSQL** | `facial_recognition_db` (shared with pipeline) | host service / managed DB | `5432` |
| **nginx** | TLS termination + reverse proxy | host service | `80`, `443` |
| **Pipeline agent** | Polls jobs, runs Docker, pushes heartbeat/GPU | **systemd `facetrack-agent`** | — |
| **DeepStream pipelines** | Per-company face recognition | Docker `deepstream-<user>` (GPU) | health `9108+idx`, RTSP `8555+idx` |
| **MediaMTX** | RTSP→HLS/WebRTC + recordings | host service | `8554/8888/8889` |

**Two-host option:** the dashboard/DB/nginx can live on a small CPU box while the
agent + DeepStream pipelines run on the GPU box. Both hosts just need to reach
Postgres, and the agent needs to reach the dashboard URL. Everything below notes
which host each step belongs to. A single-box deployment (all of it on the GPU
server, as on the dev box) is the simplest and is the default.

---

## 2. Server prerequisites

Ubuntu 22.04+ assumed. On the **dashboard host**:

```bash
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"     # log out/in so this takes effect
docker compose version              # expect v2.x

# nginx + certbot for TLS
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

# PostgreSQL 15+ (skip if you use a managed/remote DB)
sudo apt install -y postgresql
```

Additionally on the **GPU / pipeline host**:

```bash
# NVIDIA driver (match your GPU) + container toolkit
sudo apt install -y nvidia-driver-535        # or your version
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
nvidia-smi                                   # sanity check
docker info | grep -i nvidia                 # 'nvidia' must appear under Runtimes

# python3 + requests for the agent
sudo apt install -y python3 python3-requests

# the DeepStream repo (contains pipeline_agent.py + run_company_pipeline.sh)
#   → clone/copy it to /home/<user>/deploy/deepstream  (or set DEEPSTREAM_DIR)
# build the baked pipeline image ONCE (pipelines then start in seconds):
cd /path/to/deepstream && docker build -t deepstream-facepipe:latest -f Dockerfile.facepipe .
```

---

## 3. Get the code & configure

```bash
git clone <repo-url> attendance-system     # or copy the tree
cd attendance-system
cp backend/.env.example backend/.env
```

Edit `backend/.env` — every value that matters for prod:

| Variable | Set it to | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/facial_recognition_db` | URL-encode special chars in the password (`@` → `%40`) |
| `SECRET_KEY` | `openssl rand -hex 32` | **Never** leave the default; rotating it logs everyone out |
| `SUPERADMIN_USERS` | comma-separated tenant `admin_username`s that get super-admin | |
| `AGENT_TOKEN` | `openssl rand -hex 24` | Shared secret with the agent (§6). Empty = pipeline launch disabled |
| `CORS_ORIGINS` | your Vite dev origin(s), or blank in prod | Built SPA is same-origin, so prod usually needs none |
| `COMPANY_IMAGES_ROOT` | path to enrolled face images | Must be readable by the container (see §4 volumes) |
| `CAPTURES_DIR` | `/app/captures` | Live snapshot PII — persisted via volume |
| `RECORDINGS_DIR` | `/recordings` | MediaMTX recordings, mounted read-only |
| `PIPELINE_HEALTH_URL` | `http://localhost:9108/healthz` | Fallback single-pipeline health |
| `PORT` | `5002` | Keep unless you also change compose + nginx |

`backend/.env` is gitignored — secrets never enter the image or git.

---

## 4. Review the compose volume mounts (important)

`docker-compose.yml` uses **host networking** (so the container reaches host
Postgres on `:5432` and pipeline health on `:9108`) and mounts several **host
paths that exist on the dev box**. Before first deploy, confirm each path exists
on the prod server (create or repoint them):

```yaml
volumes:
  - ./captures:/app/captures                                   # created automatically
  - /opt/mediamtx/recordings:/recordings:ro                    # MediaMTX output dir
  - /home/meta/deploy/test/data/company_images:/home/.../company_images   # face gallery (RW)
  - /home/meta/deploy/test/models:/app/models:ro               # res10 + ArcFace for enrollment
```

If your prod layout differs, edit the left-hand host paths to match. The gallery
mount **must be writable** (enrollment adds `.png`/`.npy`); the models and
recordings mounts are read-only.

---

## 5. Deploy the dashboard

From the repo root, the one command that does preflight → build → run → agent:

```bash
./deploy/deploy.sh            # full deploy (dashboard + agent)
```

Or step by step:

```bash
./deploy/preflight.sh         # verify every prerequisite first (recommended)
./deploy/deploy.sh app        # build image + start container, wait for health
```

The whole app (API + SPA + Socket.IO) is now on **http://localhost:5002**. The
container has `restart: always`, so it survives reboots on its own.

```bash
docker logs -f attendance-system      # follow startup
```

---

## 6. Install the pipeline agent (the piece that makes Start work)

On the **GPU/pipeline host**, as a user in the `docker` group:

```bash
sudo ./deploy/install-agent.sh
```

This is idempotent and:

1. Ensures `backend/.env` has an `AGENT_TOKEN` (generates one if missing).
2. Writes `/etc/facetrack/agent.env` with a token that **matches** the dashboard.
3. Installs + enables the `facetrack-agent` systemd service.
4. Waits until the agent is live, then it starts draining pending jobs.

Verify:

```bash
systemctl status facetrack-agent
journalctl -u facetrack-agent -f       # 'pipeline agent → http://localhost:5002 …'
```

> If you passed a remote dashboard, set the URL first:
> `DASHBOARD_URL=http://<dashboard-host>:5002 sudo -E ./deploy/install-agent.sh`
> The agent should use the **internal** URL, not the public HTTPS host (skips the proxy hop).

**Token mismatch is the #1 failure.** If the agent logs `403` on every poll, the
`AGENT_TOKEN` in `/etc/facetrack/agent.env` and `backend/.env` differ — re-run
`install-agent.sh` (it forces them into sync) and restart the dashboard.

---

## 7. nginx + TLS (public HTTPS)

TLS is **required** for employee enrollment — the webcam `getUserMedia()` only
works in a secure context (HTTPS or `http://localhost`); over plain
`http://<ip>:5002` the camera silently stays black.

```bash
# 0) DNS: create an A record  facetrack.<domain> → <server-ip>  and wait for it:
dig +short facetrack.<domain> A

# 1) install the vhost (edit the server_name/domain inside it first)
sudo cp infra/nginx/facetrack.metaxperts.net.conf /etc/nginx/sites-available/facetrack.<domain>
sudo ln -sf /etc/nginx/sites-available/facetrack.<domain> /etc/nginx/sites-enabled/

# 2) issue + wire the cert (HTTP-01, auto-renews):
sudo certbot --nginx -d facetrack.<domain>

# 3) reload
sudo nginx -t && sudo systemctl reload nginx
```

Full install notes (incl. the DNS-01 manual path) are in the header of
`infra/nginx/facetrack.metaxperts.net.conf`. App is now at `https://facetrack.<domain>`.

---

## 8. First run — create the first tenant & launch a pipeline

1. **Super-admin login.** A `SUPERADMIN_USERS` username must exist as a tenant
   `admin_username` in the DB. Set/reset its password with the host helper
   (it reads `backend/.env` for `DATABASE_URL`):
   ```bash
   cd backend
   python3 -m pip install psycopg2-binary werkzeug python-dotenv   # once, if missing
   python3 set_admin_password.py '<password>' <username>           # prints "password verifies: True"
   ```
2. **Companies → New** — create a tenant; note its API key.
3. **Cameras** — add each camera with its RTSP URL.
4. **Pipeline → Provision** — generates that company's DeepStream config from its
   cameras. **Start** — enqueues a job the agent picks up within ~5s; the health
   badge on `:9108+index` goes green once frames flow.
5. The pipeline posts recognitions to `POST /api/attendance/entry` with the
   company API key as the bearer token; the live feed updates in real time.

---

## 9. Day-2 operations

### Deploy an update
```bash
cd attendance-system
git pull
./deploy/deploy.sh app        # rebuilds image + restarts container
# only if the agent script changed:
sudo systemctl restart facetrack-agent
```

### Check everything at a glance
```bash
./deploy/deploy.sh status
```

### Logs
```bash
docker logs -f attendance-system          # dashboard
journalctl -u facetrack-agent -f          # agent (jobs + heartbeat)
docker logs -f deepstream-<company>       # a specific pipeline
```

### Database backup (do this on a schedule)
```bash
pg_dump "$DATABASE_URL" | gzip > facetrack-$(date +%F).sql.gz
```
Also back up the **face gallery** (`COMPANY_IMAGES_ROOT`) and `captures/` (PII).

### Stop / start
```bash
docker compose stop                       # dashboard
sudo systemctl stop facetrack-agent       # stop launching pipelines
```

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| **Start does nothing; jobs stay `pending`** | Agent not running | `systemctl status facetrack-agent`; if absent, `sudo ./deploy/install-agent.sh` |
| Agent logs `403` on every poll | `AGENT_TOKEN` mismatch | Re-run `install-agent.sh`, then restart the dashboard |
| Pipeline health badge never greens | Container crashed / no frames | `docker logs deepstream-<company>`; check RTSP URL, GPU free memory |
| Health probe hits wrong company | Index drift after add/rename company | Relaunch that company's pipeline (index = position in name-ordered company list) |
| Webcam black on enrollment | Not served over HTTPS | Finish §7 (TLS) and use the `https://` host |
| Dashboard can't reach DB | `DATABASE_URL` / host networking | `./deploy/preflight.sh`; verify Postgres `listen_addresses` + `pg_hba.conf` |
| Pipelines fail to start on GPU box | nvidia runtime / baked image missing | `docker info | grep -i nvidia`; build `deepstream-facepipe:latest` (§2) |
| Everything down after reboot | agent unit not enabled | `sudo systemctl enable facetrack-agent` (installer does this) |

### Inspect the job queue directly
```sql
-- recent jobs and their status
SELECT id, username, action, idx, status, updated_at
FROM pipeline_jobs ORDER BY id DESC LIMIT 20;

-- clear a pile of stale duplicate 'pending' starts (keep newest per company)
UPDATE pipeline_jobs SET status='skipped'
WHERE id IN (/* explicit duplicate ids */);
```

---

## 11. Port & firewall reference

| Port | Component | Exposure |
|---|---|---|
| `443`, `80` | nginx (HTTPS + redirect) | **public** |
| `5002` | dashboard uvicorn | localhost only (behind nginx) |
| `5432` | PostgreSQL | localhost / private network only |
| `9108 + idx` | per-pipeline health | localhost (read by dashboard/agent) |
| `8555 + idx` | per-pipeline RTSP out | localhost / to MediaMTX |
| `8554/8888/8889` | MediaMTX RTSP/HLS/WebRTC | as needed for playback |

Only `80`/`443` should be open to the internet. Everything else stays on
localhost or the private network between the two hosts.

---

## Files added for deployment

```
deploy/
  deploy.sh                     one-command deploy/update/status entrypoint
  preflight.sh                  pre-deploy prerequisite checks
  install-agent.sh              installs the pipeline agent as a systemd service
  lib.sh                        shared helpers / config resolution
  agent.env.example             template for /etc/facetrack/agent.env
  systemd/
    facetrack-agent.service     the agent unit (the critical missing piece)
    facetrack.service           OPTIONAL compose wrapper for the dashboard
DEPLOYMENT.md                   this guide
```

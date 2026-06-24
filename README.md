# FaceTrack — Enterprise Attendance Platform

A multi-tenant, role-based attendance command center for NVIDIA DeepStream
face-recognition pipelines. Modular **FastAPI** backend + component-based
**React** frontend, served single-origin and containerized.

It ingests recognition events from the DeepStream pipeline (webhook), stores
attendance, and provides live monitoring, reporting, company/camera management,
RBAC, audit, and per-company pipeline provisioning — all isolated per tenant.

---

## Features

- **Multi-tenant** — every company's data is isolated by `company_id`; one login page, the username resolves the tenant.
- **RBAC** — `super_admin · admin · manager · viewer`, enforced server-side.
- **Live attendance feed** — real-time via Socket.IO, with on-time/late status.
- **Live video wall** — plays each camera's HLS/WebRTC stream (`hls.js`).
- **Employee directory + attendance card** — per-employee monthly calendar (present / on-time / late).
- **Reporting engine** — date-range analytics, trends, per-employee %, CSV/print.
- **ERP integration** — real-time push of each event to the tenant's ERP, with resync.
- **Company management** (super-admin) — create tenants, rotate API keys, set passwords, suspend.
- **Camera management** (per company) — CRUD with RTSP source + HLS/WebRTC playback URLs.
- **Pipeline provisioning** (super-admin) — generate a company's DeepStream config and launch/stop its pipeline container via a host agent (the web app never touches Docker).
- **Live snapshots** — proof-of-presence face crop captured at recognition.
- **Recordings** — browse/play MediaMTX recordings.
- **Audit log** — logins, user/company/camera/pipeline/settings changes.
- **Configurable policy** — shift start, grace, working days, holidays.
- **Self-service password change**, 6 color themes.

---

## Architecture

```
backend/app/
  core/        config · db (tables) · security (RBAC) · deps (auth)
  modules/
    auth attendance employees reports erp users tenants
    cameras companies pipeline recordings audit settings realtime
  main.py      app factory: routers + Socket.IO + serves the built SPA
frontend/      React + Vite + TypeScript + Tailwind (context / lib / components / pages)
Dockerfile     multi-stage: build React → serve from FastAPI (single origin)
```

Layering: **router** (HTTP) → **service** (business logic) → **db** (async `databases` over PostgreSQL).
Auth is a single `Principal` dependency + `require(perm)` factory. Bearer-token auth (issued at login).

---

## Prerequisites

- **PostgreSQL** database (`facial_recognition_db`) with `companies` and `user_data` tables (shared with the recognition pipeline).
- **Docker** + Docker Compose (for the containerized run), or Python 3.11 + Node 20 (for dev).

---

## Quick start (Docker — production, single origin)

```bash
cd attendance-system
cp backend/.env.example backend/.env     # then edit (see Configuration)
docker compose up -d --build             # → http://localhost:5002
docker logs -f attendance-system
```

The whole app (API + UI) is served on **http://localhost:5002**. `restart: always`
makes it survive reboots. Secrets stay in `backend/.env` (never baked into the image).

## Development (hot reload)

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn app.main:application --host 0.0.0.0 --port 5002   # API + docs at /docs

# Frontend (separate terminal)
cd frontend && npm install
npm run dev                                               # http://localhost:5180 (proxies /api + /socket.io → :5002)
```

---

## Configuration (`backend/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/facial_recognition_db` |
| `SECRET_KEY` | app secret |
| `SUPERADMIN_USERS` | comma-separated company `admin_username`s granted super-admin |
| `CORS_ORIGINS` | dev frontend origin(s) |
| `COMPANY_IMAGES_ROOT` | path to enrolled face images (served read-only) |
| `CAPTURES_DIR` | where live snapshots are stored |
| `RECORDINGS_DIR` | MediaMTX recordings to browse |
| `AGENT_TOKEN` | shared secret for the host-side pipeline agent |
| `PIPELINE_HEALTH_URL` | enterprise pipeline health endpoint to proxy |

A template is provided as `backend/.env.example`.

---

## Roles & permissions

| Permission | super_admin | admin | manager | viewer |
|---|:--:|:--:|:--:|:--:|
| view, view_reports | ✓ | ✓ | ✓ | ✓ |
| export | ✓ | ✓ | ✓ | — |
| manage_attendance, manage_users, manage_cameras, manage_settings, view_audit | ✓ | ✓ | — | — |
| view_tenants, manage_tenants (companies + pipeline) | ✓ | — | — | — |

Company users manage their own cameras/employees/reports; **pipeline + company management are super-admin only.**

---

## Login & multi-tenancy

One login page (`/login`); the **username** identifies the company. A company's
admin account is set when the company is created (super-admin → **Companies**),
and admins add staff in **Users**. Everything after login is scoped to that tenant.

---

## Pipeline integration

The DeepStream pipeline posts each recognition to `POST /api/attendance/entry`
with the company's **API key** as the bearer token (optionally a base64 face
snapshot as `image_b64`). Provision/launch a company's pipeline from the
super-admin **Pipeline** page (generates config from that company's cameras and
queues a job to the host agent — see `tools/pipeline_agent.py` in the pipeline repo).

---

## Project layout

```
attendance-system/
  backend/        FastAPI app (app/), requirements.txt, .env(.example)
  frontend/       React app (src/), package.json
  Dockerfile      multi-stage build (node → python)
  docker-compose.yml
  README.md
```

## Default credentials

Set per tenant in the database. The super-admin can reset any tenant's password
(**Companies → Set password**) or use `backend/set_admin_password.py '<pw>' <username>`.
Users can self-change via the 🔑 button in the top bar.

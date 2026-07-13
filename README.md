# FaceTrack — Enterprise Attendance Platform

![FastAPI](https://img.shields.io/badge/FastAPI-modular-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-Vite%20%2B%20TS-61dafb?logo=react&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-CSS-38bdf8?logo=tailwindcss&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-multi--tenant-336791?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-single--origin-2496ed?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-Proprietary-red)

A multi-tenant, role-based attendance command center for NVIDIA DeepStream
face-recognition pipelines. Modular **FastAPI** backend + component-based
**React** frontend, served single-origin and containerized.

It ingests recognition events from the DeepStream pipeline (webhook), stores
attendance, and provides live monitoring, reporting, company/camera management,
RBAC, audit, and per-company pipeline provisioning — all isolated per tenant.

```mermaid
flowchart LR
  CAM["Cameras (RTSP)"] --> PIPE["DeepStream pipeline\n(per company)"]
  PIPE -->|"webhook + face snapshot"| API
  PIPE -->|RTSP| MTX["MediaMTX"]
  subgraph FaceTrack["FaceTrack (:5002, single origin)"]
    API["FastAPI backend\nrouter → service → db"] --> DB[("PostgreSQL\nfacial_recognition_db")]
    API <-->|"Socket.IO (live feed)"| UI["React SPA\n(RBAC-aware)"]
  end
  MTX -->|HLS / WebRTC| UI
  API -->|"real-time push"| ERP[("Company ERP")]
```

---

> **New to the product?** See the **[User Guide](./USER_GUIDE.md)** for every feature and how to use it, plus common workflows.

## Features

- **Multi-tenant** — every company's data is isolated by `company_id`; one login page, the username resolves the tenant.
- **RBAC** — `super_admin · admin · manager · viewer`, enforced server-side.
- **Live Attendance board** — kiosk-style real-time confirmation screen: bold per-employee cards with a full-face photo, status and time; a whole group is highlighted as they're marked.
- **Live attendance feed** — real-time via Socket.IO, with on-time/late/checkout status.
- **Live video wall** — each camera's HLS/WebRTC stream; grouped by company for super-admins.
- **Employee directory + enrollment** — per-employee monthly calendar; webcam/photo enrollment (auto-restarts the pipeline to load new faces).
- **Attendance policy** (per company) — shift start/end, unpaid break, late/early-leave/half-day/min-hours/overtime thresholds, working days, holidays, timezone. Statuses: On&nbsp;Time · Late · Left&nbsp;Early · Half&nbsp;Day · Overtime.
- **Dynamic recognition tuning** (per company) — match threshold, top-1/top-2 margin, and stability votes, applied to that company's pipeline to balance mismatch vs. missed recognitions.
- **Recordings + retention** — browse/play MediaMTX recordings; per-company retention enforced natively (auto-delete after N days).
- **Reporting engine** — date-range analytics, worked hours, per-employee %, export.
- **ERP integration** — real-time push of each event to the tenant's ERP, with resync.
- **Company management** (super-admin) — full CRUD: create, edit, rotate keys, set passwords, suspend, and cascade-delete tenants.
- **Camera management** (per company) — CRUD with RTSP source, playback URLs, and drawable per-camera detection zones.
- **Pipeline provisioning** (super-admin) — generate a company's DeepStream config and start/stop its pipeline via a host agent (the web app never touches Docker).
- **Live snapshots** — proof-of-presence face crop captured at recognition.
- **Audit log** — logins, user/company/camera/pipeline/settings changes.
- **Collapsible sidebar**, self-service password change, color themes.

---

## Architecture

> For the full **two-repo system architecture** (FaceTrack dashboard + DeepStream
> GPU pipeline, and how they connect), see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

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

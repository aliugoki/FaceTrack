# FaceTrack — User Guide

How to use the FaceTrack attendance platform end to end: the features, who can use
them, and the day-to-day workflows. For *system design* see
[`ARCHITECTURE.md`](./ARCHITECTURE.md); for *installing/running in production* see
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## 1. What FaceTrack is

FaceTrack is a multi-tenant, face-recognition **attendance command center**. Two
components work together:

- **FaceTrack dashboard** (this repo) — the web app: login, monitoring, reporting,
  employee enrollment, camera & company management, policy, and RBAC. Served on one
  origin (`:5002`).
- **DeepStream pipeline** (`aliugoki/DeepStream`) — the GPU engine that watches each
  company's cameras, recognizes enrolled faces, and posts attendance back to the
  dashboard.

Each **company (tenant)** is fully isolated: its own employees, cameras, gallery,
policy, and pipeline. One login page; the username identifies the tenant.

---

## 2. Roles & access

Set per user (super-admins are configured via `SUPERADMIN_USERS`). Every screen and
API is enforced server-side.

| Capability | super_admin | admin | manager | viewer |
|---|:--:|:--:|:--:|:--:|
| View dashboards, live boards, attendance | ✓ | ✓ | ✓ | ✓ |
| View & export reports | ✓ | ✓ | ✓ | — |
| Manage employees / enrollment | ✓ | ✓ | — | — |
| Manage cameras & recordings | ✓ | ✓ | — | — |
| Manage attendance & settings (policy) | ✓ | ✓ | — | — |
| Manage users (RBAC) | ✓ | ✓ | — | — |
| View audit log | ✓ | ✓ | — | — |
| **Companies & pipelines (fleet)** | ✓ | — | — | — |

A company **admin** runs their own tenant (employees, cameras, policy, reports).
**Companies + pipeline provisioning are super-admin only.**

---

## 3. Getting started

1. Open the app (e.g. `https://facetrack.<domain>`), sign in on `/login`. Your
   **username selects your company**.
2. First-time super-admin password is set on the server — see DEPLOYMENT.md §8.
3. Use the **🔑** button (top bar) to change your own password, and the theme
   selector to pick one of the color themes.

> **HTTPS is required** for webcam enrollment (browsers only allow the camera in a
> secure context). Over plain HTTP the capture stays black.

---

## 4. Features, screen by screen

Navigation lives in the left sidebar (collapse it with the **«/»** toggle — the
choice is remembered).

### Overview
Live KPIs (present today, on-time, late, registered), check-ins-by-hour and
punctuality charts, and a rolling recent-activity feed. Your at-a-glance start page.

### Live Attendance  (`/board`) — the confirmation kiosk
A real-time board built for an entrance screen. As each person is recognized, a
**bold card** appears with their **full-face photo**, name, check-in/out, status,
and time. New arrivals are highlighted with a colored ring and ✓ for ~25s, so a
**group walking in together each see their own card**. Includes live counters, a
ticking clock, and a **Full screen** (kiosk) button. This is where employees confirm
their attendance was marked.

### Live Wall  (`/live`)
The annotated video feeds (HLS/WebRTC). Company users see their own cameras;
super-admins see the **whole fleet grouped by company** in collapsible sections.

### Attendance log
The raw in/out event stream for the tenant — who, when, which camera, and the
computed status.

### Employees  (directory + enrollment)
The roster with each employee's monthly attendance card (present / on-time / late).
**Enroll** a face by webcam capture or photo upload — the system detects, aligns,
and stores the face embedding. After enrolling, the pipeline **auto-restarts** so
the new face is recognized without manual steps. (Requires *manage employees*.)

### Cameras  (+ detection zones)
Add/edit cameras with an RTSP source and type (**entrance / exit / general**). Draw
a per-camera **detection zone** (polygon) so attendance only triggers inside it.
Playback URLs are generated automatically. (Requires *manage cameras*.)

### Recordings
Browse and play the video recordings MediaMTX captured per camera. Retention is
controlled per company in **Settings → Recordings**.

### Pipeline  (super-admin)
Provision and control each company's recognition pipeline: **Provision** generates
the config from that company's cameras; **Start / Stop / Restart** queues a job the
host agent runs (the web app never touches Docker). Shows live health per pipeline
(cameras live, frames flowing) and the host agent/GPU status.

### Reports
Date-range analytics: working days, unique present, on-time vs late, **worked
hours**, and per-employee breakdown (days present, on-time/late, worked hours,
attendance %). Exportable.

### Settings  (attendance policy — see §5)
Everything about how attendance is judged and how recognition behaves, per company.

### Users
Create dashboard users for your company and assign roles (`viewer / manager /
admin`). (Requires *manage users*.)

### Companies  (super-admin) — full CRUD
Create tenants, **Edit** their details (name, gallery folder, WebRTC URL, ERP API),
rotate the API key, set the admin password, **Suspend/Activate**, and **Delete**.
Delete cascades to all of that tenant's data and stops its pipeline (type-the-name
confirm; you can't delete the company you're signed in as).

### Tenants  (super-admin)
Fleet overview: each company with today's present/on-time/late and registered
counts.

### ERP Sync
Configure and monitor real-time push of each recognition event to the tenant's ERP,
with re-sync.

### Audit Log
Every login and user/company/camera/pipeline/settings change, with actor and time.

---

## 5. Attendance policy (Settings)

Per-company, under **Settings** (requires *manage settings*). Changes are audited.

**Shift**
| Field | Meaning |
|---|---|
| Shift start / end | The workday window. |
| Timezone | Company timezone (stored per tenant). |

**Break (optional, unpaid)** — start/end; excluded from worked hours. Leave empty
for no break.

**Thresholds (minutes)** — drive the attendance status:
| Field | Default | Effect |
|---|--:|---|
| Late grace | 0 | After **start + grace** → *Late*. |
| Early-leave grace | 0 | Checkout before **end − grace** → *Left Early*. |
| Half-day under | 240 | Worked less than this → *Half Day*. |
| Min worked (full day) | 0 | Minimum to count as a full day in reports. |
| Overtime after | 0 | Worked beyond scheduled + this → *Overtime* (0 = off). |

**Working days** — which weekdays count toward attendance %.
**Holidays** — a per-company calendar.

**Recordings → Retention (days)** — how long videos are kept before automatic
deletion. **0 = keep forever**, empty = system default (48h). Enforced natively by
MediaMTX and applies within seconds of saving (no stream interruption).

**Face recognition** — tune matching to your cameras & gallery:
| Field | Default | Effect |
|---|--:|---|
| Match threshold | 0.35 | Cosine cutoff. **Higher = stricter** (fewer wrong matches); **lower** (fewer missed people). |
| Margin (best vs 2nd) | 0.05 | Minimum gap to the runner-up — guards against similar-looking enrollments (the main anti-mismatch lever). |
| Stability votes | 3 | Consecutive frames before an identity is confirmed. |

Saving recognition changes **restarts that company's pipeline** to apply them.
Guidance: raise **threshold/margin** if a wrong person is ever matched; lower the
**threshold** if known people are missed. Start around **0.35–0.40 threshold /
0.05–0.08 margin** and tune per site.

---

## 6. Common workflows

### Onboard a new company (super-admin)
1. **Companies → Create** (name, admin username/password, gallery folder). Copy the
   API key shown once.
2. Sign in as (or have the admin sign in as) that company.
3. **Cameras** → add each camera (RTSP + type). Draw detection zones if needed.
4. **Employees** → enroll staff faces.
5. **Settings** → set the attendance policy + recognition tuning.
6. **Pipeline → Provision**, then **Start**. Watch health go green.

### Enroll an employee
Employees → Enroll → capture/upload a clear, front-facing photo → save. The pipeline
auto-restarts to load the new face. Verify on **Live Attendance** by walking past a
camera.

### Verify attendance is being marked
Open **Live Attendance** (`/board`) on a screen near the entrance (Full screen). Each
recognized person appears as a bold card with photo, status, and time. Cross-check
totals on **Overview** and detail on **Attendance log** / **Reports**.

### Improve recognition accuracy
If someone isn't recognized: ensure a clear, reasonably large, front-on face at the
camera (ceiling/wide shots give faces too small to match). If the wrong person is
matched: **Settings → Face recognition** → raise **margin** (and/or threshold).
Changes restart the pipeline automatically.

### Manage recordings retention
**Settings → Recordings → Retention (days)** → save. The change syncs to MediaMTX
within seconds; older recordings age out automatically.

### Remove a company (super-admin)
**Companies → Delete** → type the company name to confirm. All its data is removed
and its pipeline stopped. (The on-disk face gallery folder is left in place; remove
it manually if desired.)

---

## 7. Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| **Start does nothing; pipeline never runs** | The host **agent** isn't running. See DEPLOYMENT.md §6 (`install-agent.sh`). |
| **Enrolled person not recognized** | Face too small / top-down (ceiling cameras) — get a larger, front-on face; or the pipeline needs a restart after enrolling (auto-queued). |
| **Wrong person matched** | Raise **margin** then **threshold** in Settings → Face recognition. |
| **Attendance not logged despite recognition** | Recognition must *commit* first (clears threshold + margin over N votes). Tune Settings → Face recognition. |
| **Live board shows "Invalid Date"** | Fixed — reload; the board parses the time-only field correctly. |
| **Webcam black during enrollment** | Not served over HTTPS — use the `https://` host. |
| **Recordings not being deleted** | Set a retention in Settings → Recordings; the agent must be running to sync it. |

---

## 8. Documentation map

| Doc | Purpose |
|---|---|
| **USER_GUIDE.md** (this) | Features & how to use them |
| [README.md](./README.md) | Feature overview + quick start |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Two-repo system design & data flow |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production install & operations |
| [deploy/README.md](./deploy/README.md) | Deploy-kit script index |
| DeepStream repo `ARCHITECTURE.md` | Pipeline internal file map |

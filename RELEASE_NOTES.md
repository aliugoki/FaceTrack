# Release Notes — FaceTrack ⇄ VisionTrack (2026-07-16)

Three features across the FaceTrack (attendance dashboard + DeepStream pipeline)
and VisionTrack (people-tracking) systems, tightening the integration between
them and hardening recovery from network/camera outages.

**TL;DR**
- **VisionTrack:** each tenant can now switch its FaceTrack feed on/off from the dashboard.
- **FaceTrack:** operators can see stream outages and reprocess missed footage from the NVR on demand.
- **FaceTrack:** operators can upload a recorded clip and have it inferred faster-than-realtime — no NVR needed.

---

## 1. VisionTrack — Per-tenant "FaceTrack feed" toggle

**What:** A per-tenant switch (Settings → Organization → **FaceTrack feed**) that
turns a tenant's entire FaceTrack integration on or off. It gates **both** sides:
- the live **face-identity feed** — the Redis consumer that ingests recognitions
  into `person_identities` — starts only for enabled tenants, and a running
  tenant's stream tasks are reaped within ~30s when it's switched off;
- the **roster sync** — the company/employee sync scripts skip disabled tenants.

**Why:** Previously the feed was global-only (`FACE_IDENTITY_ENABLED` env), with no
way to pause a single tenant. The global env flag remains as the master switch.

**Also fixed:** a latent bug where `use_deepstream` was silently dropped on
`PATCH /tenants/me` (never persisted); it now saves correctly alongside the new flag.

**Upgrade:** Alembic migration `0022_tenant_facetrack_feed` adds
`tenants.facetrack_feed_enabled BOOLEAN NOT NULL DEFAULT true` — additive and
reversible; existing tenants keep their current always-on behaviour. Run
`alembic upgrade head` and restart the backend.

_PR: VisionTrack #1 · gated by `tenant:update`._

---

## 2. FaceTrack — Stream-gap ledger + on-demand backfill

**What:** The Pipeline page gains a **"Backfill & offline reprocessing"** card:
- a ledger of detected **stream gaps** (per camera: down-from, recovered,
  duration, status), and
- a **manual backfill** trigger (company → camera → from/to time) plus a per-gap
  **Reprocess** button.

Each request pulls the missed window from the camera's Hikvision **NVR** and
reprocesses it **faster than real-time** (file source, unthrottled), stamping
attendance at the true recording time. The host agent runs it; the dashboard
never touches Docker.

**Why:** The gap-detection + NVR-reprocessing engine already existed (Phase 3),
but nothing surfaced it — the `stream_gaps` table had no reader and outages could
only self-heal. Operators can now see and act on gaps.

**New endpoints (super-admin):**
`GET /api/pipeline/gaps` · `GET /api/pipeline/cameras` · `POST /api/pipeline/backfill`.
Backfill jobs appear in the existing **Launch jobs** table (`action=backfill`).

**Requires:** per-camera NVR credentials (Cameras → NVR fields). Windows are
capped at 12h per job.

_PR: FaceTrack #7 (merged)._

---

## 3. FaceTrack — High-speed offline inference from an uploaded clip

**What:** On the same card, **"Or upload a recorded clip"** — pick a video file
and the real-world **recording-start time**, and the clip is inferred
faster-than-realtime with attendance stamped from that start time. No NVR needed
— ideal after an internet outage where footage exists only as a local file.

**How it flows:** the dashboard streams the upload to
`captures/backfill_uploads/` (bind-mounted to the host), enqueues a backfill job
with `upload=true`, and the host agent runs `run_backfill_file.sh`, which mounts
the clip into a one-shot DeepStream container (`live-source=0`, unthrottled) and
quits at end-of-clip.

**New endpoint:** `POST /api/pipeline/backfill/upload` (super-admin, multipart) —
validates type (video only) and size (≤ 2 GB); filenames are sanitized against
path traversal.

**Upgrade / deploy notes:**
- FaceTrack backend adds the **`python-multipart`** dependency (required by
  FastAPI for uploads) — rebuild the dashboard image (`./deploy/deploy.sh app`).
- The GPU host must carry the DeepStream **`tools/run_backfill_file.sh`** script
  and the agent's upload branch.

_PRs: FaceTrack #8 (dashboard) + DeepStream feature line (default branch)._

---

## Compatibility & rollout summary

| System | Change | Action required |
|---|---|---|
| VisionTrack | migration `0022`, backend + UI | `alembic upgrade head` + restart backend |
| FaceTrack dashboard | new API/UI + `python-multipart` | rebuild image: `./deploy/deploy.sh app` |
| DeepStream (GPU host) | `run_backfill_file.sh` + agent upload branch | pull the default branch on the GPU host |

All three are backward-compatible: the VisionTrack flag defaults to enabled, and
the FaceTrack additions are new surfaces that don't alter existing behaviour.

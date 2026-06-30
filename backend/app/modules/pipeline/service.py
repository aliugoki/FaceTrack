"""Pipeline operations — live health + fleet status + agent heartbeat.

The web app never runs docker. Two signals are combined here:

  * **Health endpoint** (strongest "alive & processing" signal): each running
    pipeline serves /healthz on 9108+index. The dashboard container uses host
    networking, so it can reach localhost:<port> directly — no agent needed.
  * **Agent heartbeat** (enrichment): the host-side `pipeline_agent.py` pushes a
    JSON snapshot of deepstream-* containers (state/uptime/logs) + GPU telemetry,
    stored in `pipeline_agent_state`. Gives container state/logs/GPU the health
    port alone can't show.
"""
import json
import asyncio

import httpx

from app.core.db import (database, companies, cameras, pipeline_jobs,
                         pipeline_agent_state)

HEALTH_BASE_PORT = 9108
AGENT_STALE_SEC = 20.0      # heartbeat older than this → agent considered offline


def health_port(index: int) -> int:
    return HEALTH_BASE_PORT + int(index)


async def fetch_health(index: int, timeout: float = 1.5) -> dict:
    """Proxy a pipeline's /healthz (returns 200 healthy / 503 degraded, JSON body
    either way). Connection refused → pipeline not running on that port."""
    url = f"http://localhost:{health_port(index)}/healthz"
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(url)
            snap = r.json()
    except Exception as e:
        return {"available": False, "reason": str(e), "index": index,
                "health_port": health_port(index)}
    raw = snap.get("sources", {}) or {}
    sources = [{"idx": int(k), **v} for k, v in sorted(raw.items(), key=lambda kv: int(kv[0]))]
    stale = sum(1 for s in sources if s.get("stale"))
    return {
        "available": True, "index": index, "health_port": health_port(index),
        "healthy": bool(snap.get("healthy")),
        "pipeline_state": snap.get("pipeline_state"),
        "uptime_sec": snap.get("uptime_sec"),
        "sources": sources,
        "total_sources": len(sources),
        "stale_sources": stale,
        "live_sources": len(sources) - stale,
    }


# ---- agent heartbeat (containers + GPU) ----
async def save_heartbeat(containers: list, gpus: list) -> None:
    payload = json.dumps({"containers": containers, "gpus": gpus})
    await database.execute(
        "INSERT INTO pipeline_agent_state (id, payload, updated_at) "
        "VALUES (1, :p, now()) "
        "ON CONFLICT (id) DO UPDATE SET payload = :p, updated_at = now()",
        {"p": payload})


async def agent_state() -> dict:
    # Age is computed in SQL (EXTRACT EPOCH from now() - updated_at) so both sides
    # use Postgres's clock — avoids a container-UTC vs server-TZ skew that would
    # otherwise make the agent look perpetually online.
    row = await database.fetch_one(
        "SELECT payload, updated_at, "
        "EXTRACT(EPOCH FROM (now() - updated_at)) AS age_sec "
        "FROM pipeline_agent_state WHERE id = 1")
    if not row or not row["updated_at"]:
        return {"online": False, "last_seen": None, "age_sec": None,
                "gpus": [], "containers": []}
    age = float(row["age_sec"])
    data = json.loads(row["payload"]) if row["payload"] else {}
    return {
        "online": age <= AGENT_STALE_SEC,
        "last_seen": row["updated_at"].isoformat(),
        "age_sec": round(age, 1),
        "gpus": data.get("gpus", []),
        "containers": data.get("containers", []),
    }


async def company_index(company_id) -> int:
    """Stable, UNIQUE pipeline slot for a company = its 0-based position among all
    companies ordered by ``company_name`` (the same ordering used elsewhere for
    per-camera stream paths). Each company therefore maps to distinct ports
    (RTSP ``8555+idx``, health ``9108+idx``), so the fleet status can't mistake one
    company's running pipeline for another's. Previously the index defaulted to 0
    for every company, so non-running tenants all probed comet's :9108 and showed a
    false "healthy" badge.

    Trade-off: adding/renaming a company can shift positions; a running pipeline
    then needs a relaunch to land on its new ports. Renames are rare and this keeps
    the index derivable identically on both the dashboard and the launcher (no
    extra state)."""
    rows = await database.fetch_all(
        companies.select().order_by(companies.c.company_name))
    cid = str(company_id)
    for i, r in enumerate(rows):
        if str(r["company_id"]) == cid:
            return i
    return 0


def _derive_state(container: dict | None, health: dict, agent_online: bool) -> str:
    """Single source of truth for the badge. Health endpoint wins when present."""
    if health.get("available"):
        return "healthy" if health.get("healthy") else "degraded"
    if container and container.get("state") == "running":
        return "starting"          # container up but health not answering yet
    if container:
        return "stopped"           # container exists but exited
    if agent_online:
        return "stopped"           # agent sees the host, no such container
    return "unknown"               # agent offline + no health → can't tell


async def fleet_status() -> dict:
    """Per-company pipeline status for the whole fleet (super-admin view)."""
    comp_rows = await database.fetch_all(
        companies.select().order_by(companies.c.company_name))
    agent = await agent_state()
    by_name = {c.get("name"): c for c in agent["containers"]}

    async def one(idx, r):
        user = r["admin_username"]
        cid = str(r["company_id"])
        # idx = the company's unique slot (its position in the name-ordered list).
        cam_count = await database.fetch_val(
            "SELECT count(*) FROM cameras WHERE company_id = :cid AND enabled = true "
            "AND rtsp_url IS NOT NULL AND rtsp_url <> ''", {"cid": cid})
        health = await fetch_health(idx)
        cont = by_name.get(f"deepstream-{user}")
        state = _derive_state(cont, health, agent["online"])
        live = health.get("live_sources") if health.get("available") else None
        return {
            "company": r["company_name"], "admin_username": user,
            "index": idx, "state": state,
            "rtsp_port": 8555 + idx, "health_port": health_port(idx),
            "configured_cameras": int(cam_count or 0),
            "live_sources": live,
            "total_sources": health.get("total_sources"),
            "stale_sources": health.get("stale_sources"),
            "pipeline_state": health.get("pipeline_state"),
            "uptime_sec": health.get("uptime_sec"),
            "container": cont,   # {name,state,status,running_for,log} or None
        }

    pipelines = await asyncio.gather(*[one(i, r) for i, r in enumerate(comp_rows)])
    running = sum(1 for p in pipelines if p["state"] in ("healthy", "degraded", "starting"))
    cams_live = sum(p["live_sources"] or 0 for p in pipelines)
    return {
        "agent": {k: agent[k] for k in ("online", "last_seen", "age_sec", "gpus")},
        "summary": {"total": len(pipelines), "running": running,
                    "cameras_live": cams_live},
        "pipelines": pipelines,
    }

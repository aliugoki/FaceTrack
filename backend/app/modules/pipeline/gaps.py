"""Live-stream gap detection + backfill orchestration (Phase 3).

A background task polls each running pipeline's per-source health; when a camera's
feed goes stale it opens a ``stream_gaps`` row, and when frames resume it closes the
row and queues a ``backfill`` job to pull + reprocess the missed window from the NVR
(the host agent runs deepstream/tools/run_backfill.sh).

``GapDetector`` is a pure, debounced state machine (kept free of I/O so it can be
unit-tested): N consecutive stale polls open a gap, M healthy polls close it, and the
gap's start is the FIRST stale moment (not when we confirmed it).
"""
import asyncio
import datetime
import json
import logging

from app.core.db import database, companies, cameras, stream_gaps, pipeline_jobs
from app.modules.pipeline.service import company_index, fetch_health

log = logging.getLogger("gaps")

STALE_SEC = float(__import__("os").getenv("GAP_STALE_SEC", "30"))
POLL_SEC = float(__import__("os").getenv("GAP_POLL_SEC", "20"))


class GapDetector:
    def __init__(self, open_after: int = 3, close_after: int = 2):
        self.open_after = open_after
        self.close_after = close_after
        self._s: dict = {}

    def observe(self, key, is_stale: bool, now):
        """Feed one health poll for `key`. Returns ('open', start) / ('close', start, end) / None."""
        s = self._s.setdefault(key, {"down": False, "stale": 0, "up": 0, "first": None, "start": None})
        if is_stale:
            if s["stale"] == 0:
                s["first"] = now                       # remember when it actually went down
            s["stale"] += 1
            s["up"] = 0
            if not s["down"] and s["stale"] >= self.open_after:
                s["down"] = True
                s["start"] = s["first"]
                return ("open", s["start"])
        else:
            s["up"] += 1
            s["stale"] = 0
            s["first"] = None
            if s["down"] and s["up"] >= self.close_after:
                s["down"] = False
                start = s["start"]
                s["start"] = None
                return ("close", start, now)
        return None


async def _open_gap(company_id, cam_id, cam_name, start):
    await database.execute(stream_gaps.insert().values(
        company_id=company_id, camera_id=cam_id, camera_name=cam_name,
        started_at=start, status="open", created_at=datetime.datetime.now()))
    log.info("stream gap OPENED: %s @ %s", cam_name, start)


async def _close_and_queue(company_id, cam: dict, start, end):
    row = await database.fetch_one(stream_gaps.select().where(
        (stream_gaps.c.company_id == company_id)
        & (stream_gaps.c.camera_name == cam["name"])
        & (stream_gaps.c.ended_at.is_(None))).order_by(stream_gaps.c.id.desc()))
    gap_id = row["id"] if row else None
    has_nvr = bool(cam.get("nvr_host") and cam.get("nvr_channel"))
    if gap_id:
        await database.execute(stream_gaps.update().where(stream_gaps.c.id == gap_id)
                               .values(ended_at=end, status="queued" if has_nvr else "skipped"))
    if not has_nvr:
        log.info("gap CLOSED on %s (%s->%s) but no NVR configured -> no backfill", cam["name"], start, end)
        return
    comp = await database.fetch_one(companies.select().where(companies.c.company_id == company_id))
    now = datetime.datetime.now()
    payload = json.dumps({
        "gap_id": gap_id, "camera_id": cam["id"], "camera_name": cam["name"],
        "channel": cam["nvr_channel"], "start": start.isoformat(), "end": end.isoformat(),
    })
    await database.execute(pipeline_jobs.insert().values(
        company_id=str(company_id), username=comp["admin_username"] if comp else "",
        action="backfill", idx=await company_index(company_id), status="pending",
        payload=payload, created_at=now, updated_at=now))
    log.info("queued BACKFILL for %s [%s -> %s]", cam["name"], start, end)


async def _poll_once(det: GapDetector):
    now = datetime.datetime.now()
    for comp in await database.fetch_all(companies.select()):
        cid = str(comp["company_id"])
        h = await fetch_health(await company_index(cid))
        if not h.get("available"):
            continue  # pipeline not running -> not a stream gap we can backfill live
        by_name = {c["name"]: dict(c) for c in
                   await database.fetch_all(cameras.select().where(cameras.c.company_id == cid))}
        for src in h.get("sources", []):
            cam = by_name.get(src.get("id"))
            if not cam:
                continue
            stale = bool(src.get("stale")) or float(src.get("seconds_since_frame") or 0) > STALE_SEC
            ev = det.observe((cid, cam["name"]), stale, now)
            if not ev:
                continue
            if ev[0] == "open":
                await _open_gap(cid, cam["id"], cam["name"], ev[1])
            else:
                await _close_and_queue(cid, cam, ev[1], ev[2])


_task = None


async def start_monitor():
    """Launch the background gap monitor (idempotent)."""
    global _task
    if _task is not None:
        return
    det = GapDetector()

    async def loop():
        while True:
            try:
                await _poll_once(det)
            except Exception as e:  # never let the monitor die
                log.warning("gap monitor error: %s", e)
            await asyncio.sleep(POLL_SEC)

    _task = asyncio.create_task(loop())
    log.info("stream-gap monitor started (poll %ss, stale>%ss)", POLL_SEC, STALE_SEC)

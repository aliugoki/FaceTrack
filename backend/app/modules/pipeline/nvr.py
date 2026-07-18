"""Hikvision NVR footage browsing + on-demand RTSP->HLS proxy.

Two capabilities the dashboard didn't previously surface:

1. **Search** — list the recorded segments an NVR holds for a camera + time
   window (Hikvision ISAPI ``ContentMgmt/search``, digest-authed over the
   camera's HTTP/ISAPI port).
2. **Play** — register an *on-demand* MediaMTX path whose source is the NVR's
   RTSP playback URL for a window, so the recorded footage can be watched in the
   browser as HLS/WebRTC (browsers can't play RTSP directly). MediaMTX only dials
   the NVR when a viewer attaches and tears the pull down after it goes idle.

Device-specific bits (RTSP track/time formats, ISAPI XML) are isolated in the
small helpers below so they're easy to tweak per firmware. Times are treated as
the NVR's own wall-clock (the app stores naive local datetimes; Hikvision
interprets the timestamp against the device clock).
"""
import datetime
import hashlib
import logging
import re
import xml.etree.ElementTree as ET
from urllib.parse import quote

import httpx

from app.core.config import settings

log = logging.getLogger("nvr")


def has_nvr(cam) -> bool:
    return bool(cam["nvr_host"] and cam["nvr_channel"])


def _track_id(channel: int) -> str:
    # Hikvision track id for channel N main stream is "{N}01" (…02 = substream).
    return f"{int(channel)}01"


def _hik_ts(dt: datetime.datetime) -> str:
    # Hikvision playback query timestamps: YYYYMMDDThhmmssZ (device local time).
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _iso_ts(dt: datetime.datetime) -> str:
    # ISAPI search timestamps: ISO-8601 with a trailing Z.
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def playback_rtsp_url(cam, start: datetime.datetime, end: datetime.datetime) -> str:
    """Hikvision RTSP playback URL for a channel + window (creds embedded)."""
    user = quote(cam["nvr_user"] or "", safe="")
    pw = quote(cam["nvr_password"] or "", safe="")
    auth = f"{user}:{pw}@" if user else ""
    host = cam["nvr_host"]
    track = _track_id(cam["nvr_channel"])
    q = f"starttime={_hik_ts(start)}&endtime={_hik_ts(end)}"
    return (f"rtsp://{auth}{host}:{settings.NVR_RTSP_PORT}"
            f"/Streaming/tracks/{track}?{q}")


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]  # strip XML namespace


def _naive(ts: str) -> str:
    """Strip a trailing Z / ±hh:mm offset -> naive 'YYYY-MM-DDTHH:MM:SS'.

    Hikvision timestamps are the NVR's own wall-clock; the rest of the app stores
    naive-local datetimes, so we keep the clock reading and drop the tz marker to
    avoid mixing aware/naive datetimes downstream (e.g. in /backfill validation).
    """
    m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", ts or "")
    return m.group(1) if m else ts


def _findtext(el, name: str):
    for child in el.iter():
        if _localname(child.tag) == name and child.text:
            return child.text.strip()
    return None


async def search_recordings(cam, start: datetime.datetime, end: datetime.datetime,
                            max_results: int = 100) -> list[dict]:
    """Query the NVR (ISAPI) for recorded segments in [start, end].

    Returns a list of ``{"start", "end", "playback_uri"}`` (ISO strings). Raises
    on transport/auth errors so the caller can surface a clear message.
    """
    port = cam["nvr_port"] or 80
    url = f"http://{cam['nvr_host']}:{port}/ISAPI/ContentMgmt/search"
    search_id = hashlib.md5(  # noqa: S324 - not security, just a stable request id
        f"{cam['id']}:{_iso_ts(start)}:{_iso_ts(end)}".encode()).hexdigest().upper()
    body = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<CMSearchDescription>'
        f'<searchID>{search_id}</searchID>'
        f'<trackList><trackID>{_track_id(cam["nvr_channel"])}</trackID></trackList>'
        f'<timeSpanList><timeSpan><startTime>{_iso_ts(start)}</startTime>'
        f'<endTime>{_iso_ts(end)}</endTime></timeSpan></timeSpanList>'
        f'<maxResults>{int(max_results)}</maxResults>'
        '<searchResultPostion>0</searchResultPostion>'
        '<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com'
        '</metadataDescriptor></metadataList>'
        '</CMSearchDescription>'
    )
    auth = httpx.DigestAuth(cam["nvr_user"] or "", cam["nvr_password"] or "")
    async with httpx.AsyncClient(timeout=12.0) as c:
        r = await c.post(url, content=body, auth=auth,
                         headers={"Content-Type": "application/xml"})
        r.raise_for_status()
        root = ET.fromstring(r.text)

    out = []
    for item in root.iter():
        if _localname(item.tag) != "searchMatchItem":
            continue
        s = _findtext(item, "startTime")
        e = _findtext(item, "endTime")
        uri = _findtext(item, "playbackURI")
        if s and e:
            out.append({"start": _naive(s), "end": _naive(e), "playback_uri": uri})
    return out


def _play_path_name(cam_id: int, start: datetime.datetime, end: datetime.datetime) -> str:
    h = hashlib.md5(  # noqa: S324 - deterministic path name, not security
        f"{cam_id}:{_hik_ts(start)}:{_hik_ts(end)}".encode()).hexdigest()[:12]
    return f"nvrplay-{cam_id}-{h}"


async def ensure_play_path(cam, start: datetime.datetime, end: datetime.datetime) -> str:
    """Register (idempotently) an on-demand MediaMTX path for a playback window.

    Returns the MediaMTX path name; the browser plays it as HLS/WebRTC on the
    usual gateway ports. The path is on-demand, so MediaMTX only pulls the NVR
    while a viewer is attached and drops the pull ~20s after the last one leaves.
    """
    name = _play_path_name(cam["id"], start, end)
    source = playback_rtsp_url(cam, start, end)
    cfg = {
        "source": source,
        "sourceOnDemand": True,
        "sourceOnDemandStartTimeout": "15s",
        "sourceOnDemandCloseAfter": "20s",
        # NVR playback RTSP is reliable over TCP; UDP playback often stalls.
        "rtspTransport": "tcp",
    }
    api = settings.MEDIAMTX_API_URL.rstrip("/")
    async with httpx.AsyncClient(timeout=6.0) as c:
        r = await c.post(f"{api}/v3/config/paths/add/{name}", json=cfg)
        if r.status_code == 400:
            # Already configured (e.g. a prior play of the same window) — update
            # it in place so a changed source/cred still takes effect.
            r = await c.patch(f"{api}/v3/config/paths/patch/{name}", json=cfg)
        r.raise_for_status()
    log.info("nvr play path ready: %s", name)
    return name


async def remove_play_path(name: str) -> None:
    """Best-effort teardown of a play path (called when the viewer is done)."""
    if not name.startswith("nvrplay-"):
        return
    api = settings.MEDIAMTX_API_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=6.0) as c:
            await c.delete(f"{api}/v3/config/paths/delete/{name}")
    except Exception as e:  # teardown is best-effort; on-demand idle-close covers it
        log.info("nvr play path delete failed (%s): %s", name, e)

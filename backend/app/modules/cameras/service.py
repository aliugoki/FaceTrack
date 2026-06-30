"""Per-company camera management.

Each enabled camera that feeds the pipeline also gets a deterministic
``stream_path`` — the MediaMTX path its annotated live stream is published at.
The path is ``{admin_username}_cam{i}`` where ``i`` is the camera's 0-based
position among the company's enabled, RTSP-backed cameras ordered by name.
This MUST match the pipeline's per-camera RTSP mounts (``/cam{i}`` on the
company's RTSP port) and the MediaMTX paths generated from the same ordering
(see deepstream/tools/gen_company_config.py + gen_mediamtx_paths.py).

The browser-facing HLS/WebRTC URLs are built from this path on the client
(host-relative), so no host/IP is baked in here. ``hls_url`` / ``webrtc_url``
remain supported as optional manual overrides.
"""
import json

from sqlalchemy import delete
from app.core.db import database, cameras, companies

FIELDS = ("name", "location", "type", "rtsp_url", "hls_url", "webrtc_url", "enabled")


def _eligible(r):
    """Cameras the pipeline streams: enabled with a non-empty RTSP source."""
    return bool(r["enabled"]) and bool((r["rtsp_url"] or "").strip())


def _parse_area(raw):
    """detection_area is stored as a JSON string ([[x,y],...] normalized 0..1);
    return it as a list for the API (or None)."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _row(r, stream_path=None):
    d = {k: r[k] for k in ("id", "company_id", *FIELDS)}
    d["created_at"] = r["created_at"].isoformat() if r["created_at"] else None
    d["stream_path"] = stream_path
    d["detection_area"] = _parse_area(r["detection_area"])
    return d


def _company_cameras(rows, username, company_name=None):
    """Build camera dicts for one company, assigning stream_path by the canonical
    0-based ordering among that company's eligible cameras."""
    out, i = [], 0
    for r in rows:
        path = None
        if username and _eligible(r):
            path = f"{username}_cam{i}"
            i += 1
        d = _row(r, path)
        if company_name is not None:
            d["company_name"] = company_name
        out.append(d)
    return out


async def list_cameras(company_id):
    rows = await database.fetch_all(
        cameras.select().where(cameras.c.company_id == company_id).order_by(cameras.c.name))
    comp = await database.fetch_one(
        companies.select().where(companies.c.company_id == company_id))
    username = comp["admin_username"] if comp else None
    return _company_cameras(rows, username)


async def list_live_cameras(principal):
    """Cameras for the Live Wall. A cross-tenant viewer (super-admin, has
    ``view_tenants``) sees every company's eligible cameras — each with its own
    company's ``stream_path`` and a ``company_name`` label — so the whole fleet's
    live streams are visible from one place. Everyone else sees only their own
    company. (Per-company camera *management* still uses ``list_cameras``.)"""
    if "view_tenants" not in getattr(principal, "permissions", []):
        return await list_cameras(principal.company_id)
    comps = await database.fetch_all(
        companies.select().order_by(companies.c.company_name))
    out = []
    for comp in comps:
        rows = await database.fetch_all(
            cameras.select().where(cameras.c.company_id == comp["company_id"])
            .order_by(cameras.c.name))
        out.extend(_company_cameras(rows, comp["admin_username"], comp["company_name"]))
    return out


def _area_to_db(data, vals):
    """Serialize a detection_area polygon (list) to its JSON-string column value."""
    if "detection_area" in data and data["detection_area"] is not None:
        vals["detection_area"] = json.dumps(data["detection_area"])


async def create(company_id, data):
    vals = {k: data.get(k) for k in FIELDS}
    vals["enabled"] = bool(data.get("enabled", True))
    _area_to_db(data, vals)
    return await database.execute(cameras.insert().values(company_id=company_id, **vals))


async def update(company_id, cid, data):
    vals = {k: data[k] for k in FIELDS if k in data and data[k] is not None}
    _area_to_db(data, vals)
    if vals:
        await database.execute(cameras.update()
            .where((cameras.c.id == cid) & (cameras.c.company_id == company_id)).values(**vals))


async def remove(company_id, cid):
    await database.execute(delete(cameras)
        .where((cameras.c.id == cid) & (cameras.c.company_id == company_id)))

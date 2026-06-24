"""Per-company camera management."""
from sqlalchemy import delete
from app.core.db import database, cameras

FIELDS = ("name", "location", "type", "rtsp_url", "hls_url", "webrtc_url", "enabled")


def _row(r):
    d = {k: r[k] for k in ("id", "company_id", *FIELDS)}
    d["created_at"] = r["created_at"].isoformat() if r["created_at"] else None
    return d


async def list_cameras(company_id):
    rows = await database.fetch_all(
        cameras.select().where(cameras.c.company_id == company_id).order_by(cameras.c.name))
    return [_row(r) for r in rows]


async def create(company_id, data):
    vals = {k: data.get(k) for k in FIELDS}
    vals["enabled"] = bool(data.get("enabled", True))
    return await database.execute(cameras.insert().values(company_id=company_id, **vals))


async def update(company_id, cid, data):
    vals = {k: data[k] for k in FIELDS if k in data and data[k] is not None}
    if vals:
        await database.execute(cameras.update()
            .where((cameras.c.id == cid) & (cameras.c.company_id == company_id)).values(**vals))


async def remove(company_id, cid):
    await database.execute(delete(cameras)
        .where((cameras.c.id == cid) & (cameras.c.company_id == company_id)))

"""Recordings listing (manage_cameras). File streaming is in main.py (path-safe)."""
from fastapi import APIRouter, Depends, Query

from app.core.deps import Principal, require
from app.modules.recordings import service

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.get("")
async def list_recordings(limit: int = Query(500, le=2000), p: Principal = Depends(require("manage_cameras"))):
    return service.list_recordings(limit)

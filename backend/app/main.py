"""FastAPI application factory — wires modules, Socket.IO, lifespan."""
import os
import logging
from contextlib import asynccontextmanager

import httpx
import socketio
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.db import connect_and_init, disconnect, database, companies
from app.modules.realtime.socket import sio
from app.modules.auth.router import router as auth_router
from app.modules.attendance.router import router as attendance_router
from app.modules.employees.router import router as employees_router
from app.modules.reports.router import router as reports_router
from app.modules.erp.router import router as erp_router
from app.modules.users.router import router as users_router
from app.modules.tenants.router import router as tenants_router
from app.modules.audit.router import router as audit_router
from app.modules.settings.router import router as settings_router
from app.modules.cameras.router import router as cameras_router
from app.modules.companies.router import router as companies_router
from app.modules.recordings.router import router as recordings_router
from app.modules.pipeline.router import router as pipeline_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_and_init()
    log.info("Attendance API ready")
    yield
    await disconnect()


app = FastAPI(title="Attendance System API", version="2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.CORS_ORIGINS, allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"])

for r in (auth_router, attendance_router, employees_router, reports_router,
          erp_router, users_router, tenants_router, audit_router, settings_router,
          cameras_router, companies_router, recordings_router, pipeline_router):
    app.include_router(r)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/pipeline-health")
async def pipeline_health():
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            r = await c.get(settings.PIPELINE_HEALTH_URL)
            return {"available": True, **r.json()}
    except Exception as e:
        return {"available": False, "reason": str(e)}


@app.get("/api/recordings/file/{path:path}")
async def recording_file(path: str):
    """Stream a recording (path-safe; Starlette FileResponse handles Range)."""
    base = os.path.realpath(settings.RECORDINGS_DIR)
    full = os.path.realpath(os.path.join(base, path))
    if not full.startswith(base + os.sep) or not os.path.isfile(full):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "recording not found")
    return FileResponse(full)


@app.get("/api/captures/{path:path}")
async def capture_image(path: str):
    """Serve a stored live snapshot (path-safe within CAPTURES_DIR)."""
    base = os.path.realpath(settings.CAPTURES_DIR)
    full = os.path.realpath(os.path.join(base, path))
    if not full.startswith(base + os.sep) or not os.path.isfile(full):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "capture not found")
    return FileResponse(full)


@app.get("/api/images/{company_id}/{filename}")
async def company_image(company_id: str, filename: str):
    """Serve a face image (path-safe). Folder resolved from the company row."""
    row = await database.fetch_one(
        companies.select().where(companies.c.company_id == company_id))
    folder = (row["company_image_folder"] if row and row["company_image_folder"] else company_id)
    safe = os.path.basename(filename)
    path = os.path.join(settings.COMPANY_IMAGES_ROOT, folder, safe)
    if not os.path.isfile(path):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "image not found")
    return FileResponse(path)


# --- Serve the built React SPA (single-origin production) ---
# Mounted LAST so /api/* and /socket.io/* (registered above) keep priority.
if os.path.isdir(settings.FRONTEND_DIST):
    from fastapi.staticfiles import StaticFiles
    from starlette.requests import Request

    _assets = os.path.join(settings.FRONTEND_DIST, "assets")
    if os.path.isdir(_assets):
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    _index = os.path.join(settings.FRONTEND_DIST, "index.html")

    @app.get("/{full_path:path}")
    async def spa(full_path: str, request: Request):
        # Real files (favicon etc.) served directly; everything else → index.html
        # so client-side routes (/attendance, /reports, …) work on refresh.
        candidate = os.path.join(settings.FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(_index)

    log.info("Serving SPA from %s", settings.FRONTEND_DIST)


# ASGI entrypoint (Socket.IO wraps FastAPI). Run: uvicorn app.main:application
application = socketio.ASGIApp(sio, app)


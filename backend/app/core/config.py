"""Application configuration — env-driven (no secrets hardcoded)."""
import os
import datetime
from dotenv import load_dotenv

load_dotenv()  # loads backend/.env when present


def _csv(v: str) -> list[str]:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


class Settings:
    # Database (must be provided via env / .env — never hardcoded here)
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")

    # Auth / RBAC
    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-me-in-env")
    SESSION_COOKIE_NAME: str = os.getenv("SESSION_COOKIE_NAME", "session_token")
    SUPERADMIN_USERS: set[str] = set(_csv(os.getenv("SUPERADMIN_USERS", "")))

    # Business rules
    STANDARD_START_TIME: datetime.time = datetime.time(
        *(int(x) for x in os.getenv("STANDARD_START_TIME", "09:00").split(":")))

    # ERP / external sync
    EXTERNAL_SYNC_TIMEOUT: int = int(os.getenv("EXTERNAL_SYNC_TIMEOUT", "10"))

    # Pipeline health proxy
    PIPELINE_HEALTH_URL: str = os.getenv("PIPELINE_HEALTH_URL", "http://localhost:9108/healthz")

    # CORS for the React dev server (Vite). Built assets are served same-origin.
    CORS_ORIGINS: list[str] = _csv(os.getenv("CORS_ORIGINS", "http://localhost:5174,http://127.0.0.1:5174"))

    # Where company face images live (served read-only)
    COMPANY_IMAGES_ROOT: str = os.getenv("COMPANY_IMAGES_ROOT", "/home/meta/deploy/test/data/company_images")

    # Live recognition snapshots (proof-of-presence) captured by the pipeline
    CAPTURES_DIR: str = os.getenv("CAPTURES_DIR", "/app/captures")

    # MediaMTX video recordings to browse/play
    RECORDINGS_DIR: str = os.getenv("RECORDINGS_DIR", "/recordings")

    # Shared secret for the host-side pipeline agent (empty = agent disabled)
    AGENT_TOKEN: str = os.getenv("AGENT_TOKEN", "")

    # MediaMTX control API (same host, host-networked) — used to spin up on-demand
    # RTSP->HLS proxy paths for browsing recorded NVR footage in the browser.
    MEDIAMTX_API_URL: str = os.getenv("MEDIAMTX_API_URL", "http://127.0.0.1:9997")
    # RTSP port on the NVR for playback pulls (Hikvision default 554). ISAPI/HTTP
    # search uses each camera's nvr_port (default 80) instead.
    NVR_RTSP_PORT: int = int(os.getenv("NVR_RTSP_PORT", "554"))

    # Face models for in-dashboard employee enrollment (res10 detector + ArcFace)
    MODELS_DIR: str = os.getenv("MODELS_DIR", "/app/models")

    PORT: int = int(os.getenv("PORT", "5002"))

    # Built React SPA to serve (single-origin production). Empty in dev (Vite serves).
    FRONTEND_DIST: str = os.getenv(
        "FRONTEND_DIST", "/home/meta/deploy/attendance-system/frontend/dist")


settings = Settings()

"""Database instance + table definitions (shared across modules).

Uses the async `databases` library over the existing `facial_recognition_db`.
Table objects are SQLAlchemy Core (no ORM) — lightweight and explicit.
"""
import datetime
import logging

from databases import Database
from sqlalchemy import (MetaData, Table, Column, String, Integer, DateTime,
                        Date, Boolean, Float)

from app.core.config import settings

log = logging.getLogger("db")
database = Database(settings.DATABASE_URL, min_size=5, max_size=20)
metadata = MetaData()

companies = Table(
    "companies", metadata,
    Column("company_id", String, unique=True, index=True),
    Column("company_name", String),
    Column("admin_username", String),
    Column("admin_password_hash", String),
    Column("company_image_folder", String),
    Column("session_token", String, nullable=True),
    Column("api_key", String, nullable=True),
    Column("status", String, nullable=True),
    Column("rtsp_url", String, nullable=True),
    Column("webrtc_url", String, nullable=True),
    Column("attendance_api", String, nullable=True),
)

attendance = Table(
    "attendance_logs", metadata,
    Column("id", Integer, primary_key=True),
    Column("company_id", String, index=True),
    Column("emp_id", String, nullable=False),
    Column("first_name", String, nullable=False),
    Column("last_name", String, nullable=False),
    Column("attendance_time", DateTime, default=datetime.datetime.now),
    Column("attendance_date", Date, nullable=False),
    Column("check_type", String, nullable=False, default="in"),
    Column("check_in_id", Integer, nullable=True),
    Column("image_url", String, nullable=True),
    Column("camera_name", String, nullable=True),
    Column("sent_to_webhook", Boolean, nullable=True),
    Column("webhook_response", String, nullable=True),
    Column("status", String, nullable=True, default="Unknown"),
)

user_data = Table(
    "user_data", metadata,
    Column("user_id", String, primary_key=True),
    Column("company_id", String, index=True),
    Column("emp_id", String, unique=True, index=True),
    Column("first_name", String, nullable=False),
    Column("last_name", String, nullable=False),
    Column("image_path", String),
    Column("feature_path", String),
    Column("registration_date", DateTime, default=datetime.datetime.now),
)

dashboard_users = Table(
    "dashboard_users", metadata,
    Column("id", Integer, primary_key=True),
    Column("company_id", String, index=True),
    Column("username", String, unique=True, index=True),
    Column("password_hash", String),
    Column("role", String, default="viewer"),
    Column("created_at", DateTime, default=datetime.datetime.now),
)

user_sessions = Table(
    "user_sessions", metadata,
    Column("token", String, primary_key=True),
    Column("user_id", Integer),
    Column("company_id", String, index=True),
    Column("role", String),
    Column("created_at", DateTime, default=datetime.datetime.now),
)

audit_log = Table(
    "audit_log", metadata,
    Column("id", Integer, primary_key=True),
    Column("company_id", String, index=True),
    Column("actor", String),
    Column("role", String),
    Column("action", String),
    Column("detail", String, nullable=True),
    Column("ip", String, nullable=True),
    Column("created_at", DateTime, default=datetime.datetime.now),
)

tenant_settings = Table(
    "tenant_settings", metadata,
    Column("company_id", String, primary_key=True),
    Column("start_time", String, default="09:00"),
    Column("grace_minutes", Integer, default=0),
    Column("workdays", String, default="1,2,3,4,5"),   # ISO weekday 1=Mon..7=Sun
    Column("timezone", String, default="Asia/Karachi"),
    # Shift end + optional unpaid break window (HH:MM). break_* NULL = no break.
    Column("end_time", String, default="18:00"),
    Column("break_start", String, nullable=True),
    Column("break_end", String, nullable=True),
    # Threshold-based status classification (all in minutes).
    Column("early_leave_grace_minutes", Integer, default=0),
    Column("half_day_after_minutes", Integer, default=240),
    Column("min_work_minutes", Integer, default=0),
    Column("overtime_after_minutes", Integer, default=0),   # 0 = overtime disabled
    # Recordings retention in days: NULL = MediaMTX default (48h), 0 = keep forever.
    Column("recordings_retention_days", Integer, nullable=True),
    # Per-company face-recognition tuning (fed into the pipeline config at launch):
    #   rec_threshold  cosine match cutoff (higher = stricter, fewer false matches)
    #   rec_margin     min gap best vs 2nd-best (guards ambiguous look-alikes)
    #   rec_min_votes  consecutive frames before an identity is committed
    Column("rec_threshold", Float, default=0.35),
    Column("rec_margin", Float, default=0.05),
    Column("rec_min_votes", Integer, default=3),
    Column("updated_at", DateTime, default=datetime.datetime.now),
)

holidays = Table(
    "holidays", metadata,
    Column("id", Integer, primary_key=True),
    Column("company_id", String, index=True),
    Column("day", Date, nullable=False),
    Column("name", String),
)

pipeline_jobs = Table(
    "pipeline_jobs", metadata,
    Column("id", Integer, primary_key=True),
    Column("company_id", String, index=True),
    Column("username", String),
    Column("action", String, default="start"),     # start|stop|restart|mediamtx_sync|backfill
    Column("idx", Integer, default=0),
    Column("status", String, default="pending"),    # pending | running | done | failed
    Column("log", String, nullable=True),
    Column("payload", String, nullable=True),        # JSON extras (e.g. backfill params)
    Column("created_at", DateTime, default=datetime.datetime.now),
    Column("updated_at", DateTime, default=datetime.datetime.now),
)

cameras = Table(
    "cameras", metadata,
    Column("id", Integer, primary_key=True),
    Column("company_id", String, index=True),
    Column("name", String, nullable=False),
    Column("location", String, nullable=True),
    Column("type", String, default="entrance"),     # entrance | exit | general
    Column("rtsp_url", String, nullable=True),       # source (for the pipeline)
    Column("hls_url", String, nullable=True),        # playback (MediaMTX HLS)
    Column("webrtc_url", String, nullable=True),     # playback (MediaMTX WebRTC)
    Column("enabled", Boolean, default=True),
    # Detection zone: JSON string of a polygon [[x,y],...] normalized to 0..1.
    # Attendance only triggers inside it; null/empty = whole frame. Drawn per
    # camera in the dashboard; consumed by deepstream/tools/gen_company_config.py.
    Column("detection_area", String, nullable=True),
    # NVR access for gap backfill (Hikvision ISAPI). When the live stream drops,
    # the on-site NVR keeps recording; we fetch the missed window from here.
    Column("nvr_host", String, nullable=True),
    Column("nvr_port", Integer, nullable=True),      # ISAPI/HTTP port (default 80)
    Column("nvr_user", String, nullable=True),
    Column("nvr_password", String, nullable=True),
    Column("nvr_channel", Integer, nullable=True),   # NVR channel number (1-based)
    Column("created_at", DateTime, default=datetime.datetime.now),
)

# Detected live-stream outages per camera. A background monitor opens a row when a
# source goes stale and closes it (sets ended_at) when frames resume; on close a
# backfill job is queued to pull + reprocess the missed footage from the NVR.
stream_gaps = Table(
    "stream_gaps", metadata,
    Column("id", Integer, primary_key=True),
    Column("company_id", String, index=True),
    Column("camera_id", Integer, nullable=True),
    Column("camera_name", String, nullable=True),
    Column("started_at", DateTime, nullable=False),
    Column("ended_at", DateTime, nullable=True),          # null = still down
    Column("status", String, default="open"),             # open|queued|done|failed|skipped
    Column("created_at", DateTime, default=datetime.datetime.now),
)

# Latest heartbeat from the host-side pipeline agent (single row, id=1): a JSON
# snapshot of deepstream-* containers + GPU telemetry. Lets the control panel
# show container state/logs/GPU though the web app never touches docker itself.
pipeline_agent_state = Table(
    "pipeline_agent_state", metadata,
    Column("id", Integer, primary_key=True),
    Column("payload", String),
    Column("updated_at", DateTime, default=datetime.datetime.now),
)


async def connect_and_init():
    await database.connect()
    log.info("PostgreSQL connected")
    # RBAC tables (idempotent, additive)
    await database.execute("""CREATE TABLE IF NOT EXISTS dashboard_users (
        id SERIAL PRIMARY KEY, company_id TEXT, username TEXT UNIQUE,
        password_hash TEXT, role TEXT DEFAULT 'viewer', created_at TIMESTAMP DEFAULT now())""")
    await database.execute("""CREATE TABLE IF NOT EXISTS user_sessions (
        token TEXT PRIMARY KEY, user_id INTEGER, company_id TEXT, role TEXT,
        created_at TIMESTAMP DEFAULT now())""")
    await database.execute("""CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY, company_id TEXT, actor TEXT, role TEXT, action TEXT,
        detail TEXT, ip TEXT, created_at TIMESTAMP DEFAULT now())""")
    await database.execute("""CREATE TABLE IF NOT EXISTS tenant_settings (
        company_id TEXT PRIMARY KEY, start_time TEXT DEFAULT '09:00',
        grace_minutes INTEGER DEFAULT 0, workdays TEXT DEFAULT '1,2,3,4,5',
        timezone TEXT DEFAULT 'Asia/Karachi', updated_at TIMESTAMP DEFAULT now())""")
    # Additive: enterprise policy fields (shift end, break window, thresholds, retention).
    # recordings_retention_days stays NULL for existing rows -> generator keeps 48h default.
    for _col, _type in (
        ("end_time", "TEXT DEFAULT '18:00'"),
        ("break_start", "TEXT"),
        ("break_end", "TEXT"),
        ("early_leave_grace_minutes", "INTEGER DEFAULT 0"),
        ("half_day_after_minutes", "INTEGER DEFAULT 240"),
        ("min_work_minutes", "INTEGER DEFAULT 0"),
        ("overtime_after_minutes", "INTEGER DEFAULT 0"),
        ("recordings_retention_days", "INTEGER"),
        ("rec_threshold", "REAL DEFAULT 0.35"),
        ("rec_margin", "REAL DEFAULT 0.05"),
        ("rec_min_votes", "INTEGER DEFAULT 3"),
    ):
        await database.execute(
            f"ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS {_col} {_type}")
    await database.execute("""CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY, company_id TEXT, day DATE NOT NULL, name TEXT)""")
    await database.execute("""CREATE TABLE IF NOT EXISTS pipeline_jobs (
        id SERIAL PRIMARY KEY, company_id TEXT, username TEXT, action TEXT DEFAULT 'start',
        idx INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', log TEXT,
        created_at TIMESTAMP DEFAULT now(), updated_at TIMESTAMP DEFAULT now())""")
    await database.execute("""CREATE TABLE IF NOT EXISTS cameras (
        id SERIAL PRIMARY KEY, company_id TEXT, name TEXT NOT NULL, location TEXT,
        type TEXT DEFAULT 'entrance', rtsp_url TEXT, hls_url TEXT, webrtc_url TEXT,
        enabled BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT now())""")
    # Additive: per-camera detection zone (JSON polygon, normalized 0..1).
    await database.execute(
        "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS detection_area TEXT")
    # Additive: per-camera NVR access (for gap backfill) + the gaps ledger + a
    # generic job payload (backfill params: camera/channel/time-range).
    for _c, _t in (("nvr_host", "TEXT"), ("nvr_port", "INTEGER"), ("nvr_user", "TEXT"),
                   ("nvr_password", "TEXT"), ("nvr_channel", "INTEGER")):
        await database.execute(f"ALTER TABLE cameras ADD COLUMN IF NOT EXISTS {_c} {_t}")
    await database.execute("""CREATE TABLE IF NOT EXISTS stream_gaps (
        id SERIAL PRIMARY KEY, company_id TEXT, camera_id INTEGER, camera_name TEXT,
        started_at TIMESTAMP NOT NULL, ended_at TIMESTAMP, status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT now())""")
    await database.execute("ALTER TABLE pipeline_jobs ADD COLUMN IF NOT EXISTS payload TEXT")
    await database.execute("""CREATE TABLE IF NOT EXISTS pipeline_agent_state (
        id INTEGER PRIMARY KEY, payload TEXT, updated_at TIMESTAMP DEFAULT now())""")


async def disconnect():
    await database.disconnect()

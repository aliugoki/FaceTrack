"""Settings: attendance policy + holidays (manage_settings permission)."""
import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator, model_validator

from app.core.deps import Principal, get_principal, require
from app.modules.settings import service
from app.modules.pipeline import service as pipeline_service
from app.modules.audit import service as audit

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _to_min(hhmm: str) -> int:
    h, m = (int(x) for x in hhmm.split(":")[:2])
    return h * 60 + m


class PolicyIn(BaseModel):
    start_time: str | None = None
    end_time: str | None = None
    break_start: str | None = None
    break_end: str | None = None
    grace_minutes: int | None = None
    early_leave_grace_minutes: int | None = None
    half_day_after_minutes: int | None = None
    min_work_minutes: int | None = None
    overtime_after_minutes: int | None = None
    workdays: str | None = None
    timezone: str | None = None
    recordings_retention_days: int | None = None
    rec_threshold: float | None = None
    rec_margin: float | None = None
    rec_min_votes: int | None = None

    @field_validator("rec_threshold")
    @classmethod
    def _thr(cls, v):
        if v is not None and not 0 < v <= 1:
            raise ValueError("rec_threshold must be between 0 (exclusive) and 1")
        return v

    @field_validator("rec_margin")
    @classmethod
    def _mar(cls, v):
        if v is not None and not 0 <= v <= 1:
            raise ValueError("rec_margin must be between 0 and 1")
        return v

    @field_validator("rec_min_votes")
    @classmethod
    def _votes(cls, v):
        if v is not None and v < 1:
            raise ValueError("rec_min_votes must be >= 1")
        return v

    @field_validator("start_time", "end_time", "break_start", "break_end")
    @classmethod
    def _valid_hhmm(cls, v):
        if v in (None, ""):
            return None
        try:
            h, m = (int(x) for x in str(v).split(":")[:2])
            assert 0 <= h < 24 and 0 <= m < 60
        except Exception:
            raise ValueError("time must be HH:MM (24-hour)")
        return f"{h:02d}:{m:02d}"

    @field_validator("grace_minutes", "early_leave_grace_minutes", "half_day_after_minutes",
                     "min_work_minutes", "overtime_after_minutes", "recordings_retention_days")
    @classmethod
    def _non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("must be >= 0")
        return v

    @model_validator(mode="after")
    def _coherent(self):
        if self.start_time and self.end_time and _to_min(self.end_time) <= _to_min(self.start_time):
            raise ValueError("end_time must be after start_time")
        if bool(self.break_start) ^ bool(self.break_end):
            raise ValueError("break_start and break_end must be set together")
        if self.break_start and self.break_end:
            if _to_min(self.break_end) <= _to_min(self.break_start):
                raise ValueError("break_end must be after break_start")
            if self.start_time and self.end_time and not (
                    _to_min(self.start_time) <= _to_min(self.break_start)
                    and _to_min(self.break_end) <= _to_min(self.end_time)):
                raise ValueError("break must fall within the shift (start..end)")
        return self


class HolidayIn(BaseModel):
    day: str
    name: str = ""


@router.get("")
async def get_settings(p: Principal = Depends(get_principal)):
    return {"policy": await service.get_settings(p.company_id), "holidays": await service.list_holidays(p.company_id)}


@router.put("")
async def update_settings(body: PolicyIn, p: Principal = Depends(require("manage_settings"))):
    # exclude_unset (not exclude_none) so a client can clear break_start/break_end
    # or reset retention to NULL by explicitly sending null.
    data = body.model_dump(exclude_unset=True)
    prev = await service.get_settings(p.company_id)
    out = await service.update_settings(p.company_id, data)
    await audit.record(p.company_id, p.actor, p.role, "settings.update", data)
    # Retention is enforced natively by MediaMTX; push a config sync when it changes.
    retention_changed = ("recordings_retention_days" in data
                         and data["recordings_retention_days"] != prev.get("recordings_retention_days"))
    synced = bool(retention_changed and await pipeline_service.enqueue_mediamtx_sync(p.company_id))
    # Recognition tuning is baked into the pipeline config at launch; restart to apply.
    rec_changed = any(k in data and data[k] != prev.get(k)
                      for k in ("rec_threshold", "rec_margin", "rec_min_votes"))
    restarted = bool(rec_changed and await pipeline_service.enqueue_restart_on_change(p.company_id))
    return {**out, "retention_sync_queued": synced, "pipeline_restart_queued": restarted}


@router.post("/holidays")
async def add_holiday(body: HolidayIn, p: Principal = Depends(require("manage_settings"))):
    try:
        day = datetime.date.fromisoformat(body.day)
    except Exception:
        raise HTTPException(400, "day must be YYYY-MM-DD")
    await service.add_holiday(p.company_id, day, body.name)
    await audit.record(p.company_id, p.actor, p.role, "holiday.add", f"{body.day} {body.name}")
    return {"status": "ok"}


@router.delete("/holidays/{hid}")
async def del_holiday(hid: int, p: Principal = Depends(require("manage_settings"))):
    await service.del_holiday(p.company_id, hid)
    await audit.record(p.company_id, p.actor, p.role, "holiday.delete", str(hid))
    return {"status": "ok"}

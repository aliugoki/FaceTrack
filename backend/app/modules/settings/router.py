"""Settings: attendance policy + holidays (manage_settings permission)."""
import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import Principal, get_principal, require
from app.modules.settings import service
from app.modules.audit import service as audit

router = APIRouter(prefix="/api/settings", tags=["settings"])


class PolicyIn(BaseModel):
    start_time: str | None = None
    grace_minutes: int | None = None
    workdays: str | None = None
    timezone: str | None = None


class HolidayIn(BaseModel):
    day: str
    name: str = ""


@router.get("")
async def get_settings(p: Principal = Depends(get_principal)):
    return {"policy": await service.get_settings(p.company_id), "holidays": await service.list_holidays(p.company_id)}


@router.put("")
async def update_settings(body: PolicyIn, p: Principal = Depends(require("manage_settings"))):
    out = await service.update_settings(p.company_id, body.model_dump(exclude_none=True))
    await audit.record(p.company_id, p.actor, p.role, "settings.update", body.model_dump(exclude_none=True))
    return out


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

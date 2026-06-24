"""Reporting routes."""
import datetime

from fastapi import APIRouter, Depends, Query

from app.core.deps import Principal, require
from app.modules.reports import service

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _date(s, default):
    try:
        return datetime.datetime.strptime(s, "%Y-%m-%d").date()
    except Exception:
        return default


@router.get("")
async def report(from_: str = Query(None, alias="from"), to: str = Query(None),
                 p: Principal = Depends(require("view_reports"))):
    today = datetime.date.today()
    d_from = _date(from_, today - datetime.timedelta(days=29))
    d_to = _date(to, today)
    return await service.build_report(p.company_id, d_from, d_to)

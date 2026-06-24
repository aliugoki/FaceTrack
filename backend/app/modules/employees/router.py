"""Employee directory + attendance card routes."""
import datetime

from fastapi import APIRouter, Depends

from app.core.deps import Principal, get_principal
from app.modules.employees import service

router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.get("")
async def list_employees(p: Principal = Depends(get_principal)):
    return await service.list_employees(p.company_id)


@router.get("/{emp_id}")
async def employee_card(emp_id: str, month: str | None = None, p: Principal = Depends(get_principal)):
    today = datetime.date.today()
    try:
        y, m = (int(x) for x in month.split("-")[:2]) if month else (today.year, today.month)
    except Exception:
        y, m = today.year, today.month
    return await service.employee_card(p.company_id, emp_id, y, m)

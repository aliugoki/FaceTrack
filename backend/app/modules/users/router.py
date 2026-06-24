"""RBAC user management routes (manage_users permission)."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, delete

from app.core.db import database, dashboard_users, user_sessions
from app.core.security import generate_password_hash, ASSIGNABLE_ROLES
from app.core.deps import Principal, require
from app.modules.audit import service as audit

router = APIRouter(prefix="/api/users", tags=["users"])


class UserIn(BaseModel):
    username: str
    password: str
    role: str = "viewer"


@router.get("")
async def list_users(p: Principal = Depends(require("manage_users"))):
    rows = await database.fetch_all(
        select(dashboard_users.c.id, dashboard_users.c.username, dashboard_users.c.role,
               dashboard_users.c.created_at).where(dashboard_users.c.company_id == p.company_id)
        .order_by(dashboard_users.c.username))
    return [{"id": r["id"], "username": r["username"], "role": r["role"],
             "created_at": r["created_at"].isoformat() if r["created_at"] else None} for r in rows]


@router.post("")
async def create_user(body: UserIn, p: Principal = Depends(require("manage_users"))):
    if not body.username.strip() or len(body.password) < 6:
        raise HTTPException(400, "username required, password >= 6 chars")
    if body.role not in ASSIGNABLE_ROLES:
        raise HTTPException(400, f"role must be one of {ASSIGNABLE_ROLES}")
    if await database.fetch_one(select(dashboard_users.c.id).where(dashboard_users.c.username == body.username.strip())):
        raise HTTPException(409, "username already taken")
    await database.execute(dashboard_users.insert().values(
        company_id=p.company_id, username=body.username.strip(),
        password_hash=generate_password_hash(body.password), role=body.role))
    await audit.record(p.company_id, p.actor, p.role, "user.create", f"{body.username.strip()}:{body.role}")
    return {"status": "ok"}


@router.delete("/{uid}")
async def delete_user(uid: int, p: Principal = Depends(require("manage_users"))):
    row = await database.fetch_one(dashboard_users.select().where(
        (dashboard_users.c.id == uid) & (dashboard_users.c.company_id == p.company_id)))
    if not row:
        raise HTTPException(404, "not found")
    await database.execute(delete(user_sessions).where(user_sessions.c.user_id == uid))
    await database.execute(delete(dashboard_users).where(dashboard_users.c.id == uid))
    await audit.record(p.company_id, p.actor, p.role, "user.delete", row["username"])
    return {"status": "deleted"}

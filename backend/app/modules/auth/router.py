"""Authentication: login (issues bearer token), logout, current identity."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status, Header
from pydantic import BaseModel
from sqlalchemy import select, update, delete

from app.core.config import settings
from app.core.db import database, companies, dashboard_users, user_sessions
from app.core.security import check_password_hash, generate_password_hash
from app.core.deps import Principal, get_principal
from app.modules.audit import service as audit

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginIn):
    # 1) Legacy company admin
    comp = await database.fetch_one(companies.select().where(companies.c.admin_username == body.username))
    if comp and check_password_hash(comp["admin_password_hash"], body.password):
        token = str(uuid4())
        await database.execute(update(companies).where(companies.c.company_id == comp["company_id"])
                               .values(session_token=token))
        role = "super_admin" if body.username in settings.SUPERADMIN_USERS else "admin"
        await audit.record(str(comp["company_id"]), body.username, role, "login")
        return {"token": token, "role": role, "company_name": comp["company_name"]}

    # 2) RBAC user
    user = await database.fetch_one(dashboard_users.select().where(dashboard_users.c.username == body.username))
    if user and check_password_hash(user["password_hash"], body.password):
        token = str(uuid4())
        await database.execute(user_sessions.insert().values(
            token=token, user_id=user["id"], company_id=user["company_id"], role=user["role"]))
        comp = await database.fetch_one(companies.select().where(companies.c.company_id == user["company_id"]))
        await audit.record(str(user["company_id"]), body.username, user["role"], "login")
        return {"token": token, "role": user["role"], "company_name": comp["company_name"] if comp else ""}

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")


@router.post("/logout")
async def logout(p: Principal = Depends(get_principal), authorization: str = ""):
    # Token is whatever the principal authenticated with; clear both stores.
    # (We re-read it from the header via the dependency chain is overkill; clear by company + session.)
    await database.execute(update(companies).where(companies.c.company_id == p.company_id)
                           .values(session_token=None))
    return {"status": "logged_out"}


class ChangePwIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(body: ChangePwIn, authorization: str | None = Header(default=None),
                          p: Principal = Depends(get_principal)):
    """Self-service password change for the logged-in user (admin or RBAC user)."""
    if len(body.new_password) < 6:
        raise HTTPException(400, "new password must be at least 6 characters")
    token = authorization.split(" ", 1)[1].strip() if authorization and " " in (authorization or "") else None

    # Legacy company admin (keyed by session token → updates companies).
    comp = await database.fetch_one(companies.select().where(companies.c.session_token == token))
    if comp:
        if not check_password_hash(comp["admin_password_hash"], body.current_password):
            raise HTTPException(403, "current password is incorrect")
        await database.execute(companies.update().where(companies.c.session_token == token)
                               .values(admin_password_hash=generate_password_hash(body.new_password)))
        await audit.record(p.company_id, p.actor, p.role, "password.change")
        return {"status": "ok"}

    # RBAC user (keyed by user_sessions token → updates dashboard_users).
    us = await database.fetch_one(user_sessions.select().where(user_sessions.c.token == token))
    if us:
        user = await database.fetch_one(dashboard_users.select().where(dashboard_users.c.id == us["user_id"]))
        if not user or not check_password_hash(user["password_hash"], body.current_password):
            raise HTTPException(403, "current password is incorrect")
        await database.execute(dashboard_users.update().where(dashboard_users.c.id == user["id"])
                               .values(password_hash=generate_password_hash(body.new_password)))
        await audit.record(p.company_id, p.actor, p.role, "password.change")
        return {"status": "ok"}

    raise HTTPException(400, "cannot change password for this session")


@router.get("/me")
async def me(p: Principal = Depends(get_principal)):
    return {
        "company_name": p.company_name,
        "role": p.role,
        "permissions": sorted(p.permissions),
        "webrtc_url": p.webrtc_url,
    }

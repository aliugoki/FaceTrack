"""Auth dependencies — Bearer-token → Principal (company + role + permissions).

Tokens are issued at login and stored in `companies.session_token` (legacy
company admin) or `user_sessions.token` (RBAC users). The SPA sends them as
`Authorization: Bearer <token>`.
"""
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status

from app.core.config import settings
from app.core.db import database, companies, user_sessions, dashboard_users
from app.core.security import perms_for


@dataclass
class Principal:
    company_id: str
    company_name: str
    company_image_folder: str | None
    webrtc_url: str | None
    role: str
    permissions: set[str]
    actor: str = ""  # who is acting (admin_username or rbac username), for audit


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return None


async def get_principal(authorization: str | None = Header(default=None)) -> Principal:
    token = _bearer(authorization)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    comp = await database.fetch_one(companies.select().where(companies.c.session_token == token))
    if comp:
        role = "super_admin" if comp["admin_username"] in settings.SUPERADMIN_USERS else "admin"
        return Principal(str(comp["company_id"]), comp["company_name"], comp["company_image_folder"],
                         comp["webrtc_url"], role, perms_for(role), comp["admin_username"])

    us = await database.fetch_one(user_sessions.select().where(user_sessions.c.token == token))
    if us:
        comp = await database.fetch_one(companies.select().where(companies.c.company_id == us["company_id"]))
        if comp:
            role = us["role"]
            u = await database.fetch_one(dashboard_users.select().where(dashboard_users.c.id == us["user_id"]))
            actor = u["username"] if u else f"user#{us['user_id']}"
            return Principal(str(comp["company_id"]), comp["company_name"], comp["company_image_folder"],
                             comp["webrtc_url"], role, perms_for(role), actor)

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired session")


def require(perm: str):
    """Dependency factory: ensures the principal holds `perm`, else 403."""
    async def dep(principal: Principal = Depends(get_principal)) -> Principal:
        if perm not in principal.permissions:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permission")
        return principal
    return dep

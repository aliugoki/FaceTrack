"""RBAC roles/permissions + password hashing."""
from werkzeug.security import check_password_hash, generate_password_hash  # noqa: F401

ROLE_PERMS = {
    "super_admin": {"view", "view_reports", "export", "manage_attendance", "manage_users", "view_tenants",
                    "view_audit", "manage_settings", "manage_cameras", "manage_tenants"},
    "admin":       {"view", "view_reports", "export", "manage_attendance", "manage_users",
                    "view_audit", "manage_settings", "manage_cameras"},
    "manager":     {"view", "view_reports", "export"},
    "viewer":      {"view", "view_reports"},
}
ASSIGNABLE_ROLES = ("viewer", "manager", "admin")  # super_admin is allowlist-only


def perms_for(role: str) -> set[str]:
    return ROLE_PERMS.get(role, ROLE_PERMS["viewer"])

"""Company (tenant) management — super-admin only.

Raw SQL with CAST(...) because companies.company_id is a real UUID column while
the rest of the schema treats company_id as text; CAST avoids type-bind errors.
"""
from app.core.db import database
from app.core.security import generate_password_hash


async def list_companies():
    rows = await database.fetch_all(
        """SELECT company_id, company_name, admin_username, status,
                  company_image_folder, webrtc_url, attendance_api,
                  (api_key IS NOT NULL) AS has_key
           FROM companies ORDER BY company_name""")
    return [{
        "company_id": str(r["company_id"]), "company_name": r["company_name"],
        "admin_username": r["admin_username"], "status": r["status"],
        "image_folder": r["company_image_folder"], "webrtc_url": r["webrtc_url"],
        "attendance_api": r["attendance_api"], "has_api_key": r["has_key"],
    } for r in rows]


async def username_taken(admin_username):
    return bool(await database.fetch_one(
        "SELECT 1 FROM companies WHERE admin_username = :u", {"u": admin_username}))


async def create_company(name, admin_username, password, image_folder=None, webrtc_url=None, attendance_api=None):
    row = await database.fetch_one(
        """INSERT INTO companies
             (company_id, company_name, admin_username, admin_password_hash,
              company_image_folder, api_key, status, webrtc_url, attendance_api)
           VALUES (gen_random_uuid(), :name, :user, :pw, :folder,
                   CAST(gen_random_uuid() AS text), 'active', :webrtc, :api)
           RETURNING company_id, api_key""",
        {"name": name, "user": admin_username, "pw": generate_password_hash(password),
         "folder": image_folder or name, "webrtc": webrtc_url, "api": attendance_api})
    return {"company_id": str(row["company_id"]), "api_key": row["api_key"]}


async def update_company(company_id, data):
    cols = {"status": "status", "webrtc_url": "webrtc_url", "image_folder": "company_image_folder",
            "attendance_api": "attendance_api", "company_name": "company_name"}
    sets, vals = [], {"cid": company_id}
    for k, col in cols.items():
        if k in data and data[k] is not None:
            sets.append(f"{col} = :{k}"); vals[k] = data[k]
    if not sets:
        return
    await database.execute(
        f"UPDATE companies SET {', '.join(sets)} WHERE company_id = CAST(:cid AS uuid)", vals)


async def rotate_api_key(company_id):
    row = await database.fetch_one(
        """UPDATE companies SET api_key = CAST(gen_random_uuid() AS text)
           WHERE company_id = CAST(:cid AS uuid) RETURNING api_key""", {"cid": company_id})
    return {"api_key": row["api_key"] if row else None}


async def set_password(company_id, password):
    await database.execute(
        "UPDATE companies SET admin_password_hash = :pw WHERE company_id = CAST(:cid AS uuid)",
        {"pw": generate_password_hash(password), "cid": company_id})

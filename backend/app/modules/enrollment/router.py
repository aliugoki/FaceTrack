"""Employee enrollment — capture/upload a face, embed, save to the gallery + user_data."""
import os
import base64
import datetime
from uuid import uuid4

import numpy as np
import cv2
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete

from app.core.config import settings
from app.core.db import database, companies, user_data
from app.core.deps import Principal, require
from app.modules.enrollment import face_engine
from app.modules.audit import service as audit

router = APIRouter(prefix="/api/employees", tags=["enrollment"])


class EnrollIn(BaseModel):
    emp_id: str
    first_name: str = ""
    last_name: str = ""
    image_b64: str            # captured/uploaded photo (data URL or raw base64)


async def _folder(company_id: str) -> str:
    row = await database.fetch_one(
        companies.select().where(companies.c.company_id == company_id))
    return (row["company_image_folder"] if row and row["company_image_folder"] else company_id)


@router.post("/enroll")
async def enroll(body: EnrollIn, p: Principal = Depends(require("manage_employees"))):
    emp = body.emp_id.strip()
    if not emp:
        raise HTTPException(400, "emp_id required")
    raw_b64 = body.image_b64.split(",", 1)[1] if "," in body.image_b64 else body.image_b64
    try:
        img = cv2.imdecode(np.frombuffer(base64.b64decode(raw_b64), np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        img = None
    if img is None:
        raise HTTPException(400, "could not decode image")

    result = face_engine.enroll_image(img)
    if result is None:
        raise HTTPException(422, "no face detected — retake with a clear, front-facing photo")
    crop, emb, conf = result

    folder = await _folder(p.company_id)
    out_dir = os.path.join(settings.COMPANY_IMAGES_ROOT, folder)
    os.makedirs(out_dir, exist_ok=True)
    img_name, npy_name = f"{emp}.png", f"{emp}.npy"
    cv2.imwrite(os.path.join(out_dir, img_name), crop)
    np.save(os.path.join(out_dir, npy_name), emb.astype(np.float32))

    # Upsert into user_data (scoped to the tenant).
    exists = await database.fetch_one(select(user_data.c.user_id).where(
        (user_data.c.emp_id == emp) & (user_data.c.company_id == p.company_id)))
    if exists:
        await database.execute(user_data.update().where(
            (user_data.c.emp_id == emp) & (user_data.c.company_id == p.company_id)).values(
            first_name=body.first_name, last_name=body.last_name,
            image_path=img_name, feature_path=npy_name))
        action = "employee.update"
    else:
        await database.execute(user_data.insert().values(
            user_id=str(uuid4()), company_id=p.company_id, emp_id=emp,
            first_name=body.first_name, last_name=body.last_name,
            image_path=img_name, feature_path=npy_name,
            registration_date=datetime.datetime.now()))
        action = "employee.enroll"
    await audit.record(p.company_id, p.actor, p.role, action, f"{emp} {body.first_name} {body.last_name}")
    return {"status": "ok", "emp_id": emp, "confidence": round(float(conf), 3),
            "photo": f"/api/images/{p.company_id}/{img_name}"}


@router.delete("/{emp_id}")
async def delete_employee(emp_id: str, p: Principal = Depends(require("manage_employees"))):
    row = await database.fetch_one(select(user_data.c.image_path, user_data.c.feature_path).where(
        (user_data.c.emp_id == emp_id) & (user_data.c.company_id == p.company_id)))
    if not row:
        raise HTTPException(404, "employee not found")
    folder = await _folder(p.company_id)
    for fn in (row["image_path"], row["feature_path"]):
        try:
            if fn:
                os.remove(os.path.join(settings.COMPANY_IMAGES_ROOT, folder, os.path.basename(fn)))
        except OSError:
            pass
    await database.execute(delete(user_data).where(
        (user_data.c.emp_id == emp_id) & (user_data.c.company_id == p.company_id)))
    await audit.record(p.company_id, p.actor, p.role, "employee.delete", emp_id)
    return {"status": "deleted"}

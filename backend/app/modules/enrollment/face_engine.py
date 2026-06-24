"""Face enrollment engine — res10 SSD detection + ArcFace embedding (CPU/ONNX).

Mirrors the registration project's method (detect largest face → crop → ArcFace)
so embeddings are consistent with the existing gallery. Models load lazily once.
"""
import os
import threading

import numpy as np
import cv2

from app.core.config import settings

_lock = threading.Lock()
_S = {"det": None, "sess": None, "in": None, "out": None}


def _load():
    if _S["sess"] is not None:
        return
    with _lock:
        if _S["sess"] is not None:
            return
        import onnxruntime as ort
        m = settings.MODELS_DIR
        det = cv2.dnn.readNetFromCaffe(
            os.path.join(m, "deploy.prototxt"),
            os.path.join(m, "res10_300x300_ssd_iter_140000_fp16.caffemodel"))
        sess = ort.InferenceSession(os.path.join(m, "arcface.onnx"),
                                    providers=["CPUExecutionProvider"])
        _S.update(det=det, sess=sess, **{"in": sess.get_inputs()[0].name,
                                         "out": sess.get_outputs()[0].name})


def detect_largest_face(img):
    _load()
    h, w = img.shape[:2]
    blob = cv2.dnn.blobFromImage(cv2.resize(img, (300, 300)), 1.0, (300, 300),
                                 (104.0, 177.0, 123.0))
    det = _S["det"]; det.setInput(blob); d = det.forward()
    best, best_conf = None, 0.5
    for i in range(d.shape[2]):
        c = float(d[0, 0, i, 2])
        if c > best_conf:
            box = (d[0, 0, i, 3:7] * [w, h, w, h]).astype(int)
            x1, y1, x2, y2 = max(0, box[0]), max(0, box[1]), min(w, box[2]), min(h, box[3])
            if x2 > x1 and y2 > y1:
                best, best_conf = (x1, y1, x2, y2), c
    return best, best_conf


def embed(crop_bgr):
    """ArcFace 512-d embedding (L2-normalized). Preprocess: RGB, 112, (px-127.5)/128."""
    _load()
    rgb = cv2.cvtColor(cv2.resize(crop_bgr, (112, 112)), cv2.COLOR_BGR2RGB).astype(np.float32)
    x = ((rgb - 127.5) * 0.0078125).transpose(2, 0, 1)[None]
    out = _S["sess"].run([_S["out"]], {_S["in"]: x})[0].reshape(-1).astype(np.float32)
    n = np.linalg.norm(out)
    return out / n if n > 0 else out


def enroll_image(img_bgr):
    """Return (crop_bgr, embedding, confidence) for the largest face, or None."""
    box, conf = detect_largest_face(img_bgr)
    if not box:
        return None
    x1, y1, x2, y2 = box
    crop = img_bgr[y1:y2, x1:x2]
    return crop, embed(crop), conf

"""Face enrollment engine — quality-gated capture + ArcFace embedding (CPU/ONNX).

Detection + frontal-quality gate via YuNet (5 landmarks), embedding via ArcFace.
Only a clear, full, front-facing face passes — profiles, cut-off, tilted, or
too-small faces are rejected with a specific reason. Falls back to res10 (no
gate) if the YuNet model isn't present. Models load lazily once.
"""
import os
import math
import threading

import numpy as np
import cv2

from app.core.config import settings

_lock = threading.Lock()
_S = {"det": None, "sess": None, "in": None, "out": None, "yunet": None}

# Frontal-quality thresholds
MIN_SCORE = 0.85          # YuNet confidence
MIN_FACE_FRAC = 0.20      # face width ≥ 20% of image width (close enough)
EDGE_MARGIN_FRAC = 0.01   # face must sit this far inside the frame (not cut off)
YAW_RANGE = (0.34, 0.66)  # nose position between eyes (0.5 = straight)
MAX_ROLL_DEG = 15.0       # head tilt


class FaceQualityError(Exception):
    """Raised when the captured face fails the frontal-quality gate."""


def _load():
    if _S["sess"] is not None:
        return
    with _lock:
        if _S["sess"] is not None:
            return
        import onnxruntime as ort
        m = settings.MODELS_DIR
        _S["det"] = cv2.dnn.readNetFromCaffe(
            os.path.join(m, "deploy.prototxt"),
            os.path.join(m, "res10_300x300_ssd_iter_140000_fp16.caffemodel"))
        sess = ort.InferenceSession(os.path.join(m, "arcface.onnx"), providers=["CPUExecutionProvider"])
        _S.update(sess=sess, **{"in": sess.get_inputs()[0].name, "out": sess.get_outputs()[0].name})
        yunet_path = os.path.join(m, "face_detection_yunet_2023mar.onnx")
        if os.path.exists(yunet_path):
            _S["yunet"] = cv2.FaceDetectorYN_create(yunet_path, "", (320, 320), 0.6, 0.3, 5000)


def _assess_frontal(img):
    """Return (x1,y1,x2,y2,score) of a full frontal face, or raise FaceQualityError."""
    h, w = img.shape[:2]
    yn = _S["yunet"]
    yn.setInputSize((w, h))
    _, faces = yn.detect(img)
    if faces is None or len(faces) == 0:
        raise FaceQualityError("No face detected — face the camera in good light.")
    f = max(faces, key=lambda r: r[-1])
    x, y, bw, bh = f[0], f[1], f[2], f[3]
    score = float(f[-1])
    rex, rey, lex, ley, nx, ny = f[4], f[5], f[6], f[7], f[8], f[9]

    if score < MIN_SCORE:
        raise FaceQualityError("Face unclear — improve lighting and look at the camera.")
    margin = EDGE_MARGIN_FRAC * min(w, h)
    if x < margin or y < margin or (x + bw) > (w - margin) or (y + bh) > (h - margin):
        raise FaceQualityError("Face is cut off — center your whole face in the frame.")
    if bw < MIN_FACE_FRAC * w:
        raise FaceQualityError("Face too small — move closer to the camera.")
    ex0, ex1 = (rex, lex) if rex < lex else (lex, rex)
    if ex1 - ex0 < 1e-3:
        raise FaceQualityError("Could not read facial landmarks — try again.")
    yaw = (nx - ex0) / (ex1 - ex0)
    if not (YAW_RANGE[0] <= yaw <= YAW_RANGE[1]):
        raise FaceQualityError("Not front-facing — look straight at the camera.")
    roll = abs(math.degrees(math.atan2(ley - rey, lex - rex)))
    roll = min(roll, abs(180 - roll))
    if roll > MAX_ROLL_DEG:
        raise FaceQualityError("Keep your head upright (less tilt).")
    x1, y1 = max(0, int(x)), max(0, int(y))
    x2, y2 = min(w, int(x + bw)), min(h, int(y + bh))
    return x1, y1, x2, y2, score


def detect_largest_face(img):
    """res10 SSD fallback (bbox only, no quality gate)."""
    h, w = img.shape[:2]
    blob = cv2.dnn.blobFromImage(cv2.resize(img, (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0))
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
    _load()
    rgb = cv2.cvtColor(cv2.resize(crop_bgr, (112, 112)), cv2.COLOR_BGR2RGB).astype(np.float32)
    x = ((rgb - 127.5) * 0.0078125).transpose(2, 0, 1)[None]
    out = _S["sess"].run([_S["out"]], {_S["in"]: x})[0].reshape(-1).astype(np.float32)
    n = np.linalg.norm(out)
    return out / n if n > 0 else out


def enroll_image(img_bgr):
    """Return (crop, embedding, confidence) for a full frontal face, or raise FaceQualityError."""
    _load()
    if _S["yunet"] is not None:
        x1, y1, x2, y2, conf = _assess_frontal(img_bgr)
    else:
        box, conf = detect_largest_face(img_bgr)
        if not box:
            raise FaceQualityError("No face detected.")
        x1, y1, x2, y2 = box
    return img_bgr[y1:y2, x1:x2], embed(img_bgr[y1:y2, x1:x2]), float(conf)

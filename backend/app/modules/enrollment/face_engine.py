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


# Canonical 5-point ArcFace template (insightface standard) for a 112x112 chip,
# order: img-left-eye, img-right-eye, nose, img-left-mouth, img-right-mouth. MUST
# match the live pipeline (deepstream/utils/face_align.py) so enrolled gallery
# vectors and the pipeline's aligned query vectors live in the same space.
ARCFACE_TEMPLATE_112 = np.array([
    [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
    [41.5493, 92.3655], [70.7299, 92.2041],
], dtype=np.float32)


def _umeyama(src, dst):
    """2x3 similarity transform (scale+rotation+translation) mapping src->dst,
    via Umeyama SVD (no shear/reflection). Mirrors the pipeline's implementation."""
    src = np.asarray(src, np.float64); dst = np.asarray(dst, np.float64)
    n, d = src.shape
    sm, dm = src.mean(0), dst.mean(0)
    sc, dc = src - sm, dst - dm
    U, D, Vt = np.linalg.svd((dc.T @ sc) / n)
    S = np.eye(d)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[-1, -1] = -1.0
    R = U @ S @ Vt
    var = sc.var(0).sum()
    scale = 1.0 if var < 1e-12 else (D * np.diag(S)).sum() / var
    M = np.zeros((2, 3), np.float32)
    M[:2, :2] = scale * R
    M[:2, 2] = dm - scale * (R @ sm)
    return M


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
    # 5 landmarks (YuNet order: right-eye, left-eye, nose, right-mouth, left-mouth),
    # which is exactly the ArcFace template order (img-left-eye is the subject's
    # right eye), so they map 1:1 onto ARCFACE_TEMPLATE_112 for alignment.
    lmk = np.array([[rex, rey], [lex, ley], [nx, ny],
                    [f[10], f[11]], [f[12], f[13]]], dtype=np.float32)
    return x1, y1, x2, y2, score, lmk


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


def _arcface(chip112_bgr):
    """ArcFace forward on a 112x112 BGR chip -> L2-normalized 512-d embedding."""
    rgb = cv2.cvtColor(chip112_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    x = ((rgb - 127.5) * 0.0078125).transpose(2, 0, 1)[None]
    out = _S["sess"].run([_S["out"]], {_S["in"]: x})[0].reshape(-1).astype(np.float32)
    n = np.linalg.norm(out)
    return out / n if n > 0 else out


def embed(crop_bgr):
    """Unaligned embedding (plain resize) — fallback for the res10 path that has no
    landmarks. Prefer embed_aligned; ArcFace is alignment-sensitive."""
    _load()
    return _arcface(cv2.resize(crop_bgr, (112, 112)))


def embed_aligned(img_bgr, landmarks):
    """Aligned embedding: warp the face to the canonical ArcFace template via a
    Umeyama similarity transform on the 5 landmarks, then embed. This matches the
    live DeepStream pipeline so enrolled vectors are directly comparable to its
    aligned query vectors (validated ~0.96 cosine vs the pipeline gallery)."""
    _load()
    M = _umeyama(np.asarray(landmarks, np.float32), ARCFACE_TEMPLATE_112)
    return _arcface(cv2.warpAffine(img_bgr, M, (112, 112)))


def enroll_image(img_bgr):
    """Return (crop, embedding, confidence) for a full frontal face, or raise FaceQualityError."""
    _load()
    if _S["yunet"] is not None:
        x1, y1, x2, y2, conf, lmk = _assess_frontal(img_bgr)
        emb = embed_aligned(img_bgr, lmk)         # aligned — matches the live pipeline
    else:
        box, conf = detect_largest_face(img_bgr)  # res10 fallback: no landmarks
        if not box:
            raise FaceQualityError("No face detected.")
        x1, y1, x2, y2 = box
        emb = embed(img_bgr[y1:y2, x1:x2])        # unaligned (degraded)
    return img_bgr[y1:y2, x1:x2], emb, float(conf)

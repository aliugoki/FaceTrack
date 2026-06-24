"""Browse video recordings written by MediaMTX (RECORDINGS_DIR)."""
import os
import datetime

from app.core.config import settings

VIDEO_EXT = {".mp4", ".ts", ".mkv", ".webm", ".m4v"}


def list_recordings(limit: int = 500):
    base = settings.RECORDINGS_DIR
    if not os.path.isdir(base):
        return []
    out = []
    for root, _, files in os.walk(base):
        for f in files:
            if os.path.splitext(f)[1].lower() not in VIDEO_EXT:
                continue
            full = os.path.join(root, f)
            rel = os.path.relpath(full, base)
            try:
                st = os.stat(full)
            except OSError:
                continue
            out.append({
                "path": rel,
                "camera": rel.split(os.sep)[0],
                "file": f,
                "size_mb": round(st.st_size / 1_000_000, 1),
                "modified": datetime.datetime.fromtimestamp(st.st_mtime).isoformat(),
                "url": f"/api/recordings/file/{rel}",
            })
    out.sort(key=lambda x: x["modified"], reverse=True)
    return out[:limit]

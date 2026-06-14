"""Single in-flight image-gen job progress publisher.

Writes a tiny JSON file the desktop can poll to render step feedback while
sd.cpp runs. Single global slot (no concurrent jobs supported on a single
sidecar — generation is sequential anyway).
"""
from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path
from typing import Any

_FILE = Path(tempfile.gettempdir()) / "monkey-image" / "progress.json"


def publish(**fields: Any) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = {**fields, "ts": time.time()}
        _FILE.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def read() -> dict | None:
    try:
        return json.loads(_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def clear() -> None:
    try:
        _FILE.unlink()
    except FileNotFoundError:
        pass
    except Exception:
        pass

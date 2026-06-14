"""Persistent key-value store saved to ~/.monkey/store.json — atomic + lock-safe."""
import json
import os
import tempfile
import threading
from pathlib import Path

_FILE = Path.home() / ".monkey" / "store.json"
_LOCK = threading.Lock()


def _load() -> dict:
    try:
        return json.loads(_FILE.read_text())
    except Exception:
        return {}


def _save(data: dict):
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".store_", suffix=".tmp", dir=str(_FILE.parent))
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, _FILE)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def get(key: str) -> str | None:
    with _LOCK:
        return _load().get(key)


def set(key: str, value: str):
    with _LOCK:
        data = _load()
        data[key] = value
        _save(data)


def delete(key: str):
    with _LOCK:
        data = _load()
        data.pop(key, None)
        _save(data)

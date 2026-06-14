"""Installed-state registry. Single source of truth: on-disk meta.json files.

Layout per model:
  ~/.monkey/models/<id>/meta.json    {id, downloadedAt, bytes, files, runtime}
  ~/.monkey/models/<id>/...          model files

The agent and UI query `list_state()` to know what is installed. After every
install/uninstall, callers must invoke `mark_dirty()` so the agent reloads its
dynamic tool set on the next chat turn.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path

from . import catalog as _catalog

MODELS_ROOT = Path.home() / ".monkey" / "models"


def _desktop_models_dir() -> Path:
    """App-data dir where the Tauri/JS downloader writes large weights
    (FLUX GGUF, etc.). Honors MONKEY_DESKTOP_MODELS_DIR for dev/CI.
    The default mirrors `tauri::path::app_data_dir()` on macOS, which is the
    only platform currently supported by the bundled binary sidecars."""
    override = os.environ.get("MONKEY_DESKTOP_MODELS_DIR")
    if override:
        return Path(override)
    return Path.home() / "Library" / "Application Support" / "ai.progsoft.monkey" / "models"


def _sdcpp_installed(spec: dict) -> bool:
    """All-or-nothing: the transformer GGUF *and* every declared companion
    (T5/CLIP-L/VAE) must be on disk. sd.cpp refuses to run with a missing
    encoder, so partial state would surface as a generation error rather than
    "not installed" — and the user would think it's installed."""
    main = spec.get("desktop_file")
    if not main:
        return False
    dest = _desktop_models_dir()
    if not (dest / main).exists():
        return False
    companions = spec.get("desktop_companions") or {}
    for name in companions.values():
        if not (dest / name).exists():
            return False
    return True

_LOCK = threading.Lock()
_DIRTY_FLAG = threading.Event()
_DIRTY_FLAG.set()  # force first scan


def model_dir(model_id: str) -> Path:
    return MODELS_ROOT / model_id


def _meta_path(model_id: str) -> Path:
    return model_dir(model_id) / "meta.json"


def is_installed(model_id: str) -> bool:
    spec = _catalog.by_id(model_id)
    if spec is None:
        return False
    if spec.get("runtime") == "system":
        # System adapters expose `binary_available()` (binary on PATH for
        # tesseract, importable python module for rapidocr, …). Dispatch
        # dynamically so new system adapters don't need a registry edit.
        try:
            import importlib
            mod = importlib.import_module(f"monkey.local_models.adapters.{spec['adapter']}")
            return bool(getattr(mod, "binary_available", lambda: False)())
        except Exception:
            return False
    if spec.get("runtime") == "sdcpp":
        # Cross-process: the desktop downloader owns these big weights
        # (~10 GB total). No meta.json in ~/.monkey/models — the on-disk
        # GGUF is the source of truth.
        return _sdcpp_installed(spec)
    return _meta_path(model_id).exists()


def read_meta(model_id: str) -> dict | None:
    p = _meta_path(model_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def write_meta(model_id: str, files: list[str], bytes_total: int) -> None:
    spec = _catalog.by_id(model_id)
    if spec is None:
        raise ValueError(f"unknown model: {model_id}")
    p = _meta_path(model_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({
        "id": model_id,
        "downloadedAt": time.time(),
        "bytes": bytes_total,
        "files": files,
        "runtime": spec["runtime"],
        "repo": spec["repo"],
    }, indent=2))
    mark_dirty()


def remove(model_id: str) -> bool:
    """Delete the model folder. Returns True if anything was removed."""
    spec = _catalog.by_id(model_id)
    if spec is None:
        return False
    if spec.get("runtime") == "system":
        # We don't manage system binaries — user uninstalls via their package manager.
        return False
    if spec.get("runtime") == "sdcpp":
        # Weights live in the desktop app-data dir, owned by the Tauri UI.
        # Uninstall is handled there to keep one source of truth.
        return False
    d = model_dir(model_id)
    if not d.exists():
        return False
    with _LOCK:
        shutil.rmtree(d, ignore_errors=True)
    from . import runtime as _rt
    _rt.unload(model_id)
    mark_dirty()
    return True


def installed_ids() -> list[str]:
    return [m["id"] for m in _catalog.all_models() if is_installed(m["id"])]


def list_state() -> list[dict]:
    """Catalogue + installed flag + meta, ready for the UI."""
    out = []
    for spec in _catalog.all_models():
        meta = read_meta(spec["id"]) if spec.get("runtime") != "system" else None
        out.append({
            **spec,
            "installed": is_installed(spec["id"]),
            "meta": meta,
        })
    return out


# ── Dirty flag: agent.py checks this each turn to know if it must rebuild
#    its dynamic tool set. Cheap to check, set whenever install state changes.
def mark_dirty() -> None:
    _DIRTY_FLAG.set()


def consume_dirty() -> bool:
    """Returns True (and clears flag) if state changed since last check."""
    if _DIRTY_FLAG.is_set():
        _DIRTY_FLAG.clear()
        return True
    return False

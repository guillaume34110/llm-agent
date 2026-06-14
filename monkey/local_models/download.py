"""HuggingFace download with progress events.

Yields ProgressEvent dicts that the FastAPI endpoint streams as SSE to the
desktop UI. Resumable thanks to huggingface_hub's internal caching, but we
download straight into ~/.monkey/models/<id>/ via snapshot_download with
`local_dir=...` and `local_dir_use_symlinks=False` so files are real files
(not symlinks into ~/.cache/huggingface — keeps disk usage predictable).
"""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Generator

from . import catalog as _catalog
from . import registry as _registry


_ACTIVE: dict[str, dict] = {}  # model_id -> {bytes, total, status}
_ACTIVE_LOCK = threading.Lock()


def _set_state(model_id: str, **fields) -> None:
    with _ACTIVE_LOCK:
        st = _ACTIVE.setdefault(model_id, {})
        st.update(fields)


def status(model_id: str) -> dict:
    with _ACTIVE_LOCK:
        return dict(_ACTIVE.get(model_id) or {})


def _download_sdcpp(spec: dict, model_id: str) -> Generator[dict, None, None]:
    """sdcpp runtime needs N files from M HuggingFace repos, all flat in the
    desktop app-data models dir (so sdcpp.py can locate them by name). We
    iterate sources serially via hf_hub_download to keep memory flat, and a
    polling thread reports cumulative bytes-on-disk across just the target
    paths (not the whole dir — other models may share it)."""
    sources = spec.get("download_sources") or []
    if not sources:
        yield {"event": "error", "message": f"sdcpp spec missing download_sources for {model_id}"}
        return

    dest_dir = _registry._desktop_models_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    _set_state(model_id, status="downloading", started=time.time(), bytes=0, total=0)
    yield {"event": "start", "model_id": model_id, "files": len(sources)}

    try:
        from huggingface_hub import hf_hub_download
    except Exception as e:
        yield {"event": "error", "message": f"huggingface_hub missing: {e}"}
        return

    targets = [dest_dir / src["filename"] for src in sources]
    expected_bytes = spec.get("size_mb", 0) * 1024 * 1024

    result: dict = {"error": None}

    def _run():
        try:
            for src in sources:
                hf_hub_download(
                    repo_id=src["repo"],
                    filename=src["filename"],
                    local_dir=str(dest_dir),
                    local_dir_use_symlinks=False,
                )
        except Exception as e:
            result["error"] = str(e)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    while t.is_alive():
        time.sleep(0.5)
        try:
            total = sum(p.stat().st_size for p in targets if p.exists())
        except Exception:
            total = 0
        percent = min(99, int(total * 100 / expected_bytes)) if expected_bytes else 0
        _set_state(model_id, bytes=total, total=expected_bytes, percent=percent)
        yield {"event": "progress", "bytes": total, "total": expected_bytes, "percent": percent}

    if result["error"]:
        _set_state(model_id, status="error", error=result["error"])
        yield {"event": "error", "message": result["error"]}
        return

    final_bytes = sum(p.stat().st_size for p in targets if p.exists())
    # No meta.json for sdcpp: on-disk file existence is the source of truth
    # (see registry._sdcpp_installed). Still mark dirty so the agent picks up
    # the local_image_gen tool on the next chat turn.
    _registry.mark_dirty()
    _set_state(model_id, status="installed", bytes=final_bytes, total=final_bytes, percent=100)
    yield {"event": "done", "dir": str(dest_dir), "bytes": final_bytes, "files": len(sources)}


def download(model_id: str) -> Generator[dict, None, None]:
    """Generator yielding events:
        {event: 'start', total_files: N}
        {event: 'progress', bytes, total, percent, file}
        {event: 'done', dir}
        {event: 'error', message}
    """
    spec = _catalog.by_id(model_id)
    if spec is None:
        yield {"event": "error", "message": f"unknown model: {model_id}"}
        return
    if spec.get("runtime") == "system":
        yield {"event": "error", "message": "system binary — install via your OS package manager"}
        return

    if spec.get("runtime") == "sdcpp":
        yield from _download_sdcpp(spec, model_id)
        return

    dest = _registry.model_dir(model_id)
    dest.mkdir(parents=True, exist_ok=True)
    _set_state(model_id, status="downloading", started=time.time(), bytes=0, total=0)
    yield {"event": "start", "model_id": model_id, "repo": spec["repo"]}

    try:
        from huggingface_hub import snapshot_download
    except Exception as e:
        yield {"event": "error", "message": f"huggingface_hub missing: {e}"}
        return

    # We run snapshot_download in a thread so we can poll directory size for
    # progress. HF hub's per-file callbacks aren't reliable across versions.
    result: dict = {}
    def _run():
        try:
            allow = spec.get("files") or None
            path = snapshot_download(
                repo_id=spec["repo"],
                local_dir=str(dest),
                allow_patterns=allow if allow else None,
                local_dir_use_symlinks=False,
            )
            result["path"] = path
        except Exception as e:
            result["error"] = str(e)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    expected_bytes = spec.get("size_mb", 0) * 1024 * 1024
    while t.is_alive():
        time.sleep(0.5)
        try:
            total = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
        except Exception:
            total = 0
        percent = min(99, int(total * 100 / expected_bytes)) if expected_bytes else 0
        _set_state(model_id, bytes=total, total=expected_bytes, percent=percent)
        yield {"event": "progress", "bytes": total, "total": expected_bytes, "percent": percent}

    if result.get("error"):
        _set_state(model_id, status="error", error=result["error"])
        yield {"event": "error", "message": result["error"]}
        return

    # Tally final size + write meta
    files = [str(p.relative_to(dest)) for p in dest.rglob("*") if p.is_file() and p.name != "meta.json"]
    total = sum((dest / f).stat().st_size for f in files)
    _registry.write_meta(model_id, files, total)
    _set_state(model_id, status="installed", bytes=total, total=total, percent=100)
    yield {"event": "done", "dir": str(dest), "bytes": total, "files": len(files)}

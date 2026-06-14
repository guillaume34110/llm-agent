"""File-level checkpoints captured on green builds.

Layout: ~/.monkey/checkpoints/<run_id>/green_<idx>/
Each snapshot stores:
  - manifest.json : { created_at, build_idx, files: [{path, sha256, size, rel}], cwd }
  - blobs/<sha>   : file contents (deduped by hash)

Used by the agent loop to:
  1. snapshot every file written during the run, on each green build
  2. expose `restore_last_green` tool so the agent can revert to last working state
  3. surface modified-since-green file list to gate write_file in deep regression
"""
from __future__ import annotations
import hashlib
import json
import os
import shutil
import time
from pathlib import Path

ROOT = Path.home() / ".monkey" / "checkpoints"
MAX_RUNS = 20
MAX_SNAPSHOTS_PER_RUN = 8


def _run_dir(run_id: str) -> Path:
    return ROOT / run_id


def _ensure(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:32]


def list_snapshots(run_id: str) -> list[dict]:
    """Return manifests of all snapshots for a run, oldest first."""
    rd = _run_dir(run_id)
    if not rd.exists():
        return []
    out = []
    for d in sorted(rd.iterdir()):
        if not d.is_dir() or not d.name.startswith("green_"):
            continue
        mf = d / "manifest.json"
        if not mf.exists():
            continue
        try:
            m = json.loads(mf.read_text())
            m["_dir"] = str(d)
            m["_name"] = d.name
            out.append(m)
        except Exception:
            continue
    return out


def latest_snapshot(run_id: str) -> dict | None:
    snaps = list_snapshots(run_id)
    return snaps[-1] if snaps else None


def snapshot_green(run_id: str, build_idx: int, files: list[Path]) -> dict | None:
    """Snapshot listed files. Returns manifest dict or None if nothing to capture.

    Files that don't exist are skipped silently (may have been written then deleted).
    """
    if not files:
        return None
    rd = _run_dir(run_id)
    _ensure(rd)
    snap_name = f"green_{build_idx:04d}_{int(time.time())}"
    sd = rd / snap_name
    blobs = sd / "blobs"
    _ensure(blobs)
    manifest_files = []
    for f in files:
        try:
            if not f.exists() or not f.is_file():
                continue
            data = f.read_bytes()
        except Exception:
            continue
        sha = _sha256_bytes(data)
        blob = blobs / sha
        if not blob.exists():
            blob.write_bytes(data)
        manifest_files.append({
            "path": str(f),
            "sha": sha,
            "size": len(data),
        })
    if not manifest_files:
        shutil.rmtree(sd, ignore_errors=True)
        return None
    manifest = {
        "created_at": time.time(),
        "build_idx": build_idx,
        "files": manifest_files,
        "run_id": run_id,
    }
    (sd / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    _enforce_caps(run_id)
    return manifest


def restore_last_green(run_id: str) -> dict:
    """Restore all files from the last green snapshot to disk.

    Returns: { restored: [paths], deleted: [paths], snapshot: name, build_idx } or { error }.
    Files that exist now but weren't in the snapshot stay untouched (caller must handle).
    """
    snap = latest_snapshot(run_id)
    if not snap:
        return {"error": "no green snapshot available for this run"}
    sd = Path(snap["_dir"])
    blobs = sd / "blobs"
    restored = []
    failed = []
    for entry in snap["files"]:
        target = Path(entry["path"])
        blob = blobs / entry["sha"]
        if not blob.exists():
            failed.append(entry["path"])
            continue
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(blob.read_bytes())
            restored.append(entry["path"])
        except Exception as e:
            failed.append(f"{entry['path']} ({e})")
    return {
        "snapshot": snap["_name"],
        "build_idx": snap["build_idx"],
        "restored": restored,
        "failed": failed,
        "count": len(restored),
    }


def files_modified_since_last_green(run_id: str, candidate_paths: list[Path]) -> list[str]:
    """Among candidate paths, list ones whose current content differs from last snapshot."""
    snap = latest_snapshot(run_id)
    if not snap:
        return [str(p) for p in candidate_paths if p.exists()]
    snap_by_path = {entry["path"]: entry["sha"] for entry in snap["files"]}
    out = []
    for p in candidate_paths:
        sp = str(p)
        try:
            current = p.read_bytes() if p.exists() else b""
        except Exception:
            continue
        cur_sha = _sha256_bytes(current) if current else ""
        snap_sha = snap_by_path.get(sp)
        if snap_sha is None:
            if current:  # new file added since green
                out.append(sp)
        elif cur_sha != snap_sha:
            out.append(sp)
    return out


def _enforce_caps(run_id: str) -> None:
    rd = _run_dir(run_id)
    snaps = list_snapshots(run_id)
    if len(snaps) > MAX_SNAPSHOTS_PER_RUN:
        for s in snaps[: len(snaps) - MAX_SNAPSHOTS_PER_RUN]:
            shutil.rmtree(s["_dir"], ignore_errors=True)
    if ROOT.exists():
        runs = sorted(
            (d for d in ROOT.iterdir() if d.is_dir()),
            key=lambda d: d.stat().st_mtime,
        )
        if len(runs) > MAX_RUNS:
            for d in runs[: len(runs) - MAX_RUNS]:
                shutil.rmtree(d, ignore_errors=True)


def clear_run(run_id: str) -> None:
    rd = _run_dir(run_id)
    if rd.exists():
        shutil.rmtree(rd, ignore_errors=True)

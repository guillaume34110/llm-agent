"""FLUX.1-schnell image generation via stable-diffusion.cpp binary sidecar.

The desktop's Tauri layer downloads four weight files into the user's
app-data models dir (see catalog `desktop_file` + `desktop_companions`):

  flux1-schnell-Q4_0.gguf      — transformer (~6.3 GB)
  t5xxl_fp8_e4m3fn.safetensors — T5 text encoder (~5 GB)
  clip_l.safetensors           — CLIP-L text encoder (~250 MB)
  ae.safetensors               — FLUX VAE (~167 MB)

The sd.cpp binary is bundled by Tauri at `binaries/sd-<triple>` and the
Python sidecar receives its path through the MONKEY_SD_BIN env var (set
by `main.rs` at sidecar spawn).

Per-image CLI invocation (no resident process): sd.cpp loads weights,
generates, exits. Cold start ~5-10 s, generation ~30-60 s on M2 at 4 steps.

Adapter contract:
  load(spec, model_dir) -> session dict {sd_bin, main, t5, clip_l, vae, spec}
  run(session, args)    -> JSON {image_path, bytes, format, prompt, seed, ...}
  unload(session)       -> no-op (no resident process)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from monkey.local_models import progress as _progress


_DEFAULT_STEPS = 4
_DEFAULT_SIZE = 512
_MIN_SIZE = 256
_MAX_SIZE = 1536
_MAX_PROMPT_CHARS = 2000
_GEN_TIMEOUT_S = 900

_STEP_RE = re.compile(rb"\|\s*=*>?\s*\|\s*(\d+)/(\d+)\s*-\s*([\d.]+)s/it")
_LOAD_DONE_RE = re.compile(rb"loading tensors completed")
_SAMPLE_DONE_RE = re.compile(rb"sampling completed")
_DECODE_RE = re.compile(rb"latent \d+ decoded")
_GEN_DONE_RE = re.compile(rb"generate_image completed")


def _desktop_models_dir() -> Path:
    override = os.environ.get("MONKEY_DESKTOP_MODELS_DIR")
    if override:
        return Path(override)
    return Path.home() / "Library" / "Application Support" / "ai.progsoft.monkey" / "models"


def _locate_sd_binary() -> Path | None:
    """Resolve the sd.cpp binary path.
    1) MONKEY_SD_BIN env (set by Rust at sidecar spawn) — authoritative
    2) PATH lookup (dev convenience)
    """
    env = os.environ.get("MONKEY_SD_BIN")
    if env:
        p = Path(env)
        if p.is_file() and os.access(p, os.X_OK):
            return p
    for name in ("sd", "stable-diffusion"):
        found = shutil.which(name)
        if found:
            return Path(found)
    return None


def load(spec: dict, _model_dir):
    main_name = spec.get("desktop_file")
    if not main_name:
        raise RuntimeError("catalog spec missing desktop_file")
    dest_dir = _desktop_models_dir()
    main = dest_dir / main_name
    if not main.exists():
        raise RuntimeError(
            f"FLUX GGUF not found at {main}. "
            "Install via Settings -> Local models."
        )
    companions = spec.get("desktop_companions") or {}
    t5 = dest_dir / companions["t5"] if companions.get("t5") else None
    clip_l = dest_dir / companions["clip_l"] if companions.get("clip_l") else None
    vae = dest_dir / companions["vae"] if companions.get("vae") else None
    return {
        "spec": spec,
        "main": main,
        "t5": t5,
        "clip_l": clip_l,
        "vae": vae,
    }


def unload(_session) -> None:
    pass


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def _parse_size(size: str | None) -> tuple[int, int]:
    if not size:
        return _DEFAULT_SIZE, _DEFAULT_SIZE
    try:
        w, h = (int(x.strip()) for x in str(size).lower().split("x", 1))
    except Exception:
        return _DEFAULT_SIZE, _DEFAULT_SIZE
    w = _clamp(w - (w % 16), _MIN_SIZE, _MAX_SIZE)
    h = _clamp(h - (h % 16), _MIN_SIZE, _MAX_SIZE)
    return w, h


def _missing_companions(session: dict) -> list[str]:
    missing: list[str] = []
    for key in ("t5", "clip_l", "vae"):
        p = session.get(key)
        if p is not None and not p.exists():
            missing.append(p.name)
    return missing


def run(session, args: dict) -> str:
    prompt = (args.get("prompt") or "").strip()
    if not prompt:
        return "ERREUR: prompt required"
    if len(prompt) > _MAX_PROMPT_CHARS:
        return f"ERREUR: prompt too long (max {_MAX_PROMPT_CHARS} chars)"

    sd_bin = _locate_sd_binary()
    if sd_bin is None:
        return (
            "ERREUR: stable-diffusion.cpp binary unavailable. "
            "Set MONKEY_SD_BIN or reinstall the app (the binary ships with the bundle)."
        )

    missing = _missing_companions(session)
    if missing:
        return (
            "ERREUR: FLUX companion files missing: "
            + ", ".join(missing)
            + ". Install them via Settings -> Local models."
        )

    width, height = _parse_size(args.get("size"))
    seed_raw = args.get("seed")
    try:
        seed = (
            int(seed_raw)
            if seed_raw is not None and seed_raw != ""
            else int(time.time()) & 0x7FFFFFFF
        )
    except Exception:
        seed = int(time.time()) & 0x7FFFFFFF
    try:
        steps = int(args.get("steps") or _DEFAULT_STEPS)
    except Exception:
        steps = _DEFAULT_STEPS
    steps = _clamp(steps, 1, 12)

    out_dir = Path(tempfile.gettempdir()) / "monkey-image"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"flux-{os.getpid()}-{seed}.png"

    cmd: list[str] = [
        str(sd_bin),
        "--diffusion-model", str(session["main"]),
        "-p", prompt,
        "-W", str(width),
        "-H", str(height),
        "-s", str(seed),
        "--steps", str(steps),
        "-o", str(out),
        # schnell is distilled — no CFG, single guidance pass.
        "--cfg-scale", "1.0",
        "--sampling-method", "euler",
    ]
    if session["t5"] is not None:
        cmd += ["--t5xxl", str(session["t5"])]
    if session["clip_l"] is not None:
        cmd += ["--clip_l", str(session["clip_l"])]
    if session["vae"] is not None:
        cmd += ["--vae", str(session["vae"])]

    started = time.time()
    base_meta = {"prompt": prompt, "width": width, "height": height, "steps": steps}
    _progress.publish(stage="loading", elapsed=0.0, **base_meta)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=0,
        )
    except FileNotFoundError as e:
        _progress.clear()
        return f"ERREUR: sd binary not executable at {sd_bin}: {e}"
    except Exception as e:
        _progress.clear()
        return f"ERREUR: sd.cpp spawn failed: {e}"

    buf = bytearray()
    buf_lock = threading.Lock()

    def _reader() -> None:
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(512)
            if not chunk:
                break
            with buf_lock:
                buf.extend(chunk)
            elapsed = time.time() - started
            if _LOAD_DONE_RE.search(chunk):
                _progress.publish(stage="loaded", elapsed=elapsed, **base_meta)
            steps_in_chunk = list(_STEP_RE.finditer(chunk))
            if steps_in_chunk:
                m = steps_in_chunk[-1]
                _progress.publish(
                    stage="sampling",
                    step=int(m.group(1)),
                    total=int(m.group(2)),
                    its=float(m.group(3)),
                    elapsed=elapsed,
                    **base_meta,
                )
            if _SAMPLE_DONE_RE.search(chunk) or _DECODE_RE.search(chunk):
                _progress.publish(stage="decoding", elapsed=elapsed, **base_meta)
            if _GEN_DONE_RE.search(chunk):
                _progress.publish(stage="saving", elapsed=elapsed, **base_meta)

    reader = threading.Thread(target=_reader, daemon=True)
    reader.start()

    try:
        proc.wait(timeout=_GEN_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=2)
        except Exception:
            pass
        _progress.clear()
        return f"ERREUR: image generation timed out (>{_GEN_TIMEOUT_S}s)"

    reader.join(timeout=2)
    _progress.clear()

    if proc.returncode != 0:
        tail = bytes(buf).decode("utf-8", errors="replace")[-500:]
        return f"ERREUR: sd.cpp exit {proc.returncode}: {tail.strip()}"
    if not out.exists():
        return "ERREUR: sd.cpp finished without writing the image"

    return json.dumps(
        {
            "image_path": str(out),
            "bytes": out.stat().st_size,
            "format": "png",
            "prompt": prompt,
            "seed": seed,
            "width": width,
            "height": height,
            "steps": steps,
        },
        ensure_ascii=False,
    )

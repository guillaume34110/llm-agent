"""TripoSplat — single image → 3D Gaussian splats (.ply), on-device.

Weights (VAST-AI/TripoSplat, MIT) are pulled by the standard local-models
downloader into ~/.monkey/models/triposplat/ as the repo's ckpts/ subtree:

  background_removal/birefnet.safetensors
  diffusion_models/triposplat_fp16.safetensors
  clip_vision/dino_v3_vit_h.safetensors
  vae/flux2-vae.safetensors
  vae/triposplat_vae_decoder_fp16.safetensors

The inference runtime (triposplat.py + model.py, MIT) can be obtained from:
  gh api repos/VAST-AI-Research/TripoSplat/contents/triposplat.py --jq '.content' | base64 -d > ~/.monkey/models/triposplat/triposplat.py
  gh api repos/VAST-AI-Research/TripoSplat/contents/model.py --jq '.content' | base64 -d > ~/.monkey/models/triposplat/model.py

The adapter also looks in MONKEY_TRIPOSPLAT_REPO if set.

Adapter contract:
  load(spec, model_dir) -> session dict {ckpts}
  run(session, args)    -> JSON {output_path, format, bytes, gaussians} | ERREUR: ...
  unload(session)       -> no-op
"""
from __future__ import annotations

import importlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

_MIN_GAUSSIANS = 32768   # TripoSplatPipeline._NUM_GAUSSIANS_MIN
_MAX_GAUSSIANS = 262144  # TripoSplatPipeline._NUM_GAUSSIANS_MAX
_DEFAULT_GAUSSIANS = _MIN_GAUSSIANS  # lowest valid count = lowest RAM; caller can raise
_MIN_STEPS = 4
_MAX_STEPS = 20
_DEFAULT_STEPS = 10  # runtime default is 20 but doubles runtime for little gain on MPS
_RUN_TIMEOUT_S = 1800  # hard cap on one conversion (worker is killed past this)
_RESULT_MARKER = "MONKEY_RESULT:"


def load(spec: dict, model_dir) -> dict:
    """Cheap session: just resolve the ckpts dir. Heavy weights are loaded by
    the runtime on first run() so loading the catalog never imports torch."""
    return {"ckpts": str(model_dir)}


def _import_runtime(ckpts: str):
    """Import the official triposplat runtime module, or None.

    Search order:
      1. MONKEY_TRIPOSPLAT_REPO env var (clone of VAST-AI-Research/TripoSplat)
      2. ckpts dir itself (triposplat.py + model.py bundled alongside weights)
    """
    candidates = []
    repo = os.environ.get("MONKEY_TRIPOSPLAT_REPO")
    if repo and os.path.isdir(repo):
        candidates.append(repo)
    if ckpts and os.path.isdir(ckpts):
        candidates.append(ckpts)

    for path in candidates:
        if path not in sys.path:
            sys.path.insert(0, path)

    try:
        return importlib.import_module("triposplat")
    except Exception:
        return None


def _runtime_present(ckpts: str) -> bool:
    """Check for triposplat.py on disk without importing it (importing pulls
    torch into the calling process, which we never want in the sidecar)."""
    repo = os.environ.get("MONKEY_TRIPOSPLAT_REPO")
    bases = [repo] if repo and os.path.isdir(repo) else []
    if ckpts and os.path.isdir(ckpts):
        bases.append(ckpts)
    return any(os.path.isfile(os.path.join(b, "triposplat.py")) for b in bases)


def _pick_device() -> str:
    """Best available compute device: CUDA > MPS (Apple Silicon) > CPU.

    The default MPS high-watermark guard is kept on purpose: it aborts the
    run with an error instead of letting the allocator swap-storm the whole
    machine. Lower `gaussians` (or set PYTORCH_MPS_HIGH_WATERMARK_RATIO
    yourself) if the guard fires."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def _free_ollama_vram() -> None:
    """Best-effort: ask Ollama to unload resident models before the conversion.

    On Apple Silicon the Metal pool is shared across processes; a resident
    Ollama model counts against torch's MPS budget ("other allocations") and
    OOMs the worker even though the worker itself allocated little. No-op if
    Ollama isn't running. Models reload on the next chat request."""
    import urllib.request
    base = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    try:
        with urllib.request.urlopen(base + "/api/ps", timeout=2) as r:
            models = json.loads(r.read().decode()).get("models") or []
        for m in models:
            name = m.get("name") or m.get("model")
            if not name:
                continue
            req = urllib.request.Request(
                base + "/api/generate",
                data=json.dumps({"model": name, "keep_alive": 0}).encode(),
                headers={"Content-Type": "application/json"}, method="POST",
            )
            urllib.request.urlopen(req, timeout=15).read()
    except Exception:
        pass


def run(session: dict, args: dict) -> str:
    """Validate args, then run the conversion in a child process.

    Subprocess on purpose: torch + the MPS allocator pools never release
    memory back to the OS, so an in-process run would leave the sidecar
    holding tens of GB forever. The child exits after one conversion and all
    of it is returned. An OOM kill also only takes down the child — the
    sidecar survives and reports a clean ERREUR."""
    args = args or {}
    image_path = (args.get("image_path") or "").strip()
    if not image_path:
        return "ERREUR: image_path required"
    if not os.path.exists(image_path):
        return f"ERREUR: file not found: {image_path}"

    ckpts = (session or {}).get("ckpts") or ""
    if not ckpts or not os.path.isdir(ckpts):
        return "ERREUR: TripoSplat weights not found on disk (install the model first)"

    gaussians = args.get("gaussians")
    try:
        gaussians = int(gaussians) if gaussians is not None else _DEFAULT_GAUSSIANS
    except (TypeError, ValueError):
        return "ERREUR: gaussians must be an integer"
    gaussians = max(_MIN_GAUSSIANS, min(_MAX_GAUSSIANS, gaussians))

    steps = args.get("steps")
    try:
        steps = int(steps) if steps is not None else _DEFAULT_STEPS
    except (TypeError, ValueError):
        return "ERREUR: steps must be an integer"
    steps = max(_MIN_STEPS, min(_MAX_STEPS, steps))

    if importlib.util.find_spec("torch") is None:
        return ("ERREUR: torch not installed — required for TripoSplat "
                "(pip install torch torchvision)")

    if not _runtime_present(ckpts):
        return (
            "ERREUR: TripoSplat runtime not available. Weights are installed but the "
            "inference code is missing. Run:\n"
            "  gh api repos/VAST-AI-Research/TripoSplat/contents/triposplat.py --jq '.content' | base64 -d > ~/.monkey/models/triposplat/triposplat.py\n"
            "  gh api repos/VAST-AI-Research/TripoSplat/contents/model.py --jq '.content' | base64 -d > ~/.monkey/models/triposplat/model.py"
        )

    # Output dir: caller (main.py) passes <workspace>/3d/ so assets land in
    # the user's visible agent folder, not a hidden dot-directory.
    _out_dir_str = args.get("out_dir") or str(Path.home() / ".monkey" / "3d")
    out_dir = Path(_out_dir_str)
    out_dir.mkdir(parents=True, exist_ok=True)
    # The sidecar's temp input file already carries a "-<epoch>" suffix; strip
    # it so the output doesn't end up with two timestamps.
    stem = re.sub(r"-\d{9,}$", "", Path(image_path).stem)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem)[:40].strip("._-") or "asset"
    out = out_dir / f"{stem}-{int(time.time())}.ply"

    payload = json.dumps({
        "image_path": image_path,
        "ckpts": ckpts,
        "gaussians": gaussians,
        "steps": steps,
        "out": str(out),
    })
    _free_ollama_vram()
    try:
        proc = subprocess.run(
            [sys.executable, os.path.abspath(__file__), "--worker", payload],
            capture_output=True, text=True, timeout=_RUN_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired:
        return f"ERREUR: TripoSplat conversion timed out after {_RUN_TIMEOUT_S}s (worker killed)"
    except Exception as e:
        return f"ERREUR: failed to spawn TripoSplat worker: {e}"

    for line in reversed((proc.stdout or "").splitlines()):
        if line.startswith(_RESULT_MARKER):
            return line[len(_RESULT_MARKER):]
    tail = (proc.stderr or "").strip().splitlines()[-3:]
    detail = " | ".join(tail) if tail else f"exit code {proc.returncode}"
    return f"ERREUR: TripoSplat worker died without a result ({detail})"


def _cap_mps_memory() -> None:
    """Cap the worker's Metal allocations to half the machine's physical RAM.

    torch's default MPS high watermark (1.7 × recommendedMaxWorkingSetSize)
    lets one job claim far more than physical RAM and swap-storm the whole
    machine. Half of RAM keeps the OS, the app and Ollama alive; past it the
    job aborts with a clean MPS OOM that run() turns into an ERREUR."""
    import torch
    try:
        total = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        rec = torch.mps.recommended_max_memory()
        if total > 0 and rec > 0:
            torch.mps.set_per_process_memory_fraction(max(0.1, (total / 2) / rec))
    except Exception:
        pass


def _patch_mps_attention() -> None:
    """Swap the runtime's fused-SDPA wrapper for chunked manual attention.

    On MPS, F.scaled_dot_product_attention at this sequence length (~10k
    tokens) routes through MPSGraph: a single flow-model forward balloons
    process-wide Metal "other allocations" to ~26 GiB and trips the 27.2 GiB
    high-watermark guard (reproduced in isolation, empty GPU). Manual
    matmul+softmax stays inside torch's MPS allocator, plateaus around 20 GiB
    driver-allocated, and completes. Chunked over queries to bound the
    transient attention matrix. Only the runtime's own wrapper is patched —
    DINOv3/BiRefNet call F.scaled_dot_product_attention directly and are fine."""
    import importlib
    import math

    import torch

    model_mod = importlib.import_module("model")

    def _sdpa_chunked(qkv=None, q=None, k=None, v=None, kv=None):
        if qkv is not None:
            q, k, v = qkv.unbind(dim=2)
        elif kv is not None:
            k, v = kv.unbind(dim=2)
        q = q.permute(0, 2, 1, 3)
        k = k.permute(0, 2, 1, 3)
        v = v.permute(0, 2, 1, 3)
        scale = 1.0 / math.sqrt(q.shape[-1])
        kt = k.transpose(-2, -1)
        step = 2048
        chunks = []
        for i in range(0, q.shape[2], step):
            attn = (q[:, :, i:i + step] @ kt) * scale
            attn = attn.softmax(dim=-1, dtype=torch.float32).to(v.dtype)
            chunks.append(attn @ v)
        return torch.cat(chunks, dim=2).permute(0, 2, 1, 3)

    model_mod.scaled_dot_product_attention = _sdpa_chunked


def _worker_main(payload: str) -> int:
    """Child-process entry: one conversion, print result on a marker line, exit."""
    try:
        args = json.loads(payload)
    except Exception as e:
        print(f"{_RESULT_MARKER}ERREUR: bad worker payload: {e}")
        return 1

    rt = _import_runtime(args["ckpts"])
    if rt is None:
        print(f"{_RESULT_MARKER}ERREUR: TripoSplat runtime import failed in worker")
        return 1
    Pipeline = getattr(rt, "TripoSplatPipeline", None)
    if Pipeline is None:
        print(f"{_RESULT_MARKER}ERREUR: TripoSplat module present but TripoSplatPipeline class not found")
        return 1

    ckpts = args["ckpts"]
    out = args["out"]
    device = _pick_device()
    if device == "mps":
        _cap_mps_memory()
        try:
            _patch_mps_attention()
        except Exception as e:
            print(f"{_RESULT_MARKER}ERREUR: MPS attention patch failed: {e}")
            return 1
    try:
        pipe = Pipeline(
            ckpt_path=os.path.join(ckpts, "diffusion_models", "triposplat_fp16.safetensors"),
            decoder_path=os.path.join(ckpts, "vae", "triposplat_vae_decoder_fp16.safetensors"),
            dinov3_path=os.path.join(ckpts, "clip_vision", "dino_v3_vit_h.safetensors"),
            flux2_vae_encoder_path=os.path.join(ckpts, "vae", "flux2-vae.safetensors"),
            rmbg_path=os.path.join(ckpts, "background_removal", "birefnet.safetensors"),
            device=device,
        )
        gaussian, _ = pipe.run(args["image_path"], num_gaussians=args["gaussians"],
                               steps=int(args.get("steps") or _DEFAULT_STEPS))
        gaussian.save_ply(out)
    except Exception as e:
        msg = str(e)
        if "out of memory" in msg.lower():
            msg += " — quit GPU-heavy apps (browser, Docker, other models) and retry"
        print(f"{_RESULT_MARKER}ERREUR: TripoSplat inference failed: {msg}")
        return 1

    if not os.path.exists(out):
        print(f"{_RESULT_MARKER}ERREUR: TripoSplat produced no output file")
        return 1
    print(_RESULT_MARKER + json.dumps({
        "output_path": out,
        "format": "ply",
        "bytes": os.path.getsize(out),
        "gaussians": args["gaussians"],
    }, ensure_ascii=False))
    return 0


def unload(session) -> None:  # pragma: no cover - no resident process
    return None


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        sys.exit(_worker_main(sys.argv[2]))
    print(f"{_RESULT_MARKER}ERREUR: usage: triposplat.py --worker <json>")
    sys.exit(2)

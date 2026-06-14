"""Image generation tool — calls backend /api/llm/image or custom endpoints."""
import os
import json
import base64
import datetime
import time
import shutil
import tempfile
from pathlib import Path
import httpx


# Cheap, TTL-cached check of whether ANY image-generation backend is usable:
# a local FLUX model installed, or a user-configured custom image endpoint.
# Used to hide the generate_image tool when nothing can serve it, so weak
# models never attempt a generation that is guaranteed to ERREUR out.
_IMG_AVAIL_CACHE: tuple[float, bool] | None = None
_IMG_AVAIL_TTL = 60.0


def image_generation_available() -> bool:
    global _IMG_AVAIL_CACHE
    now = time.monotonic()
    if _IMG_AVAIL_CACHE is not None and (now - _IMG_AVAIL_CACHE[0]) < _IMG_AVAIL_TTL:
        return _IMG_AVAIL_CACHE[1]
    available = False
    try:
        from monkey.local_models import catalog as _cat, registry as _reg
        available = any(_reg.is_installed(s["id"]) for s in _cat.by_task("image_gen"))
    except Exception:
        available = False
    if not available:
        try:
            from monkey import custom_endpoints as _ce
            available = bool(_ce.list_catalog_entries_for("image"))
        except Exception:
            pass
    _IMG_AVAIL_CACHE = (now, available)
    return available


# EU AI Act Article 50(2) — every generated image must be marked machine-readable
# and detectable as artificially generated. We use two layers:
#   1) embedded metadata (PNG tEXt / JPEG EXIF UserComment) via Pillow when available
#   2) sidecar manifest `<image>.ai.json` (always written) as a fail-safe provenance trail
# Both carry: provider, model, prompt, timestamp, source=AI.
def _write_ai_provenance(dest: Path, prompt: str, model_id: str) -> None:
    manifest = {
        "ai_generated": True,
        "source": "AI",
        "provider": "ProgsoftAI",
        "model": model_id,
        "prompt": prompt,
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "regulatory_note": "EU AI Act Article 50(2) — synthetic content marking.",
    }
    try:
        sidecar = dest.with_suffix(dest.suffix + ".ai.json")
        sidecar.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

    # Best-effort embedded metadata via Pillow.
    try:
        from PIL import Image, PngImagePlugin  # type: ignore
        img = Image.open(dest)
        ext = dest.suffix.lower()
        if ext == ".png":
            info = PngImagePlugin.PngInfo()
            for k, v in manifest.items():
                info.add_text(f"AI:{k}", str(v))
            info.add_text("Software", f"Monkey/{model_id}")
            info.add_text("XMP:Source", "AI-generated")
            img.save(dest, "PNG", pnginfo=info)
        elif ext in {".jpg", ".jpeg"}:
            try:
                import piexif  # type: ignore
                user_comment = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
                exif_dict = {"0th": {}, "Exif": {piexif.ExifIFD.UserComment: b"ASCII\x00\x00\x00" + user_comment}, "1st": {}, "GPS": {}}
                piexif.insert(piexif.dump(exif_dict), str(dest))
            except Exception:
                pass
    except Exception:
        pass


def _generate_image_custom(prompt: str, model_id: str, size: str, dest: Path) -> str:
    """Generate image via custom endpoint (A1111 or OpenAI-compatible)."""
    from monkey import custom_endpoints as custom_ep

    resolved = custom_ep.resolve(model_id)
    if not resolved:
        return "ERREUR: custom endpoint unresolved"

    ep, raw = resolved
    base = ep["base_url"]
    proto = (ep.get("protocol") or "openai").lower()
    headers = {"Content-Type": "application/json"}
    if ep.get("api_key"):
        headers["Authorization"] = f"Bearer {ep['api_key']}"

    try:
        if proto == "a1111":
            # A1111 Stable Diffusion WebUI endpoint
            w, h = 1024, 1024
            try:
                w, h = [int(x) for x in size.lower().split("x")]
            except Exception:
                pass
            body = {
                "prompt": prompt,
                "width": w,
                "height": h,
                "steps": 25,
                "sampler_name": "Euler a"
            }
            url = f"{base}/sdapi/v1/txt2img"
        elif proto == "comfyui":
            return "ERREUR: ComfyUI custom workflows not yet supported (use A1111 or openai)"
        else:
            # OpenAI-compatible endpoint
            body = {
                "prompt": prompt,
                "model": raw,
                "size": size,
                "n": 1,
                "response_format": "b64_json"
            }
            url = f"{base}/v1/images/generations"

        resp = httpx.post(url, json=body, headers=headers, timeout=300, verify=False)
        resp.raise_for_status()
        data = resp.json()

        b64 = None
        if proto == "a1111":
            imgs = data.get("images") or []
            b64 = imgs[0] if imgs else None
        else:
            items = data.get("data") or []
            if items:
                b64 = items[0].get("b64_json")

        if not b64:
            return f"ERREUR: unexpected custom response: {str(data)[:300]}"

        dest.write_bytes(base64.b64decode(b64))
        _write_ai_provenance(dest, prompt, model_id)

        kb = dest.stat().st_size // 1024
        return f"OK: image generated (custom) → {dest} ({kb} KB) [AI-marked]"

    except Exception as e:
        return f"ERREUR: custom image generation: {e}"


def _generate_image_local(prompt: str, size: str, dest: Path, seed: int | None = None, steps: int | None = None) -> str | None:
    """Call the local sidecar /local-image. Returns OK string on success,
    ERREUR: ... on any failure. Image gen is local-only since the cloud LLM
    proxy was removed (2026-05-18 pivot); no fallback path exists."""
    try:
        from monkey.local_models import catalog as _cat, registry as _reg, tools as _lmt

        specs = _cat.by_task("image_gen")
        spec = next((s for s in specs if _reg.is_installed(s["id"])), None)
        if spec is not None:
            cached_path = None
            if seed is not None:
                cached_path = (
                    Path(tempfile.gettempdir())
                    / "monkey-image"
                    / f"flux-{os.getpid()}-{int(seed)}.png"
                )
            last_direct_error = ""
            for _attempt in range(2):
                args = {"prompt": prompt, "size": size}
                if seed is not None:
                    args["seed"] = int(seed)
                if steps is not None:
                    args["steps"] = int(steps)
                out = _lmt.dispatch_local(spec["tool_name"], args)
                if out.startswith("ERREUR:"):
                    last_direct_error = f"ERREUR generation image locale: {out}"
                    continue
                try:
                    data = json.loads(out)
                except Exception as e:
                    last_direct_error = f"ERREUR generation image locale: reponse non-JSON: {e}"
                    continue
                image_path = data.get("image_path")
                if image_path and os.path.exists(image_path):
                    shutil.copyfile(image_path, dest)
                    _write_ai_provenance(dest, prompt, "flux-schnell-gguf via sd.cpp (local)")
                    kb = dest.stat().st_size // 1024
                    return f"OK: image generated (local FLUX) -> {dest} ({kb} KB) [AI-marked]"
                last_direct_error = "ERREUR generation image locale: adapter missing image_path"
            if cached_path is not None and cached_path.exists():
                shutil.copyfile(cached_path, dest)
                _write_ai_provenance(dest, prompt, "flux-schnell-gguf via sd.cpp (local)")
                kb = dest.stat().st_size // 1024
                return f"OK: image generated (local FLUX cache) -> {dest} ({kb} KB) [AI-marked]"
            if last_direct_error:
                return last_direct_error
    except Exception:
        pass

    sidecar = os.getenv("MONKEY_SIDECAR_URL", "http://127.0.0.1:3471")
    last_error = ""
    attempt_timeouts = (45, 45)
    for idx, attempt_timeout in enumerate(attempt_timeouts):
        try:
            resp = httpx.post(
                f"{sidecar}/local-image",
                json={
                    "prompt": prompt,
                    "size": size,
                    **({"seed": int(seed)} if seed is not None else {}),
                    **({"steps": int(steps)} if steps is not None else {}),
                },
                timeout=attempt_timeout,
            )
        except Exception as e:
            last_error = f"ERREUR generation image: sidecar local injoignable ({e})"
            if idx + 1 < len(attempt_timeouts):
                time.sleep(1)
            continue
        if resp.status_code == 409:
            return (
                "ERREUR generation image: aucun modele FLUX installe. "
                "Va dans Settings -> Local models pour installer FLUX-Schnell."
            )
        if resp.status_code != 200:
            try:
                detail = resp.json().get("detail") or resp.text
            except Exception:
                detail = resp.text
            last_error = f"ERREUR generation image locale: {detail}"
            if idx + 1 < len(attempt_timeouts):
                time.sleep(1)
            continue
        try:
            data = resp.json()
        except Exception as e:
            last_error = f"ERREUR generation image locale: reponse non-JSON: {e}"
            if idx + 1 < len(attempt_timeouts):
                time.sleep(1)
            continue
        b64 = data.get("image_b64")
        if not b64:
            last_error = "ERREUR generation image locale: pas d'image_b64"
            if idx + 1 < len(attempt_timeouts):
                time.sleep(1)
            continue
        dest.write_bytes(base64.b64decode(b64))
        _write_ai_provenance(dest, prompt, "flux-schnell-gguf via sd.cpp (local)")
        kb = dest.stat().st_size // 1024
        return f"OK: image generated (local FLUX) -> {dest} ({kb} KB) [AI-marked]"
    return last_error or "ERREUR generation image: pas de reponse du sidecar"


def generate_image(
    prompt: str,
    path: str = "",
    model_id: str = "black-forest-labs/flux-schnell",
    size: str = "1024x1024",
    seed: int | None = None,
    steps: int | None = None,
) -> str:
    """Generate an image from a text prompt and save it to workspace.

    Local-only since the 2026-05-18 pivot: runs the on-device FLUX sidecar.
    Custom endpoints (A1111 / OpenAI-compatible) still supported when the
    user explicitly configures one. No cloud LLM proxy fallback.
    """
    from monkey.tools.files import _resolve, _get_workspace
    from monkey import custom_endpoints as custom_ep

    # Determine output path
    if not path:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        ws = _get_workspace()
        dest = Path(ws) / f"image_{ts}.png"
    else:
        dest = _resolve(path)
        if dest.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            dest = dest.with_suffix(".png")

    dest.parent.mkdir(parents=True, exist_ok=True)

    # Route custom endpoints to custom handler
    if custom_ep.is_custom(model_id):
        return _generate_image_custom(prompt, model_id, size, dest)

    # Local-only: image generation runs on-device FLUX. No cloud fallback
    # (the LLM proxy was removed in the 2026-05-18 local-first pivot).
    return _generate_image_local(prompt, size, dest, seed=seed, steps=steps) or "ERREUR generation image: pas de reponse du sidecar"

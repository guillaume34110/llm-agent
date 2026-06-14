"""Video generation tool — calls backend /api/llm/video or custom endpoints."""
import os
import json
import base64
import datetime
from pathlib import Path
import httpx


# EU AI Act Article 50(2) — every generated video must be marked machine-readable
# and detectable as artificially generated. We use sidecar manifest `<video>.ai.json`.
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


def _generate_video_custom(prompt: str, model_id: str, duration: int, aspect_ratio: str, dest: Path) -> str:
    """Generate video via custom endpoint (OpenAI-compatible video endpoint)."""
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
        if proto != "openai":
            return f"ERREUR: video generation only supports openai protocol (endpoint configured: {proto})"

        body = {
            "model": raw,
            "prompt": prompt,
            "n": 1,
            "response_format": "b64_json"
        }
        url = f"{base}/v1/videos/generations"

        resp = httpx.post(url, json=body, headers=headers, timeout=600, verify=False)
        resp.raise_for_status()
        data = resp.json()

        b64 = None
        items = data.get("data") or []
        if items:
            b64 = items[0].get("b64_json")

        if not b64:
            return f"ERREUR: unexpected custom response: {str(data)[:300]}"

        dest.write_bytes(base64.b64decode(b64))
        _write_ai_provenance(dest, prompt, model_id)

        kb = dest.stat().st_size // 1024
        return f"OK: video generated (custom) → {dest} ({kb} KB) [AI-marked]"

    except Exception as e:
        return f"ERREUR: custom video generation: {e}"


def generate_video(prompt: str, path: str = "", model_id: str = "kwaivgi/kling-video-o1", duration: int = 5, aspect_ratio: str = "16:9") -> str:
    """Generate a video from a text prompt and save it to workspace."""
    from monkey import store
    from monkey.tools.files import _resolve, _get_workspace
    from monkey import custom_endpoints as custom_ep

    # Determine output path
    if not path:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        ws = _get_workspace()
        dest = Path(ws) / f"video_{ts}.mp4"
    else:
        dest = _resolve(path)
        if dest.suffix.lower() not in {".mp4", ".mov", ".avi", ".webm"}:
            dest = dest.with_suffix(".mp4")

    dest.parent.mkdir(parents=True, exist_ok=True)

    # Route custom endpoints to custom handler
    if custom_ep.is_custom(model_id):
        return _generate_video_custom(prompt, model_id, duration, aspect_ratio, dest)

    BACKEND_URL = os.getenv("MONKEY_BACKEND_URL", "https://ai.progsoft.eu")
    token = store.get("TOKEN") or ""

    try:
        resp = httpx.post(
            f"{BACKEND_URL}/api/llm/video",
            json={"prompt": prompt, "model": model_id, "durationSec": duration, "aspectRatio": aspect_ratio},
            headers={"Cookie": f"token={token}", "Content-Type": "application/json"},
            timeout=300,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("videoBase64"):
            format_ext = data.get("format", "mp4")
            if dest.suffix.lower() != f".{format_ext}":
                dest = dest.with_suffix(f".{format_ext}")
            dest.write_bytes(base64.b64decode(data["videoBase64"]))
        else:
            return f"ERREUR: unexpected backend response: {data}"

        # EU AI Act Art. 50(2) — mark synthetic content (sidecar manifest).
        _write_ai_provenance(dest, prompt, model_id)

        size_kb = dest.stat().st_size // 1024
        return f"OK: video generated → {dest} ({size_kb} KB) [AI-marked]"

    except Exception as e:
        return f"ERREUR video generation: {e}"

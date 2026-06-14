"""Music generation tool — calls backend /api/llm/music or custom endpoints."""
import os
import json
import base64
import datetime
from pathlib import Path
import httpx


# EU AI Act Article 50(2) — every generated audio must be marked machine-readable
# and detectable as artificially generated. Two marks (always-on, non-degrading):
#   1. Sidecar manifest `<audio>.ai.json` (works for any format)
#   2. Embedded RIFF LIST/INFO chunk for WAV files (no audio degradation)
def _embed_wav_info(dest: Path, prompt: str, model_id: str) -> None:
    """Append a LIST/INFO chunk to a WAV file (RIFF). Non-degrading."""
    try:
        data = dest.read_bytes()
        if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            return
        def _pad(b: bytes) -> bytes:
            return b + b"\x00" if len(b) % 2 else b
        def _entry(tag: bytes, value: str) -> bytes:
            payload = value.encode("utf-8", errors="ignore") + b"\x00"
            payload = _pad(payload)
            return tag + len(payload).to_bytes(4, "little") + payload
        entries = (
            _entry(b"IART", "ProgsoftAI")
            + _entry(b"ICMT", f"AI-generated; model={model_id}; EU AI Act Art. 50(2)")
            + _entry(b"ISFT", "ProgsoftAI")
            + _entry(b"ISBJ", prompt[:200])
        )
        list_body = b"INFO" + entries
        list_chunk = b"LIST" + len(list_body).to_bytes(4, "little") + list_body
        new_size = len(data) - 8 + len(list_chunk)
        new_data = b"RIFF" + new_size.to_bytes(4, "little") + data[8:] + list_chunk
        dest.write_bytes(new_data)
    except Exception:
        pass


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
    if dest.suffix.lower() == ".wav":
        _embed_wav_info(dest, prompt, model_id)


def _generate_music_custom(prompt: str, model_id: str, dest: Path) -> str:
    """Generate music via custom endpoint (OpenAI-compatible audio endpoint)."""
    from monkey import custom_endpoints as custom_ep

    resolved = custom_ep.resolve(model_id)
    if not resolved:
        return "ERREUR: custom endpoint unresolved"

    ep, raw = resolved
    base = ep["base_url"]
    proto = (ep.get("protocol") or "openai").lower()
    headers = {}
    if ep.get("api_key"):
        headers["Authorization"] = f"Bearer {ep['api_key']}"

    try:
        if proto != "openai":
            return f"ERREUR: music generation only supports openai protocol (endpoint configured: {proto})"

        body = {
            "model": raw,
            "input": prompt,
            "voice": "alloy",
            "response_format": "wav"
        }
        url = f"{base}/v1/audio/speech"

        resp = httpx.post(url, json=body, headers=headers, timeout=120, verify=False)
        resp.raise_for_status()

        # OpenAI audio/speech returns raw bytes, not JSON
        dest.write_bytes(resp.content)
        _write_ai_provenance(dest, prompt, model_id)

        kb = dest.stat().st_size // 1024
        return f"OK: music generated (custom) → {dest} ({kb} KB) [AI-marked]"

    except Exception as e:
        return f"ERREUR: custom music generation: {e}"


def generate_music(prompt: str, path: str = "", model_id: str = "google/lyria-3-clip-preview", duration: str = "clip") -> str:
    """Generate music from a text prompt and save it to workspace."""
    from monkey import store
    from monkey.tools.files import _resolve, _get_workspace
    from monkey import custom_endpoints as custom_ep

    # Determine output path
    if not path:
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        ws = _get_workspace()
        dest = Path(ws) / f"music_{ts}.wav"
    else:
        dest = _resolve(path)
        if dest.suffix.lower() not in {".wav", ".mp3", ".ogg", ".flac"}:
            dest = dest.with_suffix(".wav")

    dest.parent.mkdir(parents=True, exist_ok=True)

    # Route custom endpoints to custom handler
    if custom_ep.is_custom(model_id):
        return _generate_music_custom(prompt, model_id, dest)

    BACKEND_URL = os.getenv("MONKEY_BACKEND_URL", "https://ai.progsoft.eu")
    token = store.get("TOKEN") or ""

    try:
        resp = httpx.post(
            f"{BACKEND_URL}/api/llm/music",
            json={"prompt": prompt, "model": model_id},
            headers={"Cookie": f"token={token}", "Content-Type": "application/json"},
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("audioBase64"):
            format_ext = data.get("format", "wav")
            if dest.suffix.lower() != f".{format_ext}":
                dest = dest.with_suffix(f".{format_ext}")
            dest.write_bytes(base64.b64decode(data["audioBase64"]))
        else:
            return f"ERREUR: unexpected backend response: {data}"

        # EU AI Act Art. 50(2) — mark synthetic content (sidecar manifest).
        _write_ai_provenance(dest, prompt, model_id)

        size_kb = dest.stat().st_size // 1024
        return f"OK: musique générée → {dest} ({size_kb} KB) [AI-marked]"

    except Exception as e:
        return f"ERREUR génération musique: {e}"

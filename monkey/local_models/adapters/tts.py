"""Piper TTS adapter. Multilingual via per-language ONNX voices.

A single Piper "model" entry can ship N voice pairs (.onnx + .onnx.json).
We discover them under model_dir/<lang>/<region>/<speaker>/<quality>/ and
keep one voice per top-level language code (fr, en, ...). The agent picks
a voice with the `voice` arg ('fr'|'en'|...); if omitted we fall back to
the first voice discovered.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import wave
from pathlib import Path


_VOICE_NAME_RE = re.compile(r"^([a-z]{2})_", re.I)


def _discover_voices(model_dir: Path) -> dict[str, dict]:
    """Return {lang_code: {onnx, config}} from every .onnx file with a sibling
    .onnx.json. Keeps the first voice per language (alphabetical) so that
    repeated downloads don't change the default arbitrarily."""
    found: dict[str, dict] = {}
    for onnx in sorted(model_dir.rglob("*.onnx")):
        config = onnx.parent / (onnx.name + ".json")
        if not config.exists():
            continue
        m = _VOICE_NAME_RE.match(onnx.name)
        if not m:
            continue
        lang = m.group(1).lower()
        found.setdefault(lang, {"onnx": str(onnx), "config": str(config)})
    return found


def load(spec, model_dir):
    from piper import PiperVoice

    voices_index = _discover_voices(Path(model_dir))
    if not voices_index:
        raise RuntimeError(f"no Piper voices found under {model_dir}")
    voices: dict[str, object] = {}
    for lang, paths in voices_index.items():
        try:
            voices[lang] = PiperVoice.load(paths["onnx"], config_path=paths["config"])
        except TypeError:
            voices[lang] = PiperVoice.load(paths["onnx"])
    return {"voices": voices, "default_lang": next(iter(voices))}


def unload(_session) -> None:
    pass


def _pick_voice(session: dict, requested: str) -> str:
    voices = session["voices"]
    code = (requested or "").strip().lower()[:2]
    if code in voices:
        return code
    return session["default_lang"]


def _synthesize(voice, text: str, wav_file) -> None:
    if hasattr(voice, "synthesize_wav"):
        voice.synthesize_wav(text, wav_file)
    else:
        voice.synthesize(text, wav_file)


def run(session, args: dict) -> str:
    text = (args.get("text") or "").strip()
    if not text:
        return "ERREUR: text required"
    if len(text) > 4000:
        return "ERREUR: text too long (max 4000 chars per call)"

    lang = _pick_voice(session, args.get("voice") or args.get("language") or "")
    voice = session["voices"][lang]

    out_dir = Path(tempfile.gettempdir()) / "monkey-tts"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"speak-{os.getpid()}-{abs(hash(text)) % 10_000_000}.wav"

    try:
        with wave.open(str(out), "wb") as wf:
            _synthesize(voice, text, wf)
    except Exception as e:
        return f"ERREUR: synthesis failed: {e}"

    return json.dumps({
        "audio_path": str(out),
        "voice": lang,
        "bytes": out.stat().st_size,
        "format": "wav",
    }, ensure_ascii=False)

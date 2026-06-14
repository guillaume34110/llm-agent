"""Whisper base via faster-whisper (ctranslate2 runtime, no torch)."""
from __future__ import annotations

import json
from pathlib import Path


def load(spec, model_dir):
    from faster_whisper import WhisperModel
    # faster-whisper expects a directory containing model.bin + tokenizer + vocab.
    # Systran/faster-whisper-base ships those at repo root.
    return WhisperModel(str(model_dir), device="cpu", compute_type="int8")


def unload(_session) -> None:
    pass


def run(session, args: dict) -> str:
    path = (args.get("audio_path") or "").strip()
    if not path:
        return "ERREUR: audio_path required"
    p = Path(path).expanduser()
    if not p.exists():
        return f"ERREUR: file not found: {p}"
    language = (args.get("language") or "").strip() or None

    segments, info = session.transcribe(str(p), language=language, vad_filter=True)
    pieces = []
    for seg in segments:
        pieces.append({"start": seg.start, "end": seg.end, "text": seg.text})
    text = "".join(s["text"] for s in pieces).strip()
    return json.dumps({
        "text": text,
        "language": info.language,
        "language_probability": float(info.language_probability),
        "duration": float(info.duration),
        "segments": pieces[:200],
    }, ensure_ascii=False)

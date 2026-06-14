"""PaddleOCR via rapidocr-onnxruntime (CPU, ONNX).

rapidocr_onnxruntime ships PP-OCRv4 detection + ch_PP-OCRv4 recognition
models inside the wheel — no HuggingFace pull, no torch. The Chinese
recogniser is trained on mixed ch/en text and handles English + accented
Latin glyphs well enough for general document OCR. Detection is
language-agnostic so layout extraction is solid across scripts.

For users who want a Latin-script-tuned recogniser (better FR/ES/IT/DE
accuracy on dense paragraphs), drop a PaddleOCR-v4 latin rec ONNX file at
~/.monkey/models/paddle-ocr-v4/rec_latin.onnx — the adapter picks it up
automatically when MONKEY_PADDLE_REC_LATIN=1.

`runtime: "system"` semantics here = "installable via pip" (the wheel
bundles the models). `binary_available()` returns True when the module
imports successfully. No download cycle in the desktop UI.
"""
from __future__ import annotations

import os
from pathlib import Path


_USER_REC_LATIN = Path.home() / ".monkey" / "models" / "paddle-ocr-v4" / "rec_latin.onnx"


def binary_available() -> bool:
    try:
        import rapidocr_onnxruntime  # noqa: F401
        return True
    except Exception:
        return False


def load(spec, model_dir: Path):
    if not binary_available():
        raise RuntimeError("rapidocr_onnxruntime not installed (pip install rapidocr-onnxruntime)")
    from rapidocr_onnxruntime import RapidOCR

    kwargs: dict = {}
    if os.environ.get("MONKEY_PADDLE_REC_LATIN") and _USER_REC_LATIN.exists():
        kwargs["rec_model_path"] = str(_USER_REC_LATIN)
    engine = RapidOCR(**kwargs)
    return {"engine": engine}


def unload(_session) -> None:
    pass


def _extract_lines(result) -> list[str]:
    """rapidocr returns either list[ [bbox, text, score] ] or None.
    Newer versions may wrap in a TextDetOutput dataclass — handle both."""
    if not result:
        return []
    rows = result
    if hasattr(result, "txts") and getattr(result, "txts", None):
        return [str(t).strip() for t in result.txts if str(t).strip()]
    lines: list[str] = []
    for entry in rows:
        if entry is None:
            continue
        text = None
        if isinstance(entry, (list, tuple)) and len(entry) >= 2:
            text = entry[1]
        elif isinstance(entry, dict):
            text = entry.get("text") or entry.get("txt")
        if text is None:
            continue
        s = str(text).strip()
        if s:
            lines.append(s)
    return lines


def run(session, args: dict) -> str:
    path = (args.get("image_path") or "").strip()
    if not path:
        return "ERREUR: image_path required"
    p = Path(path).expanduser()
    if not p.exists():
        return f"ERREUR: file not found: {p}"
    engine = (session or {}).get("engine") if isinstance(session, dict) else None
    if engine is None:
        return "ERREUR: paddle-ocr engine not loaded"
    try:
        out = engine(str(p))
    except Exception as e:
        return f"ERREUR: paddle-ocr failed: {e}"
    # RapidOCR returns (result, elapsed) on older versions, just result on newer.
    if isinstance(out, tuple) and out:
        result = out[0]
    else:
        result = out
    lines = _extract_lines(result)
    text = "\n".join(lines).strip()
    return text or "OK: (empty)"

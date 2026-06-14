"""Tesseract OCR — system binary, no download.

Probe with `which tesseract`. Tool dispatch goes through pytesseract (already
in requirements). "Installed" = binary present on PATH. The Settings UI shows
a how-to hint when missing (brew install tesseract tesseract-lang on macOS).
"""
from __future__ import annotations

import shutil
from pathlib import Path


def binary_available() -> bool:
    return shutil.which("tesseract") is not None


def load(spec, model_dir):
    # No session to keep — pytesseract just shells out. Return a sentinel.
    if not binary_available():
        raise RuntimeError("tesseract binary not on PATH")
    return {"available": True}


def unload(_session) -> None:
    pass


def run(_session, args: dict) -> str:
    path = (args.get("image_path") or "").strip()
    if not path:
        return "ERREUR: image_path required"
    p = Path(path).expanduser()
    if not p.exists():
        return f"ERREUR: file not found: {p}"
    lang = (args.get("lang") or "fra+eng").strip()
    try:
        import pytesseract
        from PIL import Image
    except Exception as e:
        return f"ERREUR: ocr deps missing: {e}"
    try:
        img = Image.open(str(p))
        text = pytesseract.image_to_string(img, lang=lang)
    except Exception as e:
        return f"ERREUR: ocr failed: {e}"
    return text.strip() or "OK: (empty)"

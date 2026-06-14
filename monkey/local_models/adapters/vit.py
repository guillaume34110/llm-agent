"""ViT image classification — ImageNet-1k labels.

Reads id2label from config.json. Returns top-k softmax results.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import _image_common as _img
from . import _onnx_common as _c


def load(spec, model_dir: Path):
    import onnxruntime as ort
    onnx_path = _c.find_onnx(model_dir)
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    id2label = {}
    cfg_path = model_dir / "config.json"
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            raw = cfg.get("id2label") or {}
            id2label = {int(k): str(v) for k, v in raw.items()}
        except Exception:
            id2label = {}
    return {"sess": sess, "dir": model_dir, "id2label": id2label}


def unload(_session) -> None:
    pass


def _softmax(x: np.ndarray) -> np.ndarray:
    x = x - x.max()
    e = np.exp(x)
    return e / e.sum()


def run(session, args: dict) -> str:
    path = (args.get("image_path") or "").strip()
    if not path:
        return "ERREUR: image_path required"
    p = Path(path).expanduser()
    if not p.exists():
        return f"ERREUR: file not found: {p}"
    top_k = int(args.get("top_k") or 5)
    top_k = max(1, min(20, top_k))
    try:
        pixels = _img.load_image(str(p), session["dir"])
    except Exception as e:
        return f"ERREUR: image preprocess failed: {e}"
    sess = session["sess"]
    input_name = sess.get_inputs()[0].name
    out = sess.run(None, {input_name: pixels.astype(np.float32)})
    logits = out[0][0]
    probs = _softmax(logits)
    idx = np.argsort(-probs)[:top_k]
    id2label = session["id2label"]
    top = [{"label": id2label.get(int(i), str(int(i))), "score": float(probs[i])} for i in idx]
    return json.dumps({"top": top}, ensure_ascii=False)

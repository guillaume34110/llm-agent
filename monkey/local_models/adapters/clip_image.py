"""CLIP image encoder — 512d vector per image.

Uses only the vision_model.onnx variant (text encoder lives in the same repo
but isn't exposed yet; the agent can pair this with the text embed tools if
needed downstream).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import _image_common as _img


def load(spec, model_dir: Path):
    import onnxruntime as ort
    p_vision = model_dir / "onnx" / "vision_model.onnx"
    if not p_vision.exists():
        # Quantized fallback.
        alt = model_dir / "onnx" / "vision_model_quantized.onnx"
        if alt.exists():
            p_vision = alt
        else:
            raise FileNotFoundError(f"vision_model.onnx not found under {model_dir}/onnx/")
    sess = ort.InferenceSession(str(p_vision), providers=["CPUExecutionProvider"])
    return {"sess": sess, "dir": model_dir}


def unload(_session) -> None:
    pass


def run(session, args: dict) -> str:
    path = (args.get("image_path") or "").strip()
    if not path:
        return "ERREUR: image_path required"
    p = Path(path).expanduser()
    if not p.exists():
        return f"ERREUR: file not found: {p}"
    try:
        pixels = _img.load_image(str(p), session["dir"], _img.CLIP_MEAN, _img.CLIP_STD)
    except Exception as e:
        return f"ERREUR: image preprocess failed: {e}"
    sess = session["sess"]
    input_name = sess.get_inputs()[0].name
    out = sess.run(None, {input_name: pixels.astype(np.float32)})
    vec = out[0][0]  # (512,)
    # L2 normalize for cosine similarity.
    n = float(np.linalg.norm(vec))
    if n > 1e-9:
        vec = vec / n
    return json.dumps({"dim": int(vec.shape[0]), "vector": vec.astype(float).tolist()}, ensure_ascii=False)

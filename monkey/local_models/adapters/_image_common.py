"""Shared image preprocessing for vision ONNX adapters.

Mirrors HuggingFace ImageProcessor behaviour with PIL + numpy, no torch.
Reads `preprocessor_config.json` from the model dir for size + mean + std.
Falls back to ImageNet defaults if the config is missing.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np


IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073]
CLIP_STD = [0.26862954, 0.26130258, 0.27577711]


def _read_config(model_dir: Path) -> dict:
    p = model_dir / "preprocessor_config.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _target_size(cfg: dict, default: int = 224) -> int:
    size = cfg.get("size") or cfg.get("crop_size")
    if isinstance(size, dict):
        return int(size.get("height") or size.get("shortest_edge") or default)
    if isinstance(size, int):
        return size
    return default


def load_image(path: str, model_dir: Path, default_mean=IMAGENET_MEAN, default_std=IMAGENET_STD):
    """Load + preprocess. Returns (1, 3, H, W) float32 numpy array."""
    from PIL import Image
    cfg = _read_config(model_dir)
    size = _target_size(cfg, 224)
    mean = cfg.get("image_mean") or default_mean
    std = cfg.get("image_std") or default_std
    img = Image.open(path).convert("RGB")
    # Resize so the shortest edge == size, then center-crop to size x size.
    w, h = img.size
    scale = size / min(w, h)
    new_w, new_h = int(round(w * scale)), int(round(h * scale))
    img = img.resize((new_w, new_h), Image.BICUBIC)
    left = (new_w - size) // 2
    top = (new_h - size) // 2
    img = img.crop((left, top, left + size, top + size))
    arr = np.asarray(img, dtype=np.float32) / 255.0  # HWC
    arr = (arr - np.array(mean, dtype=np.float32)) / np.array(std, dtype=np.float32)
    arr = np.transpose(arr, (2, 0, 1))  # CHW
    return arr[None, ...]  # 1CHW

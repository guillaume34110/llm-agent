"""Shared helpers for ONNX adapters.

All Xenova/* repos follow the same layout: model.onnx (or model_quantized.onnx)
under onnx/, tokenizer.json at root. We try the unquantized first for quality,
fall back to quantized if absent.
"""
from __future__ import annotations

from pathlib import Path


def find_onnx(model_dir: Path) -> Path:
    candidates = [
        model_dir / "onnx" / "model.onnx",
        model_dir / "onnx" / "model_quantized.onnx",
        model_dir / "model.onnx",
        model_dir / "model_quantized.onnx",
    ]
    for c in candidates:
        if c.exists():
            return c
    # Last resort: any .onnx file.
    found = list(model_dir.rglob("*.onnx"))
    if found:
        return found[0]
    raise FileNotFoundError(f"no .onnx file under {model_dir}")


def find_tokenizer(model_dir: Path) -> Path:
    p = model_dir / "tokenizer.json"
    if p.exists():
        return p
    found = list(model_dir.rglob("tokenizer.json"))
    if found:
        return found[0]
    raise FileNotFoundError(f"no tokenizer.json under {model_dir}")


def load_session(model_dir: Path):
    """Returns (onnx_session, tokenizer). Adapters wrap this in their own tuple."""
    import onnxruntime as ort
    from tokenizers import Tokenizer

    onnx_path = find_onnx(model_dir)
    tok_path = find_tokenizer(model_dir)
    # CPU-only by default. Adding CoreML/CUDA = future work.
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    tok = Tokenizer.from_file(str(tok_path))
    return sess, tok


def mean_pool(last_hidden, attention_mask):
    """Mean-pool token embeddings with attention mask. numpy in, numpy out."""
    import numpy as np
    mask = attention_mask.astype(last_hidden.dtype)[..., None]  # (B, T, 1)
    summed = (last_hidden * mask).sum(axis=1)
    counts = np.clip(mask.sum(axis=1), 1e-9, None)
    return summed / counts


def encode_batch(tok, texts: list[str], max_len: int = 512):
    """Tokenize a list of strings. Returns (input_ids, attention_mask) np arrays."""
    import numpy as np
    tok.enable_padding(length=None)
    tok.enable_truncation(max_length=max_len)
    encs = tok.encode_batch(texts)
    ids = np.array([e.ids for e in encs], dtype="int64")
    mask = np.array([e.attention_mask for e in encs], dtype="int64")
    return ids, mask, encs

"""Multilingual E5 small — batch embeddings, 384d, L2-normalized.

E5 convention: input prefixed by "query: " for queries, "passage: " for
indexed docs. We let the caller include the prefix when relevant; default
behavior treats inputs as passages.
"""
from __future__ import annotations

import json

import numpy as np

from . import _onnx_common as _c


def load(spec, model_dir):
    return _c.load_session(model_dir)


def unload(_session) -> None:
    pass


def run(session, args: dict) -> str:
    texts = args.get("texts")
    if not isinstance(texts, list) or not texts:
        return "ERREUR: texts (non-empty list) required"
    texts = [str(t) for t in texts][:64]  # cap batch for safety
    prefix = (args.get("prefix") or "").strip()
    if prefix in ("query", "passage"):
        texts = [f"{prefix}: {t}" for t in texts]

    sess, tok = session
    ids, mask, _ = _c.encode_batch(tok, texts, max_len=512)
    feeds = {i.name: (ids if i.name == "input_ids" else mask) for i in sess.get_inputs()
             if i.name in ("input_ids", "attention_mask")}
    out = sess.run(None, feeds)
    last_hidden = out[0]
    pooled = _c.mean_pool(last_hidden, mask)
    # L2 normalize (standard E5 convention).
    norms = np.linalg.norm(pooled, axis=1, keepdims=True)
    norms = np.clip(norms, 1e-9, None)
    pooled = pooled / norms
    vectors = [row.astype(float).tolist() for row in pooled]
    return json.dumps({"dim": len(vectors[0]) if vectors else 0,
                       "count": len(vectors),
                       "vectors": vectors}, ensure_ascii=False)

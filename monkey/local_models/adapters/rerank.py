"""BGE reranker base — cross-encoder for query/doc relevance scoring.

Tokenization: (query, passage) as a pair. ONNX expects a single concat with
type_ids; tokenizers `encode` with pair input handles it.
"""
from __future__ import annotations

import json

import numpy as np

from . import _onnx_common as _c


def load(spec, model_dir):
    return _c.load_session(model_dir)


def unload(_session) -> None:
    pass


def _encode_pairs(tok, query: str, docs: list[str], max_len: int = 512):
    tok.enable_padding(length=None)
    tok.enable_truncation(max_length=max_len)
    pairs = [(query, d) for d in docs]
    encs = tok.encode_batch(pairs)
    ids = np.array([e.ids for e in encs], dtype="int64")
    mask = np.array([e.attention_mask for e in encs], dtype="int64")
    type_ids = np.array([e.type_ids for e in encs], dtype="int64")
    return ids, mask, type_ids


def run(session, args: dict) -> str:
    query = (args.get("query") or "").strip()
    docs = args.get("documents") or []
    if not query:
        return "ERREUR: query required"
    if not isinstance(docs, list) or not docs:
        return "ERREUR: documents (non-empty list) required"
    docs = [str(d) for d in docs][:50]

    sess, tok = session
    ids, mask, type_ids = _encode_pairs(tok, query, docs)
    feed = {}
    in_names = {i.name for i in sess.get_inputs()}
    if "input_ids" in in_names: feed["input_ids"] = ids
    if "attention_mask" in in_names: feed["attention_mask"] = mask
    if "token_type_ids" in in_names: feed["token_type_ids"] = type_ids
    logits = sess.run(None, feed)[0]  # (N, 1) or (N,)
    scores = logits.reshape(-1).astype(float).tolist()
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    out = [{"index": i, "score": scores[i], "document": docs[i]} for i in ranked]
    return json.dumps({"query": query, "results": out}, ensure_ascii=False)

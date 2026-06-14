"""Multilingual sentiment — Twitter XLM-R 3-class (negative/neutral/positive)."""
from __future__ import annotations

import json

import numpy as np

from . import _onnx_common as _c


def load(spec, model_dir):
    sess, tok = _c.load_session(model_dir)
    id2label: dict[int, str] = {}
    try:
        cfg = json.loads((model_dir / "config.json").read_text())
        for k, v in (cfg.get("id2label") or {}).items():
            id2label[int(k)] = str(v).lower()
    except Exception:
        pass
    if not id2label:
        id2label = {0: "negative", 1: "neutral", 2: "positive"}
    return sess, tok, id2label


def unload(_session) -> None:
    pass


def run(session, args: dict) -> str:
    text = (args.get("text") or "").strip()
    if not text:
        return "ERREUR: text required"
    sess, tok, id2label = session
    ids, mask, _ = _c.encode_batch(tok, [text], max_len=512)
    # BERT models need token_type_ids (all zeros for single-sentence classification);
    # XLM-R / RoBERTa only need input_ids + attention_mask.
    feeds: dict = {}
    for i in sess.get_inputs():
        if i.name == "input_ids":
            feeds[i.name] = ids
        elif i.name == "attention_mask":
            feeds[i.name] = mask
        elif i.name == "token_type_ids":
            feeds[i.name] = np.zeros_like(ids)
    logits = sess.run(None, feeds)[0][0]
    probs = np.exp(logits - logits.max())
    probs = probs / probs.sum()
    best = int(probs.argmax())
    return json.dumps({
        "label": id2label.get(best, str(best)),
        "score": float(probs[best]),
        "all": {id2label.get(int(i), str(i)): float(p) for i, p in enumerate(probs)},
    }, ensure_ascii=False)

"""Camembert NER (FR with dates). Token-level classification → spans."""
from __future__ import annotations

import json

import numpy as np

from . import _onnx_common as _c


def load(spec, model_dir):
    sess, tok = _c.load_session(model_dir)
    # Try to read id2label from config.json (HF convention).
    id2label: dict[int, str] = {}
    try:
        cfg_path = model_dir / "config.json"
        if cfg_path.exists():
            cfg = json.loads(cfg_path.read_text())
            raw = cfg.get("id2label") or {}
            for k, v in raw.items():
                id2label[int(k)] = str(v)
    except Exception:
        pass
    return sess, tok, id2label


def unload(_session) -> None:
    pass


def run(session, args: dict) -> str:
    text = (args.get("text") or "").strip()
    if not text:
        return "ERREUR: text required"
    sess, tok, id2label = session
    ids, mask, encs = _c.encode_batch(tok, [text], max_len=512)
    feeds = {i.name: (ids if i.name == "input_ids" else mask) for i in sess.get_inputs()
             if i.name in ("input_ids", "attention_mask")}
    logits = sess.run(None, feeds)[0]  # (1, T, C)
    pred = logits[0].argmax(axis=-1)
    scores = np.exp(logits[0]) / np.exp(logits[0]).sum(axis=-1, keepdims=True)
    enc = encs[0]
    offsets = enc.offsets
    tokens = enc.tokens

    # Aggregate BIO/Xenova-style tags into spans.
    entities = []
    cur = None
    for idx, (label_id, off, tok_str) in enumerate(zip(pred, offsets, tokens)):
        label = id2label.get(int(label_id), f"LABEL_{int(label_id)}")
        if label == "O" or off == (0, 0):  # special tokens have (0,0) offset
            if cur:
                entities.append(cur); cur = None
            continue
        # B-/I- prefix handling. Some models output "LOC", "ORG" directly.
        base = label.split("-", 1)[-1] if "-" in label else label
        is_begin = label.startswith("B-") or cur is None or cur["label"] != base
        if is_begin:
            if cur:
                entities.append(cur)
            cur = {"label": base, "start": off[0], "end": off[1],
                   "score": float(scores[idx, label_id])}
        else:
            cur["end"] = off[1]
            cur["score"] = min(cur["score"], float(scores[idx, label_id]))
    if cur:
        entities.append(cur)

    # Materialize the entity text from offsets.
    for e in entities:
        e["entity"] = text[e["start"]:e["end"]]
    return json.dumps({"entities": entities}, ensure_ascii=False)

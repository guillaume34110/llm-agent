"""DistilCamemBERT zero-shot via NLI entailment.

Trick: for each candidate label, build hypothesis "Ce texte parle de {label}."
Score = P(entailment) under NLI head. Multi_label = sigmoid-style ranking,
single-label = softmax across labels.
"""
from __future__ import annotations

import json

import numpy as np

from . import _onnx_common as _c


_HYPOTHESIS_FR = "Ce texte parle de {}."


def load(spec, model_dir):
    sess, tok = _c.load_session(model_dir)
    id2label: dict[int, str] = {}
    entail_idx = 0
    try:
        cfg = json.loads((model_dir / "config.json").read_text())
        for k, v in (cfg.get("id2label") or {}).items():
            id2label[int(k)] = str(v).lower()
        for i, lbl in id2label.items():
            if "entail" in lbl:
                entail_idx = i
    except Exception:
        pass
    return sess, tok, entail_idx


def unload(_session) -> None:
    pass


def run(session, args: dict) -> str:
    text = (args.get("text") or "").strip()
    labels = args.get("labels") or []
    if not text:
        return "ERREUR: text required"
    if not isinstance(labels, list) or not labels:
        return "ERREUR: labels (non-empty list) required"
    labels = [str(l) for l in labels][:20]
    multi = bool(args.get("multi_label", False))

    sess, tok, entail_idx = session
    tok.enable_padding(length=None)
    tok.enable_truncation(max_length=512)
    pairs = [(text, _HYPOTHESIS_FR.format(l)) for l in labels]
    encs = tok.encode_batch(pairs)
    ids = np.array([e.ids for e in encs], dtype="int64")
    mask = np.array([e.attention_mask for e in encs], dtype="int64")
    type_ids = np.array([e.type_ids for e in encs], dtype="int64")
    in_names = {i.name for i in sess.get_inputs()}
    feed = {"input_ids": ids, "attention_mask": mask}
    if "token_type_ids" in in_names:
        feed["token_type_ids"] = type_ids
    logits = sess.run(None, feed)[0]  # (N, 3): contradiction, neutral, entailment
    entail_scores = logits[:, entail_idx]

    if multi:
        # Independent sigmoids vs neutral+contradiction baseline.
        contradiction_idx = next((i for i in range(logits.shape[1]) if i != entail_idx and i != 1), 0)
        diff = entail_scores - logits[:, contradiction_idx]
        probs = 1 / (1 + np.exp(-diff))
    else:
        probs = np.exp(entail_scores) / np.exp(entail_scores).sum()

    order = np.argsort(-probs)
    return json.dumps({
        "labels": [labels[i] for i in order],
        "scores": [float(probs[i]) for i in order],
    }, ensure_ascii=False)

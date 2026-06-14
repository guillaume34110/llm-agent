"""XLM-Roberta language ID — multi-class classification."""
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
    ids, mask, _ = _c.encode_batch(tok, [text], max_len=512)
    feeds = {i.name: (ids if i.name == "input_ids" else mask) for i in sess.get_inputs()
             if i.name in ("input_ids", "attention_mask")}
    logits = sess.run(None, feeds)[0][0]
    probs = np.exp(logits) / np.exp(logits).sum()
    order = probs.argsort()[::-1]
    top = [{"lang": id2label.get(int(i), str(i)), "score": float(probs[i])} for i in order[:5]]
    return json.dumps({"lang": top[0]["lang"], "score": top[0]["score"], "top": top},
                      ensure_ascii=False)

"""CamemBERT base — mean-pooled feature extractor for French text."""
from __future__ import annotations

import json

from . import _onnx_common as _c


def load(spec, model_dir):
    return _c.load_session(model_dir)


def unload(_session) -> None:
    pass  # ORT sessions get GC'd; nothing to do.


def run(session, args: dict) -> str:
    text = (args.get("text") or "").strip()
    if not text:
        return "ERREUR: text required"
    sess, tok = session
    ids, mask, _ = _c.encode_batch(tok, [text])
    feeds = {i.name: (ids if i.name == "input_ids" else mask) for i in sess.get_inputs()
             if i.name in ("input_ids", "attention_mask")}
    out = sess.run(None, feeds)
    # Standard BERT output: (last_hidden_state, pooler_output) or just hidden state.
    last_hidden = out[0]
    pooled = _c.mean_pool(last_hidden, mask)
    vec = pooled[0].astype(float).tolist()
    return json.dumps({"dim": len(vec), "vector": vec}, ensure_ascii=False)

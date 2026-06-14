"""Bridge between installed local models and the agent's tool system.

`dynamic_tools()` returns the tool definitions (OpenAI tool-call format) for
all currently installed models. It's called by agent.py each time
`registry.consume_dirty()` flips true, so the LLM sees the up-to-date set on
the next turn.

`dispatch_local(name, args)` routes a tool call to the right adapter. Returns
the same string format as the rest of TOOLS (JSON for structured outputs,
plain text for ocr/asr).

Tool schemas are intentionally small — the description is the load-bearing
part for the LLM. Detailed schema lives inline here, not in catalog.py, so
that adding a new tool to a catalog entry's `extra_tools` keeps schema and
dispatch in one place.

P2P fallback (sidecar tasks only): when a sidecar-backed tool (OCR /
sentiment / image_classify) is invoked but the corresponding local model
isn't installed, `dispatch_local` reaches out to an attested friend
provider serving the same model id over Noise XK. Keeps the agent's tool
surface stable regardless of which user actually hosts the weights.
"""
from __future__ import annotations

import base64 as _b64
import json as _json
import os as _os

from . import catalog as _catalog
from . import registry as _registry
from . import runtime as _runtime


# Tool name → (model_id served over P2P, sidecar task path key).
# Only sidecar tasks have a P2P responder route (provider-runtime/src/sidecar.rs).
_SIDECAR_P2P_MAP: dict[str, tuple[str, str]] = {
    "local_ocr": ("tesseract", "ocr"),
    "local_sentiment": ("xlm-sentiment", "sentiment"),
    "local_image_classify": ("vit-image-classify", "image_classify"),
}


def _fn(name: str, desc: str, props: dict, req: list | None = None) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": desc,
        "parameters": {"type": "object", "properties": props, "required": req or []},
    }}


def _schema_for(spec: dict) -> dict:
    task = spec["task"]
    if task in ("features", "ner", "lang", "sentiment"):
        return {"text": {"type": "string", "description": "Input text"}}
    if task == "image_features":
        return {"image_path": {"type": "string", "description": "Absolute path to an image file"}}
    if task == "image_classify":
        return {
            "image_path": {"type": "string", "description": "Absolute path to an image file"},
            "top_k": {"type": "integer", "description": "Number of top labels to return (default 5, max 20)"},
        }
    if task == "embed":
        return {
            "texts": {"type": "array", "items": {"type": "string"},
                       "description": "List of texts to embed (max 64)"},
            "prefix": {"type": "string", "description": "E5 prefix: 'query' or 'passage' (optional)"},
        }
    if task == "rerank":
        return {
            "query": {"type": "string", "description": "Query"},
            "documents": {"type": "array", "items": {"type": "string"},
                           "description": "Candidate passages to rerank (max 50)"},
        }
    if task == "classify":
        return {
            "text": {"type": "string", "description": "Text to classify"},
            "labels": {"type": "array", "items": {"type": "string"},
                        "description": "Candidate labels (max 20)"},
            "multi_label": {"type": "boolean", "description": "Allow multiple labels (default false)"},
        }
    if task == "asr":
        return {
            "audio_path": {"type": "string", "description": "Absolute path to an audio file"},
            "language": {"type": "string", "description": "Optional ISO code; auto-detect if omitted"},
        }
    if task == "tts":
        return {
            "text": {"type": "string", "description": "Text to synthesize (max 4000 chars)"},
            "voice": {"type": "string", "description": "Voice/language code ('fr', 'en', ...); default = first installed voice"},
        }
    if task == "ocr":
        return {
            "image_path": {"type": "string", "description": "Absolute path to an image file"},
            "lang": {"type": "string", "description": "Optional language code (e.g. 'fra+eng' for tesseract, 'fr' for paddle)."},
            "hints": {
                "type": "object",
                "description": "Optional routing hints. The router picks the best installed engine.",
                "properties": {
                    "handwritten": {"type": "boolean", "description": "Image contains handwriting."},
                    "scientific": {"type": "boolean", "description": "Math/scientific content (formulas, equations)."},
                    "lang": {"type": "string", "description": "Document language ISO code (fr, en, zh, ja, ko, ar, ...)."},
                    "engine": {"type": "string", "description": "Force a specific engine: 'paddle' | 'tesseract'."},
                },
            },
        }
    if task == "image_gen":
        return {
            "prompt": {"type": "string", "description": "Text prompt describing the image"},
            "size": {"type": "string", "description": "WxH (default 1024x1024, multiples of 16 up to 1536)"},
            "seed": {"type": "integer", "description": "Optional seed for reproducibility"},
            "steps": {"type": "integer", "description": "Inference steps (default 4, max 12)"},
        }
    if task == "image_to_3d":
        return {
            "image_path": {"type": "string", "description": "Absolute path to the input image"},
            "gaussians": {"type": "integer", "description": "Optional Gaussian count for quality/perf (max 262144)"},
        }
    return {"text": {"type": "string", "description": "Input"}}


def _required_for(task: str) -> list[str]:
    return {
        "features": ["text"], "ner": ["text"], "lang": ["text"],
        "sentiment": ["text"],
        "embed": ["texts"], "rerank": ["query", "documents"],
        "classify": ["text", "labels"],
        "asr": ["audio_path"], "tts": ["text"], "ocr": ["image_path"],
        "image_features": ["image_path"], "image_classify": ["image_path"],
        "image_gen": ["prompt"], "image_to_3d": ["image_path"],
    }.get(task, [])


def dynamic_tools() -> list[dict]:
    """One tool definition per installed model. OCR specs collide on
    `local_ocr` by design — the router dispatches to the best engine, so we
    emit the unified tool exactly once when any OCR engine is installed."""
    out: list[dict] = []
    seen: set[str] = set()
    for spec in _catalog.all_models():
        if not _registry.is_installed(spec["id"]):
            continue
        name = spec["tool_name"]
        if name in seen:
            continue
        seen.add(name)
        out.append(_fn(
            name, spec["tool_desc"],
            _schema_for(spec), _required_for(spec["task"]),
        ))
    return out


def installed_tool_listing() -> str:
    """Compact bullet list of installed local tools — injected in SYSTEM_PROMPT.
    OCR engines share `local_ocr`; we list each engine on its own line so the
    LLM knows which backends back the unified tool."""
    lines = []
    seen_names: set[str] = set()
    for spec in _catalog.all_models():
        if not _registry.is_installed(spec["id"]):
            continue
        name = spec["tool_name"]
        # For OCR, show every installed engine even though the tool name is shared.
        if spec["task"] == "ocr":
            lines.append(f"  - {name} ({spec['label']}) — ocr engine")
            continue
        if name in seen_names:
            continue
        seen_names.add(name)
        lines.append(f"  - {name} ({spec['label']}) — {spec['task']}")
    if not lines:
        return "  (none installed yet — user can install models in Settings → Modèles locaux)"
    return "\n".join(lines)


# Reverse lookup: tool_name -> spec
def _spec_for_tool(name: str) -> dict | None:
    for spec in _catalog.all_models():
        if spec.get("tool_name") == name:
            return spec
    return None


def is_local_tool(name: str) -> bool:
    return _spec_for_tool(name) is not None


def _build_p2p_payload(task: str, model_id: str, args: dict) -> str | dict:
    """Convert adapter args into the wire shape expected by the sidecar's
    /p2p/<task> endpoint. Returns the JSON payload dict on success, or an
    `ERREUR: ...` string when args don't satisfy the task's requirements."""
    args = args or {}
    payload: dict = {"model": model_id}
    if task in ("ocr", "image_classify"):
        image_path = (args.get("image_path") or "").strip()
        if not image_path:
            return "ERREUR: image_path required"
        if not _os.path.exists(image_path):
            return f"ERREUR: file not found: {image_path}"
        try:
            with open(image_path, "rb") as f:
                raw = f.read()
        except OSError as e:
            return f"ERREUR: cannot read image: {e}"
        payload["image_b64"] = _b64.b64encode(raw).decode("ascii")
        if task == "ocr" and args.get("lang"):
            payload["lang"] = str(args["lang"])
        if task == "ocr" and isinstance(args.get("hints"), dict) and args["hints"]:
            payload["hints"] = args["hints"]
        if task == "image_classify" and args.get("top_k") is not None:
            try:
                payload["top_k"] = int(args["top_k"])
            except (TypeError, ValueError):
                return "ERREUR: top_k must be an integer"
        return payload
    if task == "sentiment":
        text = (args.get("text") or "").strip()
        if not text:
            return "ERREUR: text required"
        payload["text"] = text
        return payload
    return f"ERREUR: unsupported P2P task: {task}"


def _shape_p2p_response(task: str, body: dict) -> str:
    """Map a sidecar P2P response back to the adapter's return contract."""
    if isinstance(body, dict) and body.get("error") == "content_blocked":
        return "ERREUR: friend provider blocked the content"
    if task == "ocr":
        return str(body.get("text") or "").strip() or "OK: (empty)"
    return _json.dumps(body, ensure_ascii=False)


def _p2p_sidecar_fallback(tool_name: str, args: dict) -> str | None:
    """Try to satisfy a sidecar-backed tool via a friend P2P provider.

    Returns:
      - the adapter-shaped string on success,
      - an `ERREUR: ...` string if a friend was reached but failed,
      - None if no friend is available — caller falls back to the original
        "not installed" error so the LLM gets the actionable hint.
    """
    mapped = _SIDECAR_P2P_MAP.get(tool_name)
    if mapped is None:
        return None
    model_id, task = mapped
    try:
        from monkey import llm as _llm
    except Exception:
        return None
    try:
        # OCR has multiple engines (paddle, tesseract) serving the same task —
        # discover friends by task so a paddle-only provider is reachable too.
        # Other sidecar tools are 1:1 (model_id == task adapter), use model_id.
        if tool_name == "local_ocr":
            providers = _llm._list_friend_providers_by_task(task)
        else:
            providers = _llm._list_friend_providers(model_id)
    except Exception:
        return None
    if not providers:
        return None
    attested = [p for p in providers if p.get("attested")]
    pool = attested or providers
    provider = pool[0]
    endpoint = provider.get("networkAddr") or provider.get("endpoint") or ""
    pubkey = provider.get("noisePubkey") or provider.get("publicKey") or ""
    if not endpoint or not pubkey:
        return None
    payload = _build_p2p_payload(task, model_id, args or {})
    if isinstance(payload, str):
        return payload
    try:
        raw = _llm.p2p_noise_call(endpoint, pubkey, _json.dumps(payload).encode("utf-8"))
    except Exception as e:
        return f"ERREUR: P2P {task} failed: {e}"
    try:
        body = _json.loads(raw.decode("utf-8"))
    except Exception as e:
        return f"ERREUR: P2P {task} returned non-JSON: {e}"
    return _shape_p2p_response(task, body)


def _run_model(model_id: str, args: dict) -> str:
    spec = _catalog.by_id(model_id)
    if spec is None:
        return f"ERREUR: unknown model: {model_id}"
    try:
        session = _runtime.get(model_id)
    except Exception as e:
        return f"ERREUR: load failed for {model_id}: {e}"
    try:
        import importlib
        mod = importlib.import_module(f"monkey.local_models.adapters.{spec['adapter']}")
        return mod.run(session, args or {})
    except Exception as e:
        return f"ERREUR: run failed for {model_id}: {e}"


# OCR engine preference order. Routing:
#   - explicit hints.engine wins if installed,
#   - else hints.lang in CJK/Arabic prefers paddle (Tesseract needs extra packs),
#   - else paddle (modern, accurate) > tesseract (system fallback).
_OCR_ENGINES_BY_ID = {
    "paddle": "paddle-ocr-v4",
    "paddleocr": "paddle-ocr-v4",
    "tesseract": "tesseract",
}


def _dispatch_ocr(args: dict) -> str:
    args = args or {}
    hints = args.get("hints") or {}
    forced = (hints.get("engine") or "").strip().lower()
    paddle_ok = _registry.is_installed("paddle-ocr-v4")
    tess_ok = _registry.is_installed("tesseract")

    if forced:
        target = _OCR_ENGINES_BY_ID.get(forced)
        if target is None:
            return f"ERREUR: unknown ocr engine '{forced}' (allowed: paddle, tesseract)"
        if not _registry.is_installed(target):
            return f"ERREUR: ocr engine '{forced}' not installed"
        return _run_model(target, args)

    lang = (hints.get("lang") or "").strip().lower()
    if lang in ("zh", "ja", "ko", "ar") and paddle_ok:
        return _run_model("paddle-ocr-v4", args)

    if paddle_ok:
        return _run_model("paddle-ocr-v4", args)
    if tess_ok:
        return _run_model("tesseract", args)

    fb = _p2p_sidecar_fallback("local_ocr", args)
    if fb is not None:
        return fb
    return ("ERREUR: no OCR engine installed — install one of: "
            "PaddleOCR (pip install rapidocr-onnxruntime) or "
            "Tesseract (brew install tesseract tesseract-lang)")


def dispatch_local(name: str, args: dict) -> str:
    if name == "local_ocr":
        # Smart router — multiple catalog entries can back this tool.
        return _dispatch_ocr(args or {})

    spec = _spec_for_tool(name)
    if spec is None:
        return f"ERREUR: not a local tool: {name}"
    if not _registry.is_installed(spec["id"]):
        fallback = _p2p_sidecar_fallback(name, args or {})
        if fallback is not None:
            return fallback
        return f"ERREUR: local model not installed: {spec['id']} (install in Settings)"
    return _run_model(spec["id"], args)

"""LLM bridge — routes inference to local Ollama, custom endpoints, or friend P2P.

Post-pivot: no commercial cloud proxy. Inference happens either locally via
Ollama (OpenAI-compatible), through a user-configured custom endpoint, or via
an attested friend provider over Noise XK.

`login()` stays — server still owns auth for credits/matchmaking, even if it
never touches inference payloads.
"""
import os
import json
import ssl
import base64
import struct
import urllib.request
import httpx
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import x25519
from monkey import store
from monkey import custom_endpoints as custom_ep

# Backend = auth + credits + matchmaking only. Never inference.
BACKEND_URL = os.getenv("MONKEY_BACKEND_URL", "https://ai.progsoft.eu")

# Local Ollama (OpenAI-compatible). Override via env for non-default install.
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

# Set MONKEY_DEBUG_OLLAMA=<file> to dump the exact request/response of each
# Ollama call to a JSONL file. Useful for debugging small-model tool-calling.
# Off by default; no perf impact when unset.
_DEBUG_OLLAMA_PATH = os.getenv("MONKEY_DEBUG_OLLAMA")


def _debug_dump(tag: str, info: dict) -> None:
    if not _DEBUG_OLLAMA_PATH:
        return
    try:
        with open(_DEBUG_OLLAMA_PATH, "a") as fh:
            fh.write(json.dumps({"tag": tag, **info}, ensure_ascii=False, default=str) + "\n")
    except Exception:
        pass

# Unverified SSL context — used for urllib calls inside PyInstaller bundle
_SSL_CTX = ssl._create_unverified_context()
MONKEY_DIR = os.path.join(os.path.expanduser("~"), ".monkey")
P2P_STATIC_KEY_FILE = os.path.join(MONKEY_DIR, "p2p_static_key.bin")

# Chunked Noise exchange (v2). Wire format documented in
# provider-runtime/src/noise_responder.rs and desktop/src-tauri/src/noise_p2p.rs.
P2P_CHUNK_PT = 65000           # plaintext chunk size; leaves room for 16-byte AEAD tag
P2P_CHUNK_CT_MAX = 65535       # max ciphertext chunk
P2P_MAX_RESPONSE = 32 * 1024 * 1024  # 32 MB ceiling on decrypted response


def _post(url: str, payload: dict, headers: dict | None = None, timeout: int = 30) -> tuple[int, dict, dict]:
    """Simple HTTP POST using urllib (works reliably inside PyInstaller)."""
    data = json.dumps(payload).encode()
    req_headers = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
            body = json.loads(resp.read())
            resp_headers = dict(resp.headers)
            return resp.status, body, resp_headers
    except urllib.error.HTTPError as e:
        body = {}
        try:
            body = json.loads(e.read())
        except Exception:
            pass
        return e.code, body, {}


def _auth_headers() -> dict[str, str]:
    token = store.get("TOKEN")
    if not token:
        raise RuntimeError("P2P routing requires login — no auth token stored.")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _build_payload(messages: list[dict], model_id: str, tools: list[dict] | None, force_tool: bool, temperature: float | None = None) -> dict:
    # Cap output. Default llama-server / Ollama use n_predict=-1 (until ctx limit). A
    # broken GGUF that emits garbage tokens forever otherwise runs the full 32k window,
    # which exceeds tauri-plugin-http's read timeout and surfaces as "error decoding
    # response body" client-side. 2048 covers any sensible chat reply.
    payload: dict = {"messages": messages, "model": model_id, "stream": False, "max_tokens": 2048}
    payload["options"] = {"num_ctx": _max_ctx_for(model_id)}
    if tools:
        payload["tools"] = tools
    # Caller-supplied sampler temperature (maker grid/DSL path). Ignored on
    # force_tool turns, which pin temp=0 below for deterministic JSON.
    if temperature is not None and not (force_tool and tools):
        payload["temperature"] = temperature
    if force_tool and tools:
        payload["tool_choice"] = "required"
        # Deterministic sampler for tool turns. Default temp=0.8/top_p=0.9 lets small
        # models drift into markdown bold inside JSON keys or freeform prose. seed=0
        # makes parser failures reproducible across runs.
        payload["temperature"] = 0.0
        payload["top_p"] = 1.0
        payload["seed"] = 0
        # Cheap-shot grammar constraint via Ollama's OpenAI-compat layer: translates
        # to native `format: "json"` and forces the sampler to emit parseable JSON.
        # Catches markdown bold / unquoted keys; doesn't validate field types. The
        # native /api/chat path used for single-tool force calls applies the full
        # JSON schema constraint instead.
        payload["response_format"] = {"type": "json_object"}
    return payload


def _fold_system_into_user(messages: list[dict]) -> list[dict]:
    """Merge all system messages into the first user message.

    Some chat templates (Ministral-3 family) raise a Jinja exception when fed a
    'system' role: 'Only user, assistant and tool roles are allowed'. Folding
    the system content into the first user turn keeps the instructions in
    context without violating the template.
    """
    sys_chunks: list[str] = []
    rest: list[dict] = []
    for m in messages:
        if m.get("role") == "system":
            c = (m.get("content") or "").strip()
            if c:
                sys_chunks.append(c)
        else:
            rest.append(m)
    if not sys_chunks:
        return rest
    sys_blob = "\n\n".join(sys_chunks)
    for i, m in enumerate(rest):
        if m.get("role") == "user":
            merged = sys_blob + "\n\n" + (m.get("content") or "")
            rest[i] = {**m, "content": merged}
            return rest
    return [{"role": "user", "content": sys_blob}] + rest


# Translate catalog ids (dash-separated) to Ollama tag convention
# (`<family>:<size>`). Used by the Ollama path and the local-mode bundled
# fallback when the bundled llama.cpp build doesn't support a model's
# architecture (e.g. Ministral-3-2512 on llama.cpp b9279).
_OLLAMA_TAG_MAP: dict[str, str] = {
    "ministral-3-3b": "ministral-3:3b",
    "ministral-3-8b": "ministral-3:8b",
    "ministral-3-14b": "ministral-3:14b",
    "llama-3.2-3b-instruct": "llama3.2:3b",
    "llama-3.1-8b-instruct": "llama3.1:8b",
    "phi-4-mini-instruct": "phi4-mini:latest",
    "phi-4": "phi4:latest",
    "qwen3-4b": "qwen3:4b",
    "qwen3-8b": "qwen3:8b",
    "qwen3-14b": "qwen3:14b",
    "qwen3-32b": "qwen3:32b",
    "gemma3-4b": "PetrosStav/gemma3-tools:4b",
}

# Preferred higher-precision quant tags. Default Ollama tags pull Q4_K_M
# which dominates the OpenRouter parity gap for small models: tool_call
# JSON drifts (markdown bold, unquoted keys, wrong types) under Q4
# sampler noise. Q6_K/Q8_0 close most of that gap. _chat_ollama tries
# this tag first and falls back to _OLLAMA_TAG_MAP on 404.
# Quant choice per family is constrained by what Ollama's registry
# publishes: llama3.x has Q6_K; mistral/phi/qwen3 only publish Q8_0
# (verified via ollama.com/library/<model>/tags 2026-05-26).
_OLLAMA_TAG_HIGH_QUANT: dict[str, str] = {
    "ministral-3-3b": "ministral-3:3b-instruct-2512-q8_0",
    "ministral-3-8b": "ministral-3:8b-instruct-2512-q8_0",
    "ministral-3-14b": "ministral-3:14b-instruct-2512-q8_0",
    "llama-3.2-3b-instruct": "llama3.2:3b-instruct-q6_K",
    "llama-3.1-8b-instruct": "llama3.1:8b-instruct-q6_K",
    "phi-4-mini-instruct": "phi4-mini:3.8b-q8_0",
    "phi-4": "phi4:14b-q8_0",
    "qwen3-4b": "qwen3:4b-q8_0",
    "qwen3-8b": "qwen3:8b-q8_0",
    "qwen3-14b": "qwen3:14b-q8_0",
    "qwen3-32b": "qwen3:32b-q8_0",
}


def _to_ollama_tag(model_id: str) -> str:
    return _OLLAMA_TAG_MAP.get(model_id, model_id)


# User directive: cap num_ctx at 56k for all models. Suffices for agent
# workloads and fits the M2 24GB unified-memory budget. Per-model training
# max (e.g. 128k llama, 256k ministral) blows up KV cache and slows infer.
_NUM_CTX_CAP: int = 56 * 1024  # 57344


def _max_ctx_for(model_id: str) -> int:
    """Return num_ctx for a model_id. Flat 56k cap across all models."""
    return _NUM_CTX_CAP


def _ollama_tag_candidates(model_id: str) -> list[str]:
    """Ordered list of Ollama tags to try: Q6_K preferred, default fallback."""
    seen: list[str] = []
    pref = _OLLAMA_TAG_HIGH_QUANT.get(model_id)
    if pref:
        seen.append(pref)
    default = _OLLAMA_TAG_MAP.get(model_id, model_id)
    if default not in seen:
        seen.append(default)
    return seen


def _normalize_endpoint(endpoint: str) -> str:
    value = (endpoint or "").strip()
    if not value:
        raise RuntimeError("Provider missing endpoint.")
    if not value.startswith("http://") and not value.startswith("https://"):
        value = f"http://{value}"
    return value.rstrip("/")


def _load_or_create_p2p_static_key() -> bytes:
    path = Path(P2P_STATIC_KEY_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        data = path.read_bytes()
        if len(data) == 32:
            return data
    key = x25519.X25519PrivateKey.generate()
    raw = key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    path.write_bytes(raw)
    return raw


def _list_friend_providers(model_id: str) -> list[dict]:
    resp = httpx.get(
        f"{BACKEND_URL}/api/presence/friends",
        params={"modelId": model_id},
        headers=_auth_headers(),
        timeout=15,
        verify=False,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"presence/friends HTTP {resp.status_code}: {resp.text[:200]}")
    body = resp.json()
    return body if isinstance(body, list) else []


def _list_friend_providers_by_task(task: str) -> list[dict]:
    """Find friend providers serving a given task (any model_id mapped to it).

    Used by sidecar fallbacks where multiple engines serve the same task
    (e.g. OCR can be paddle-ocr-v4 or tesseract on the remote side).
    """
    resp = httpx.get(
        f"{BACKEND_URL}/api/presence/friends",
        params={"task": task},
        headers=_auth_headers(),
        timeout=15,
        verify=False,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"presence/friends HTTP {resp.status_code}: {resp.text[:200]}")
    body = resp.json()
    return body if isinstance(body, list) else []


def _require_noise():
    try:
        from noise.connection import NoiseConnection, Keypair
    except Exception as e:
        raise RuntimeError(
            "Friend P2P routing requires Python package 'noiseprotocol'. "
            "Reinstall the sidecar dependencies."
        ) from e
    return NoiseConnection, Keypair


def p2p_noise_call(endpoint: str, provider_pubkey_b64: str, payload_bytes: bytes) -> bytes:
    """Run a Noise XK handshake + chunked transport exchange with a provider.

    Wire format v2 — mirrors desktop/src-tauri/src/noise_p2p.rs and
    provider-runtime/src/noise_responder.rs:

      handshake POST → msg1, reply msg2 + X-P2P-Session header
      exchange  POST body =
        [u32 BE msg3_len][msg3 (empty Noise pt)]
        [u32 BE n_chunks][for each: u32 BE ct_len + ct]
      exchange reply =
        [u32 BE n_chunks][for each: u32 BE ct_len + ct]

    Chunking lets us ship payloads larger than 65535 bytes (e.g. base64
    images for OCR or vision).
    """
    NoiseConnection, Keypair = _require_noise()
    try:
        provider_pubkey = base64.b64decode(provider_pubkey_b64)
    except Exception as e:
        raise RuntimeError(f"Provider pubkey is invalid base64: {e}") from e
    if len(provider_pubkey) != 32:
        raise RuntimeError(f"Provider pubkey must be 32 bytes, got {len(provider_pubkey)}")

    noise = NoiseConnection.from_name(b"Noise_XK_25519_ChaChaPoly_BLAKE2s")
    noise.set_as_initiator()
    noise.set_keypair_from_private_bytes(Keypair.STATIC, _load_or_create_p2p_static_key())
    noise.set_keypair_from_public_bytes(Keypair.REMOTE_STATIC, provider_pubkey)
    noise.start_handshake()

    endpoint = _normalize_endpoint(endpoint)
    msg1 = bytes(noise.write_message())
    hs_resp = httpx.post(
        f"{endpoint}/p2p/noise/handshake",
        content=msg1,
        headers={"Content-Type": "application/octet-stream"},
        timeout=30,
        verify=False,
    )
    if hs_resp.status_code >= 400:
        raise RuntimeError(f"P2P handshake HTTP {hs_resp.status_code}: {hs_resp.text[:200]}")
    session_id = hs_resp.headers.get("X-P2P-Session")
    if not session_id:
        raise RuntimeError("P2P handshake missing X-P2P-Session header.")
    noise.read_message(hs_resp.content)

    # msg3 finishes the handshake with an empty Noise plaintext in v2.
    # The actual request rides in framed transport chunks below.
    msg3 = bytes(noise.write_message(b""))

    n_chunks = 1 if not payload_bytes else (len(payload_bytes) + P2P_CHUNK_PT - 1) // P2P_CHUNK_PT
    parts: list[bytes] = [
        struct.pack(">I", len(msg3)),
        msg3,
        struct.pack(">I", n_chunks),
    ]
    for i in range(n_chunks):
        start = i * P2P_CHUNK_PT
        end = min(start + P2P_CHUNK_PT, len(payload_bytes))
        chunk_pt = payload_bytes[start:end] if payload_bytes else b""
        ct = bytes(noise.encrypt(chunk_pt))
        parts.append(struct.pack(">I", len(ct)))
        parts.append(ct)
    body = b"".join(parts)

    ex_resp = httpx.post(
        f"{endpoint}/p2p/noise/exchange",
        content=body,
        headers={
            "Content-Type": "application/octet-stream",
            "X-P2P-Session": session_id,
        },
        timeout=600,
        verify=False,
    )
    if ex_resp.status_code >= 400:
        raise RuntimeError(f"P2P exchange HTTP {ex_resp.status_code}: {ex_resp.text[:200]}")

    return _decrypt_chunked_response(noise, ex_resp.content)


def _decrypt_chunked_response(noise, ct_body: bytes) -> bytes:
    if len(ct_body) < 4:
        raise RuntimeError("P2P response truncated (no n_chunks)")
    n_chunks = struct.unpack_from(">I", ct_body, 0)[0]
    cur = 4
    out = bytearray()
    for i in range(n_chunks):
        if len(ct_body) < cur + 4:
            raise RuntimeError(f"P2P response truncated at chunk {i} length")
        ct_len = struct.unpack_from(">I", ct_body, cur)[0]
        cur += 4
        if len(ct_body) < cur + ct_len:
            raise RuntimeError(f"P2P response truncated at chunk {i} body")
        pt = bytes(noise.decrypt(ct_body[cur:cur + ct_len]))
        cur += ct_len
        if len(out) + len(pt) > P2P_MAX_RESPONSE:
            raise RuntimeError("P2P response too large")
        out.extend(pt)
    return bytes(out)


def _chat_noise_provider(endpoint: str, provider_pubkey_b64: str, payload: dict) -> dict:
    resp = p2p_noise_call(endpoint, provider_pubkey_b64, json.dumps(payload).encode("utf-8"))
    try:
        return json.loads(resp.decode("utf-8"))
    except Exception as e:
        raise RuntimeError(f"P2P provider returned invalid JSON: {e}") from e


def _chat_custom(messages: list[dict], model_id: str, tools: list[dict] | None, force_tool: bool) -> dict:
    """Direct call to a user-configured OpenAI-compatible endpoint. No billing."""
    resolved = custom_ep.resolve(model_id)
    if not resolved:
        raise RuntimeError(f"Custom endpoint not found for model: {model_id}")
    endpoint, raw_model = resolved
    base_url = endpoint.get("base_url") or ""
    if not base_url:
        raise RuntimeError(f"Custom endpoint {endpoint.get('id')} has no base_url")
    payload = _build_payload(messages, raw_model, tools, force_tool)
    headers = {"Content-Type": "application/json"}
    api_key = endpoint.get("api_key")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    resp = httpx.post(f"{base_url}/v1/chat/completions", json=payload, headers=headers, timeout=600, verify=False)
    if resp.status_code >= 400:
        raise RuntimeError(f"Custom endpoint {endpoint.get('id')} HTTP {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    choice = (body.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    usage = body.get("usage") or {}
    return {
        "text": msg.get("content") or "",
        "tool_calls": msg.get("tool_calls") or [],
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens") or 0,
            "completion_tokens": usage.get("completion_tokens") or 0,
            "total_tokens": usage.get("total_tokens") or 0,
            "cost_cents": 0,
        },
    }


WAAAGH_BASE_URL = os.getenv("WAAAGH_BASE_URL", "http://127.0.0.1:8088")


def _chat_waaagh(messages: list[dict], model_id: str, tools: list[dict] | None, force_tool: bool) -> dict:
    """Route to the local WAAAGH-Net OpenAI-compatible server (scripts/serve.py).

    nGPT base model served from the Orkish venv. Tools are advertised in the
    system prompt (native CALL: wire format), not via OpenAI function-calling —
    so we pass no `tools` field; tool calls, if any, are parsed downstream from
    the raw text by the agent loop.
    """
    payload = {
        "model": model_id,
        "messages": messages,
        "max_tokens": 384,
        "temperature": 0.7,
        "top_p": 0.95,
    }
    resp = httpx.post(f"{WAAAGH_BASE_URL}/v1/chat/completions", json=payload, timeout=600)
    if resp.status_code >= 400:
        raise RuntimeError(f"WAAAGH server HTTP {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    choice = (body.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    usage = body.get("usage") or {}
    # serve.py parses the model's native `CALL: tool(args)` text into OpenAI
    # tool_calls. Forward only calls naming a real tool; drop hallucinated names
    # (setup/set_run/…) so the agent loop's text/keyword path still handles them.
    try:
        from monkey.agent import TOOL_NAMES as _KNOWN
    except Exception:
        _KNOWN = None
    fwd_calls = []
    for tc in msg.get("tool_calls") or []:
        name = ((tc.get("function") or {}).get("name")) or ""
        if _KNOWN is None or name in _KNOWN:
            fwd_calls.append(tc)
    return {
        "text": msg.get("content") or "",
        "tool_calls": fwd_calls,
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens") or 0,
            "completion_tokens": usage.get("completion_tokens") or 0,
            "total_tokens": usage.get("total_tokens") or 0,
            "cost_cents": 0,
        },
    }


def _chat_p2p(messages: list[dict], model_id: str, tools: list[dict] | None, force_tool: bool, provider_user_id: str | None = None) -> dict:
    """Route to an attested friend provider announced in /api/presence/friends."""
    providers = _list_friend_providers(model_id)
    if not providers:
        raise RuntimeError(f"No friend P2P provider online for model '{model_id}'.")
    if provider_user_id:
        provider = next((p for p in providers if p.get("userId") == provider_user_id), None)
        if provider is None:
            raise RuntimeError(f"Selected friend provider '{provider_user_id}' is not online for model '{model_id}'.")
    else:
        provider = providers[0]
    endpoint = provider.get("networkAddr") or provider.get("endpoint") or ""
    pubkey = provider.get("noisePubkey") or provider.get("publicKey") or ""
    if not pubkey:
        raise RuntimeError("Selected friend provider is missing a Noise public key.")
    body = _chat_noise_provider(
        endpoint,
        pubkey,
        _build_payload(messages, model_id, tools, force_tool),
    )
    if body.get("error") == "content_blocked":
        raise RuntimeError("Friend P2P provider blocked the content.")
    usage = body.get("usage") or {}
    tokens_in = usage.get("prompt_tokens") or 0
    tokens_out = usage.get("completion_tokens") or 0
    return {
        "text": body.get("text") or "",
        "tool_calls": body.get("tool_calls") or [],
        "usage": {
            "prompt_tokens": tokens_in,
            "completion_tokens": tokens_out,
            "total_tokens": usage.get("total_tokens") or (tokens_in + tokens_out),
            "cost_cents": 0,
        },
    }


def _chat_ollama_native_schema(messages: list[dict], ollama_tag: str, tool: dict) -> dict:
    """Force a single tool call via Ollama's native /api/chat with JSON-schema
    `format` constraint. The model emits a JSON object matching the tool's
    `parameters` schema at sampler level (constrained decoding, like vLLM /
    SGLang on OpenRouter). We synthesise the OpenAI-style tool_call locally
    so the rest of the agent loop sees a normal `tool_calls` response.

    Only used when force_tool=True and exactly one tool is offered — Ollama's
    `format` param accepts one schema, not a union of tools.
    """
    schema = (tool.get("function") or {}).get("parameters") or {"type": "object"}
    name = (tool.get("function") or {}).get("name") or "unknown_tool"
    # Ministral-3 family rejects role=system — fold into first user turn
    # before sending. Cheap to do unconditionally; no-op for other models.
    fold = _fold_system_into_user(messages)
    payload = {
        "model": ollama_tag,
        "messages": fold,
        "format": schema,
        "stream": False,
        "options": {
            "temperature": 0.0,
            "top_p": 1.0,
            "seed": 0,
            "num_predict": 2048,
            "num_ctx": _max_ctx_for(ollama_tag),
        },
    }
    _debug_dump("ollama_native_request", {"tag": ollama_tag, "tool_name": name, "payload": payload})
    try:
        resp = httpx.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=600,
        )
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError) as e:
        raise RuntimeError(
            f"Local Ollama unreachable at {OLLAMA_BASE_URL}. Cause: {e}"
        ) from e
    _debug_dump("ollama_native_response", {"tag": ollama_tag, "status": resp.status_code, "body": resp.text[:4000]})
    if resp.status_code >= 400:
        raise RuntimeError(f"Ollama /api/chat HTTP {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    content = ((body.get("message") or {}).get("content") or "").strip()
    try:
        args_obj = json.loads(content) if content else {}
    except json.JSONDecodeError as e:
        # Constraint failed somehow — surface raw content for debugging.
        raise RuntimeError(
            f"Ollama returned non-JSON despite schema constraint: {e}. "
            f"Raw: {content[:200]}"
        ) from e
    prompt_tokens = body.get("prompt_eval_count") or 0
    completion_tokens = body.get("eval_count") or 0
    return {
        "text": "",
        "tool_calls": [{
            "id": "call_constrained_0",
            "type": "function",
            "function": {
                "name": name,
                "arguments": json.dumps(args_obj),
            },
        }],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "cost_cents": 0,
        },
    }


def _chat_ollama(messages: list[dict], model_id: str, tools: list[dict] | None, force_tool: bool, temperature: float | None = None) -> dict:
    """Call local Ollama. No auth, no billing.

    Routing:
      - force_tool + exactly one tool → native /api/chat with `format=<schema>`
        for strict JSON-schema constrained decoding (closes ~30 % of the
        OpenRouter parity gap).
      - everything else → OpenAI-compatible /v1/chat/completions with
        deterministic sampler + json_object response_format hint.

    Quant: tries Q6_K tag first (`_OLLAMA_TAG_HIGH_QUANT`), falls back to
    default _OLLAMA_TAG_MAP entry on 404.
    """
    candidates = _ollama_tag_candidates(model_id)

    def _post_oai(p: dict):
        try:
            return httpx.post(
                f"{OLLAMA_BASE_URL}/v1/chat/completions",
                json=p,
                headers={"Content-Type": "application/json"},
                timeout=600,
            )
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError) as e:
            raise RuntimeError(
                f"Local Ollama unreachable at {OLLAMA_BASE_URL}. "
                f"Install Ollama (https://ollama.com) and pull a whitelisted model, "
                f"or use a friend P2P provider. "
                f"Cause: {e}"
            ) from e

    use_native_schema = force_tool and tools is not None and len(tools) == 1

    last_404_tag: str | None = None
    for tag in candidates:
        if use_native_schema:
            try:
                return _chat_ollama_native_schema(messages, tag, tools[0])
            except RuntimeError as e:
                msg = str(e)
                # Tag not pulled → try next candidate; any other failure bubbles up.
                if "HTTP 404" in msg:
                    last_404_tag = tag
                    continue
                raise

        payload = _build_payload(messages, tag, tools, force_tool, temperature)
        _debug_dump("ollama_oai_request", {"tag": tag, "force_tool": force_tool, "payload": payload})
        resp = _post_oai(payload)
        if resp.status_code == 404:
            last_404_tag = tag
            continue
        _debug_dump("ollama_oai_response", {"tag": tag, "status": resp.status_code, "body": resp.text[:4000]})
        # tool_choice='required' makes Ollama hard-parse the model's output as a
        # tool_call. Small models still occasionally emit malformed JSON despite
        # the json_object grammar hint. Retry once without the force so Ollama
        # falls back to lenient text-mode and lets the agent handle whatever
        # comes out. If the second pass still 500s (model hallucinates a tool
        # name not in the list), drop the tools entirely and let the model
        # produce plain text — the caller's fake_action detection will then
        # trigger a fresh forced retry with a clean tool surface.
        if force_tool and tools and resp.status_code == 500:
            retry = dict(payload)
            retry.pop("tool_choice", None)
            retry.pop("response_format", None)
            resp = _post_oai(retry)
            if resp.status_code == 500:
                bare = dict(retry)
                bare.pop("tools", None)
                resp = _post_oai(bare)
        if resp.status_code >= 400:
            raise RuntimeError(f"Ollama HTTP {resp.status_code}: {resp.text[:300]}")
        body = resp.json()
        choice = (body.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        usage = body.get("usage") or {}
        return {
            "text": msg.get("content") or "",
            "tool_calls": msg.get("tool_calls") or [],
            "usage": {
                "prompt_tokens": usage.get("prompt_tokens") or 0,
                "completion_tokens": usage.get("completion_tokens") or 0,
                "total_tokens": usage.get("total_tokens") or 0,
                "cost_cents": 0,
            },
        }

    raise RuntimeError(
        f"Model not pulled in Ollama. Tried: {candidates}. "
        f"Run: ollama pull {last_404_tag or candidates[-1]}"
    )


def _chat_bundled_schema(messages: list[dict], base_url: str, bearer_token: str, tool: dict) -> dict:
    """Force a single tool call via bundled llama-server with strict json_schema
    grammar. Equivalent to `_chat_ollama_native_schema` but routed through the
    Tauri-managed llama.cpp build (b9279+). Uses OpenAI-compat
    `response_format={"type":"json_schema",...}` which llama-server translates
    to a GBNF grammar at sampler level — same primitive vLLM / SGLang use on
    OpenRouter, so the parity gap closes here when llama-server is up.

    Only used when force_tool=True and exactly one tool is offered.
    """
    schema = (tool.get("function") or {}).get("parameters") or {"type": "object"}
    name = (tool.get("function") or {}).get("name") or "unknown_tool"
    # Mirror the Ministral-3 system-role workaround used elsewhere.
    fold = _fold_system_into_user(messages)
    payload = {
        "model": "loaded",
        "messages": fold,
        "stream": False,
        "max_tokens": 2048,
        "temperature": 0.0,
        "top_p": 1.0,
        "seed": 0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": name,
                "schema": schema,
                "strict": True,
            },
        },
    }
    url = base_url.rstrip("/") + "/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=600)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError) as e:
        raise RuntimeError(f"Bundled llama-server unreachable at {base_url}. Cause: {e}") from e
    # Some llama.cpp builds reject `response_format=json_schema` with HTTP 400
    # (older builds only know `json_object`). Surface as a recoverable error so
    # `_chat_bundled` can fall through to the lenient OpenAI-compat path.
    if resp.status_code == 400 and "json_schema" in (resp.text or "").lower():
        raise RuntimeError("llama-server build lacks json_schema support")
    if resp.status_code >= 400:
        raise RuntimeError(f"llama-server schema HTTP {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    choice = (body.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    content = (msg.get("content") or "").strip()
    # llama-server with strict json_schema returns content as a JSON string. If
    # the model also produced a tool_call (some builds normalise), prefer that.
    explicit_tcs = msg.get("tool_calls") or []
    if explicit_tcs:
        usage = body.get("usage") or {}
        return {
            "text": "",
            "tool_calls": explicit_tcs,
            "usage": {
                "prompt_tokens": usage.get("prompt_tokens") or 0,
                "completion_tokens": usage.get("completion_tokens") or 0,
                "total_tokens": usage.get("total_tokens") or 0,
                "cost_cents": 0,
            },
        }
    try:
        args_obj = json.loads(content) if content else {}
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"llama-server returned non-JSON despite schema: {e}. Raw: {content[:200]}"
        ) from e
    usage = body.get("usage") or {}
    return {
        "text": "",
        "tool_calls": [{
            "id": "call_constrained_0",
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args_obj)},
        }],
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens") or 0,
            "completion_tokens": usage.get("completion_tokens") or 0,
            "total_tokens": usage.get("total_tokens") or 0,
            "cost_cents": 0,
        },
    }


def _chat_bundled(messages: list[dict], base_url: str, bearer_token: str, tools: list[dict] | None, force_tool: bool, temperature: float | None = None) -> dict:
    """Call the Tauri-bundled llama-server (OpenAI-compatible). One model loaded, model_id ignored.

    Routing:
      - force_tool + exactly one tool → strict json_schema via
        `_chat_bundled_schema`. Falls through to OpenAI-compat path if the
        bundled llama.cpp build is too old to know `json_schema`.
      - everything else → OpenAI-compat /v1/chat/completions (sampler +
        json_object hint injected by `_build_payload`).
    """
    if force_tool and tools is not None and len(tools) == 1:
        try:
            return _chat_bundled_schema(messages, base_url, bearer_token, tools[0])
        except RuntimeError as e:
            # Older llama.cpp build → fall through. Any other runtime issue
            # (connectivity, non-JSON despite schema) bubbles up so we don't
            # mask real bugs as "old build".
            if "lacks json_schema" not in str(e):
                raise
    url = base_url.rstrip("/") + "/v1/chat/completions"
    payload = _build_payload(messages, "loaded", tools, force_tool, temperature)
    headers = {"Content-Type": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=600)
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError) as e:
        raise RuntimeError(f"Bundled llama-server unreachable at {base_url}. Cause: {e}") from e
    # Some chat templates (Ministral-3 family) reject role='system' via a Jinja
    # raise_exception. Retry once with system content folded into the first user
    # message — keeps the instructions in context without violating the template.
    if resp.status_code == 500 and "Only user, assistant" in resp.text:
        payload["messages"] = _fold_system_into_user(messages)
        try:
            resp = httpx.post(url, json=payload, headers=headers, timeout=600)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError) as e:
            raise RuntimeError(f"Bundled llama-server unreachable at {base_url}. Cause: {e}") from e
    # The --jinja native tool-call parser (llama_runtime.rs) returns HTTP 500
    # "Failed to parse ..." when a weak model (e.g. mistral-3-3b) emits
    # markdown-fenced prose instead of the template's tool-call grammar. Retry
    # once WITHOUT the native tools so llama.cpp returns raw text; the agent then
    # runs _extract_inline_tool_call on it (text protocol). Pure-chat turns pass
    # through instead of crashing the whole request.
    if resp.status_code == 500 and "Failed to parse" in resp.text and tools:
        retry_payload = dict(payload)
        retry_payload.pop("tools", None)
        retry_payload.pop("tool_choice", None)
        retry_payload.pop("response_format", None)
        try:
            resp = httpx.post(url, json=retry_payload, headers=headers, timeout=600)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError) as e:
            raise RuntimeError(f"Bundled llama-server unreachable at {base_url}. Cause: {e}") from e
    if resp.status_code >= 400:
        raise RuntimeError(f"llama-server HTTP {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    choice = (body.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    usage = body.get("usage") or {}
    text = msg.get("content") or ""
    tool_calls = msg.get("tool_calls") or []
    completion_tokens = usage.get("completion_tokens") or 0
    if not text and not tool_calls and completion_tokens > 0:
        # llama-server consumed tokens but produced empty content — typical of a GGUF
        # whose architecture/tokenizer isn't supported by this llama.cpp build (the
        # model emits only special tokens). Surface a clear error.
        raise RuntimeError(
            "Bundled llama-server returned empty output despite generating "
            f"{completion_tokens} tokens. The loaded GGUF may be incompatible with "
            "this llama.cpp build. Try another model from the catalog."
        )
    return {
        "text": text,
        "tool_calls": tool_calls,
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens") or 0,
            "completion_tokens": completion_tokens,
            "total_tokens": usage.get("total_tokens") or 0,
            "cost_cents": 0,
        },
    }


def chat(messages: list[dict], model_id: str | None = None, tools: list[dict] | None = None, force_tool: bool = False, provider_mode: str | None = None, provider_user_id: str | None = None, llama_base_url: str | None = None, llama_bearer_token: str | None = None, temperature: float | None = None) -> dict:
    """Route inference to a custom endpoint, bundled llama-server, local Ollama, or a friend P2P provider.
    Returns { text, tool_calls, usage }.

    - `custom:<id>`              → user-configured OpenAI-compatible server
    - bundled llama-server live  → Tauri-managed llama.cpp server (preferred local backend)
    - local Ollama reachable     → fallback at OLLAMA_BASE_URL
    - otherwise                  → attested friend provider via /api/presence/friends
    No commercial cloud fallback — by design.
    """
    if not (model_id and model_id.strip()):
        raise RuntimeError("No model selected. Pick one in the UI.")
    mode = (provider_mode or "").strip().lower()
    has_bundled = bool((llama_base_url or "").strip())
    if model_id.startswith("waaagh"):
        return _chat_waaagh(messages, model_id, tools, force_tool)
    if custom_ep.is_custom(model_id):
        if mode == "friend":
            raise RuntimeError("Friend P2P is not available for custom endpoint models.")
        return _chat_custom(messages, model_id, tools, force_tool)
    if mode == "local":
        if has_bundled:
            try:
                return _chat_bundled(messages, llama_base_url, llama_bearer_token or "", tools, force_tool, temperature)
            except RuntimeError as bundled_err:
                msg = str(bundled_err)
                # GGUF architecture/tokenizer unsupported by this llama.cpp build
                # (e.g. Ministral-3-2512 on b9279). Ollama ships a newer build and
                # serves the same model under a translated tag — fall through.
                if "empty output" in msg or "incompatible" in msg:
                    try:
                        return _chat_ollama(messages, model_id, tools, force_tool, temperature)
                    except RuntimeError as ollama_err:
                        raise RuntimeError(f"{bundled_err} | Ollama fallback failed: {ollama_err}") from ollama_err
                raise
        return _chat_ollama(messages, model_id, tools, force_tool, temperature)
    if mode == "friend":
        return _chat_p2p(messages, model_id, tools, force_tool, provider_user_id=provider_user_id)
    if has_bundled:
        try:
            return _chat_bundled(messages, llama_base_url, llama_bearer_token or "", tools, force_tool, temperature)
        except RuntimeError as bundled_err:
            try:
                return _chat_p2p(messages, model_id, tools, force_tool)
            except RuntimeError as p2p_err:
                raise RuntimeError(f"{bundled_err} | P2P fallback failed: {p2p_err}") from p2p_err
    try:
        return _chat_ollama(messages, model_id, tools, force_tool, temperature)
    except RuntimeError as ollama_err:
        # Local backend unavailable — try a friend provider. If that also fails, surface
        # both reasons so the user knows whether to install Ollama or wait
        # for a peer.
        try:
            return _chat_p2p(messages, model_id, tools, force_tool)
        except RuntimeError as p2p_err:
            raise RuntimeError(f"{ollama_err} | P2P fallback failed: {p2p_err}") from p2p_err


def login(email: str, password: str) -> str:
    """Authenticate with the backend and store the session token."""
    status, body, headers = _post(
        f"{BACKEND_URL}/api/auth/login",
        {"email": email, "password": password},
        timeout=15,
    )
    if status == 401:
        raise PermissionError(body.get("message", "Invalid credentials"))
    if status >= 400:
        raise RuntimeError(body.get("message", f"HTTP {status}"))
    token = ""
    cookie = headers.get("Set-Cookie") or headers.get("set-cookie") or ""
    for part in cookie.split(";"):
        if part.strip().lower().startswith("token="):
            token = part.strip()[6:]
            break
    if token:
        store.set("TOKEN", token)
    store.set("EMAIL", email)
    return token

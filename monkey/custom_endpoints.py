"""User-defined OpenAI-compatible LLM endpoints (Ollama, LM Studio, vLLM, …).

Local-first: config lives on the desktop client, gets pushed here at boot.
We keep it in memory + persist a copy to ~/.monkey/custom_endpoints.json so
that a sidecar restart between desktop boots still serves /models with the
last-known endpoints.

Calls bypass billing — user owns the infra.
"""
from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# Local-only guard: custom endpoints MUST point to localhost / private LAN.
# Public cloud URLs are rejected to prevent bypassing the billed backend.
_PRIVATE_HOST_RE = re.compile(
    r"^(localhost|127(?:\.\d+){3}|::1|0\.0\.0\.0|[^.]+\.local|"
    r"10(?:\.\d+){3}|192\.168(?:\.\d+){2}|"
    r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d+){2})$",
    re.IGNORECASE,
)


def _is_local_url(url: str) -> bool:
    if not url:
        return False
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return False
    return bool(_PRIVATE_HOST_RE.match(host))

_CONFIG_PATH = Path.home() / ".monkey" / "custom_endpoints.json"
_LOCK = threading.Lock()
_ENDPOINTS: dict[str, dict] = {}  # endpoint_id -> {label, base_url, api_key, models: [{id,name,...}]}

_MODEL_PREFIX = "custom:"
_SEP = "::"


def _persist() -> None:
    try:
        _CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CONFIG_PATH.write_text(json.dumps(list(_ENDPOINTS.values()), indent=2))
    except Exception:
        pass


def _load_from_disk() -> None:
    if not _CONFIG_PATH.exists():
        return
    try:
        data = json.loads(_CONFIG_PATH.read_text())
        if isinstance(data, list):
            with _LOCK:
                _ENDPOINTS.clear()
                for ep in data:
                    if isinstance(ep, dict) and ep.get("id"):
                        _ENDPOINTS[ep["id"]] = ep
    except Exception:
        pass


_load_from_disk()


def replace_all(endpoints: list[dict]) -> None:
    """Replace the full set of custom endpoints (desktop is source of truth)."""
    with _LOCK:
        _ENDPOINTS.clear()
        for ep in endpoints or []:
            if not isinstance(ep, dict):
                continue
            eid = ep.get("id")
            if not eid:
                continue
            base_url = (ep.get("base_url") or ep.get("baseUrl") or "").rstrip("/")
            if not _is_local_url(base_url):
                # Reject non-local endpoints (cloud bypass attempt). Silently dropped.
                continue
            _ENDPOINTS[eid] = {
                "id": eid,
                "label": ep.get("label") or eid,
                "base_url": base_url,
                "api_key": ep.get("api_key") or ep.get("apiKey") or "",
                "models": list(ep.get("models") or []),
                "kind": ep.get("kind") or "chat",
                "protocol": ep.get("protocol"),
            }
    _persist()


def list_endpoints() -> list[dict]:
    with _LOCK:
        # Strip api_key from public list; include kind and protocol
        return [
            {k: v for k, v in ep.items() if k != "api_key"}
            for ep in _ENDPOINTS.values()
        ]


def list_catalog_entries_chat() -> list[dict]:
    """Return chat-type models in the same shape as /models for merging into the catalog."""
    out: list[dict] = []
    with _LOCK:
        for ep in _ENDPOINTS.values():
            if ep.get("kind") != "chat":
                continue
            for m in ep.get("models") or []:
                raw_id = m.get("id") or m.get("name")
                if not raw_id:
                    continue
                full_id = f"{_MODEL_PREFIX}{ep['id']}{_SEP}{raw_id}"
                display = m.get("name") or raw_id
                out.append({
                    "id": full_id,
                    "name": f"{display}",
                    "category": "Custom",
                    "family": "Custom",
                    "provider": "custom",
                    "endpointLabel": ep.get("label"),
                    "supportsTools": True,
                    "supportsVision": bool(m.get("supportsVision")),
                    "supportsAudioInput": bool(m.get("supportsAudioInput")),
                    "inputCostPer1MTokensCents": 0,
                    "outputCostPer1MTokensCents": 0,
                })
    return out


def list_catalog_entries_for(kind: str) -> list[dict]:
    """Return models of a specific kind (image, music, video, etc.)."""
    out: list[dict] = []
    with _LOCK:
        for ep in _ENDPOINTS.values():
            if ep.get("kind") != kind:
                continue
            for m in ep.get("models") or []:
                raw_id = m.get("id") or m.get("name")
                if not raw_id:
                    continue
                full_id = f"{_MODEL_PREFIX}{ep['id']}{_SEP}{raw_id}"
                display = m.get("name") or raw_id
                out.append({
                    "id": full_id,
                    "name": display,
                    "default": False,
                })
    return out


def is_custom(model_id: str | None) -> bool:
    return bool(model_id) and model_id.startswith(_MODEL_PREFIX)


def resolve(model_id: str) -> tuple[dict, str] | None:
    """Return (endpoint_record_with_api_key, raw_model_id) or None."""
    if not is_custom(model_id):
        return None
    rest = model_id[len(_MODEL_PREFIX):]
    if _SEP not in rest:
        return None
    eid, raw = rest.split(_SEP, 1)
    with _LOCK:
        ep = _ENDPOINTS.get(eid)
        if not ep:
            return None
        return (dict(ep), raw)

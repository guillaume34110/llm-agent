"""ONNX / ct2 runtime cache (LRU).

Keeps at most LRU_MAX sessions in RAM. First call to `get(model_id)` loads
the session (via the model's adapter), subsequent calls reuse it. LRU eviction
on overflow. Adapter is responsible for producing a "session-like" object
(typically (onnx_session, tokenizer) or a whisper model).

Adapters that need to know if their model is loaded already (to short-circuit
warm-up) can call `is_loaded(model_id)`.
"""
from __future__ import annotations

import importlib
import threading
from collections import OrderedDict

from . import catalog as _catalog
from . import registry as _registry

LRU_MAX = 2

_CACHE: "OrderedDict[str, object]" = OrderedDict()
_CACHE_LOCK = threading.RLock()


def _adapter_module(adapter_name: str):
    return importlib.import_module(f"monkey.local_models.adapters.{adapter_name}")


def get(model_id: str):
    """Load (or fetch from cache) the session object for a model."""
    spec = _catalog.by_id(model_id)
    if spec is None:
        raise ValueError(f"unknown model: {model_id}")
    if not _registry.is_installed(model_id):
        raise RuntimeError(f"model not installed: {model_id}")

    with _CACHE_LOCK:
        if model_id in _CACHE:
            _CACHE.move_to_end(model_id)
            return _CACHE[model_id]
        mod = _adapter_module(spec["adapter"])
        if not hasattr(mod, "load"):
            raise RuntimeError(f"adapter {spec['adapter']} has no load()")
        session = mod.load(spec, _registry.model_dir(model_id))
        _CACHE[model_id] = session
        # LRU eviction
        while len(_CACHE) > LRU_MAX:
            evict_id, _ = _CACHE.popitem(last=False)
            try:
                evict_mod = _adapter_module(_catalog.by_id(evict_id)["adapter"])
                if hasattr(evict_mod, "unload"):
                    evict_mod.unload(_CACHE.get(evict_id))
            except Exception:
                pass
        return session


def unload(model_id: str) -> None:
    with _CACHE_LOCK:
        if model_id in _CACHE:
            session = _CACHE.pop(model_id)
            spec = _catalog.by_id(model_id)
            if spec:
                try:
                    mod = _adapter_module(spec["adapter"])
                    if hasattr(mod, "unload"):
                        mod.unload(session)
                except Exception:
                    pass


def is_loaded(model_id: str) -> bool:
    with _CACHE_LOCK:
        return model_id in _CACHE


def loaded_ids() -> list[str]:
    with _CACHE_LOCK:
        return list(_CACHE.keys())

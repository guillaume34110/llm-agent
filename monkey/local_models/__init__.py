"""On-device small models — install, manage, expose as agent tools.

DESIGN (read before editing):
- ONNX-first runtime: avoids torch (~4GB install) and keeps CPU inference fast.
  Tokenization via `tokenizers` (Rust binding, ~5MB). ASR is the only exception
  and uses faster-whisper (ctranslate2, no torch).
- Curated catalogue (catalog.py). No free browsing of HF hub — predictable UX,
  no surprise downloads of giant models.
- Sidecar lives at monkey/, so models live next to the rest of monkey state in
  `~/.monkey/models/<id>/`. Tauri side only renders the UI and proxies through
  the sidecar HTTP API (port 3471).
- LRU runtime: max 2 sessions loaded in RAM. eviction by least-recently-used.
- Installed models are exposed as agent tools — see `monkey/agent.py` where
  `local_models.tools.dynamic_tools()` is appended to TOOLS.
- Invariant: the agent must PREFER local tools when applicable (free, private,
  offline). Hint baked into SYSTEM_PROMPT under "LOCAL MODELS".

INVARIANTS:
- Never silently auto-install. User explicitly clicks install in Settings.
- Download = HF snapshot_download (resumable), sha256 logged when available.
- Each install writes meta.json — single source of truth for "installed".
- Deleting = wipe folder + meta.json. Adapter cache invalidated.

Public API:
  from monkey.local_models import registry, catalog, runtime
"""

from . import catalog, registry, runtime, download  # noqa: F401
from .tools import dynamic_tools, dispatch_local  # noqa: F401

__all__ = ["catalog", "registry", "runtime", "download", "dynamic_tools", "dispatch_local"]

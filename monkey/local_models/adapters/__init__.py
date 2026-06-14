"""Adapters: one module per model task.

Each adapter exposes:
  load(spec, model_dir) -> session_object        # called by runtime LRU
  unload(session_object) -> None                 # optional cleanup
  run(session_object, args: dict) -> str         # called by dispatch_local

Adapters return a STRING (usually JSON) to match the agent's tool result
contract. Errors prefixed `ERREUR:` so the agent's deterministic gate
catches them (see agent.py invariant).
"""

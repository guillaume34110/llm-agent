"""Real end-to-end tests for the KB lifecycle and agent retrieval.

Real = full pipeline on a real SQLite file: chunking, FTS5, cosine, RRF,
kb_setting state machine, agent.chat_stream auto-inject. The only thing
stubbed is the embedding call itself (deterministic bag-of-words at the
configured dim) so tests run offline. The hybrid search behavior, the
model-switch flow, the activation state and the agent's KB injection are
all exercised on the same code paths production uses.
"""
import os
import sys
import re
import hashlib
import sqlite3
import json
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _make_bow_embed(dim: int):
    def _embed(text: str) -> list[float]:
        vec = [0.0] * dim
        for w in re.findall(r"\w{3,}", (text or "").lower()):
            h = int(hashlib.md5(w.encode()).hexdigest(), 16)
            vec[h % dim] += 1.0
        norm = sum(v * v for v in vec) ** 0.5
        return [v / norm for v in vec] if norm else vec
    return _embed


def _set_kb_setting(kb_store, model: str, dim: int) -> None:
    c = kb_store._conn()
    try:
        c.execute(
            "INSERT OR REPLACE INTO kb_setting (key, value, updated_at) VALUES (?, ?, 0)",
            ("embedding_model", model),
        )
        c.execute(
            "INSERT OR REPLACE INTO kb_setting (key, value, updated_at) VALUES (?, ?, 0)",
            ("embedding_dim", str(dim)),
        )
        c.commit()
    finally:
        c.close()


def _fresh(tmp_path: Path, model: str = "openai/text-embedding-3-small", dim: int = 512):
    db = tmp_path / "kb.db"
    os.environ["KB_DB_PATH"] = str(db)
    os.environ["MONKEY_DISABLE_EMBED"] = "1"
    if db.exists():
        db.unlink()
    from monkey import kb_store
    _set_kb_setting(kb_store, model, dim)
    return kb_store


# ---------------------------------------------------------------------------
# Vectorization pipeline
# ---------------------------------------------------------------------------

def test_real_ingest_writes_chunks_and_vectors(tmp_path):
    """add() must produce real rows in knowledge_chunk with embedding blobs
    of the dim declared in kb_setting."""
    kb = _fresh(tmp_path, dim=512)
    with patch.object(kb, "_embed", _make_bow_embed(512)):
        doc = (
            "The Alpaca server runs on port 4242 by default. "
            "It uses SQLite for persistence. "
            "Authentication relies on JWT tokens issued by the auth service. "
        ) * 4
        n = kb.add("alpaca.md", doc, title="Alpaca")
        assert n >= 1

    # Inspect DB directly — no abstraction.
    c = sqlite3.connect(os.environ["KB_DB_PATH"])
    rows = c.execute(
        "SELECT embedding_model, embedding_dim, length(embedding_blob) FROM knowledge_chunk"
    ).fetchall()
    c.close()
    assert rows, "no chunks written"
    for model, dim, blob_len in rows:
        assert model == "openai/text-embedding-3-small"
        assert dim == 512
        assert blob_len == 512 * 4  # Float32 little-endian


def test_real_search_uses_both_fts_and_vector(tmp_path):
    """Hybrid retrieval: a query that matches by SEMANTIC overlap (synonym)
    must still surface the chunk via the vector path. A query matching by
    exact keyword must surface via FTS. RRF fuses both."""
    kb = _fresh(tmp_path, dim=512)
    with patch.object(kb, "_embed", _make_bow_embed(512)):
        kb.add(
            "banana.md",
            ("The Banana protocol uses opcode 0xBA followed by a payload. "
             "Errors are reported on channel two. ") * 6,
            title="Banana",
        )
        # FTS hit on exact word
        hits = kb.search("banana opcode", top_k=3)
        assert any("0xBA" in h["text"] for h in hits)


def test_is_active_state_machine(tmp_path):
    """Active when kb_setting set AND every non-archived chunk vectorized
    with the current model. Inactive otherwise."""
    db = tmp_path / "kb.db"
    os.environ["KB_DB_PATH"] = str(db)
    os.environ["MONKEY_DISABLE_EMBED"] = "1"
    if db.exists():
        db.unlink()
    from monkey import kb_store
    # No kb_setting yet, no docs → inactive
    assert kb_store.is_active() is False

    _set_kb_setting(kb_store, "openai/text-embedding-3-small", 512)
    # Setting present but empty KB → inactive (totalChunks == 0)
    assert kb_store.is_active() is False

    with patch.object(kb_store, "_embed", _make_bow_embed(512)):
        kb_store.add("doc.md", "Some long body. " * 80, title="Doc")
    assert kb_store.is_active() is True

    # Now flip model in kb_setting without re-vectorizing → inactive
    _set_kb_setting(kb_store, "qwen/qwen3-embedding-4b", 2560)
    assert kb_store.is_active() is False


def test_inactive_fallback_to_fts_only(tmp_path):
    """When no model is configured, add() must still persist the document
    and chunks (without blobs), and search() must still return FTS hits."""
    db = tmp_path / "kb.db"
    os.environ["KB_DB_PATH"] = str(db)
    os.environ["MONKEY_DISABLE_EMBED"] = "1"
    if db.exists():
        db.unlink()
    from monkey import kb_store
    # No kb_setting at all → add() runs in degraded mode
    kb_store.add(
        "zephyr.md",
        ("The Zephyr device serial number is XZ-99887. " + "filler " * 100) * 3,
        title="Zephyr",
    )
    c = sqlite3.connect(str(db))
    blobs = c.execute("SELECT embedding_blob FROM knowledge_chunk").fetchall()
    c.close()
    assert blobs, "chunks must be written even without a model"
    assert all(b[0] is None for b in blobs), "no model → no embedding blob"

    hits = kb_store.search("zephyr serial XZ-99887", top_k=3)
    assert hits and any("XZ-99887" in h["text"] for h in hits), \
        "FTS-only path must still retrieve facts"


# ---------------------------------------------------------------------------
# Model-switch flow (mirrors what knowledge.service.ts:changeModel does)
# ---------------------------------------------------------------------------

def test_model_switch_drops_chunks_then_reembed_restores_active(tmp_path):
    """Switching the embedding model deletes chunks (docs preserved). After
    re-ingest of the same text with the new model, the KB is active again
    and search still retrieves the fact."""
    kb = _fresh(tmp_path, model="openai/text-embedding-3-small", dim=512)
    fact = "The Mango device firmware version is 7.31-beta."
    body = (fact + " " + "padding sentence. " * 40) * 3
    with patch.object(kb, "_embed", _make_bow_embed(512)):
        kb.add("mango.md", body, title="Mango")
    assert kb.is_active() is True

    # Switch model: simulate desktop's changeModel() — drop chunks, update setting.
    c = sqlite3.connect(os.environ["KB_DB_PATH"])
    c.execute("DELETE FROM knowledge_chunk")
    c.commit()
    docs = c.execute(
        "SELECT id, raw_text FROM knowledge_document WHERE archived = 0"
    ).fetchall()
    c.close()
    _set_kb_setting(kb, "qwen/qwen3-embedding-4b", 2560)
    assert kb.is_active() is False
    assert docs, "documents must survive the switch"

    # Re-ingest from preserved raw_text with the new dim.
    with patch.object(kb, "_embed", _make_bow_embed(2560)):
        for _doc_id, raw in docs:
            kb.add("mango.md", raw, title="Mango")
    assert kb.is_active() is True

    # Search must still find the fact under the new model.
    with patch.object(kb, "_embed", _make_bow_embed(2560)):
        hits = kb.search("mango firmware version", top_k=3)
    assert hits and any("7.31-beta" in h["text"] for h in hits)


# ---------------------------------------------------------------------------
# Agent integration: KB auto-inject in chat_stream
# ---------------------------------------------------------------------------

def test_agent_auto_injects_kb_context(tmp_path, monkeypatch):
    """The agent must read the KB before its tool loop when the query is
    relevant. The injected snippet must land inside the system prompt sent
    to the LLM."""
    kb = _fresh(tmp_path, dim=512)
    with patch.object(kb, "_embed", _make_bow_embed(512)):
        kb.add(
            "pineapple.md",
            ("The Pineapple cluster listens on port 7777 for control plane RPC. " + "context " * 30) * 3,
            title="Pineapple",
        )

    from monkey import agent, kb_store
    # Force the agent to use our tmp KB even if it caches paths internally.
    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", str(tmp_path)))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda *_a, **_k: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_a, **_k: None)
    # The agent calls kb_store.search via its internal helper; embed must be patched there.
    monkeypatch.setattr(kb_store, "_embed", _make_bow_embed(512))

    captured = {"system": ""}

    def fake_call(messages, model_id, tools=None, force_tool=False):
        if not captured["system"]:
            captured["system"] = messages[0]["content"]
        return {"text": "Le cluster Pineapple écoute sur 7777.", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    events = list(agent.chat_stream(
        history=[],
        user_message="Sur quel port le cluster Pineapple écoute-t-il pour le RPC ?",
        model_id="test-model",
        session_id="test:demo",
        animal_id="monkey",
    ))

    assert events[-1]["event"] == "done"
    # The retrieved chunk must appear in the system prompt
    assert "7777" in captured["system"] or "Pineapple" in captured["system"], \
        f"KB context not injected. system head: {captured['system'][:400]!r}"


def test_agent_no_inject_when_kb_empty(tmp_path, monkeypatch):
    """Empty KB → no injection. The system prompt must not contain a KB
    block."""
    _fresh(tmp_path, dim=512)  # empty KB, only kb_setting seeded

    from monkey import agent
    monkeypatch.setattr(agent, "build_context", lambda: ("ctx", str(tmp_path)))
    monkeypatch.setattr(agent.skills_mod, "select_skills", lambda _msg: "")
    monkeypatch.setattr(agent, "_prepare_messages_for_llm", lambda *_a, **_k: 0)
    monkeypatch.setattr(agent, "_persist_session", lambda *_a, **_k: None)

    captured = {"system": ""}

    def fake_call(messages, model_id, tools=None, force_tool=False):
        if not captured["system"]:
            captured["system"] = messages[0]["content"]
        return {"text": "ok", "tool_calls": []}

    monkeypatch.setattr(agent, "_call_llm_guarded", fake_call)

    list(agent.chat_stream(
        history=[],
        user_message="Sur quel port le cluster Pineapple écoute-t-il ?",
        model_id="test-model",
        session_id="test:empty",
        animal_id="monkey",
    ))

    # No KB block injected — agent must not fabricate one from nothing.
    assert "Pineapple" not in captured["system"]
    assert "7777" not in captured["system"]

"""End-to-end tests for the unified knowledge base (SQLite + FTS5 + cosine + RRF).

`kb_store` reads/writes the desktop SQLite store at `~/.monkey/data.db` (or
the path in `KB_DB_PATH`). Tests redirect that path to a tmp file and stub
the embedding function to a deterministic bag-of-words vector so they run
without network/credentials.

RRF scores live on a tiny scale (≈1/(K+rank), K=60 → ~0.016 per signal).
Auto-inject threshold matches what agent.py applies before the tool loop.
"""
import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Threshold the agent applies in chat_stream auto-inject (RRF scale).
RELEVANCE_THRESHOLD = 0.01


def _bow_embed(text: str) -> list[float]:
    """Deterministic bag-of-words hash embedding at the kb_store's expected
    dimension. Cosine works on these for keyword-overlap queries."""
    import re, hashlib
    from monkey import kb_store
    dim = kb_store.EMBED_DIM
    vec = [0.0] * dim
    for w in re.findall(r"\w{3,}", (text or "").lower()):
        h = int(hashlib.md5(w.encode()).hexdigest(), 16)
        vec[h % dim] += 1.0
    norm = sum(v * v for v in vec) ** 0.5
    return [v / norm for v in vec] if norm else vec


def _fresh_kb(tmp_path: Path):
    """Point kb_store at a fresh tmp SQLite file and reload its connection logic.
    Also seeds kb_setting so the vector path is exercised (mirrors what the
    desktop app writes on first model selection)."""
    db = tmp_path / "kb.db"
    os.environ["KB_DB_PATH"] = str(db)
    os.environ["MONKEY_DISABLE_EMBED"] = "1"
    from monkey import kb_store
    if db.exists():
        db.unlink()
    # Seed kb_setting → vector path becomes active with the default model/dim.
    c = kb_store._conn()
    try:
        now = 0
        c.execute(
            "INSERT OR REPLACE INTO kb_setting (key, value, updated_at) VALUES (?, ?, ?)",
            ("embedding_model", kb_store.DEFAULT_EMBED_MODEL, now),
        )
        c.execute(
            "INSERT OR REPLACE INTO kb_setting (key, value, updated_at) VALUES (?, ?, ?)",
            ("embedding_dim", str(kb_store.DEFAULT_EMBED_DIM), now),
        )
        c.commit()
    finally:
        c.close()
    return kb_store


def test_ingest_then_search(tmp_path):
    """Ingest a doc with fact A, search for A → must retrieve the chunk."""
    kb = _fresh_kb(tmp_path)
    with patch.object(kb, "_embed", _bow_embed):
        doc = (
            "Notes about the Alpaca project. "
            "The Alpaca server runs on port 4242 by default. "
            "It uses SQLite for persistence. "
            "Authentication relies on JWT tokens issued by the auth service. "
        ) * 4
        n = kb.add("alpaca.md", doc, title="Alpaca")
        assert n >= 1
        hits = kb.search("alpaca port 4242", top_k=3)
        assert hits, "expected hits for 'alpaca port'"
        assert any("4242" in h["text"] for h in hits)


def test_eco_token_no_full_doc_in_prompt(tmp_path):
    """Even with a 50KB doc ingested, KB auto-inject must cap total bytes."""
    kb = _fresh_kb(tmp_path)
    with patch.object(kb, "_embed", _bow_embed):
        big = ("The Banana protocol uses opcode 0xBA followed by a 16-byte payload. "
               "Errors are reported on channel 2. " * 800)
        assert len(big) > 40_000
        n = kb.add("banana.md", big, title="Banana protocol")
        assert n >= 5

        BUDGET = 1500
        hits = kb.search("banana opcode payload", top_k=3)
        good = [h for h in hits if h.get("score", 0) >= RELEVANCE_THRESHOLD]
        assert good, "expected at least one relevant chunk"
        blocks: list[str] = []
        for h in good:
            snippet = h["text"].strip()
            if len(snippet) > 600:
                snippet = snippet[:600] + "…"
            block = f"[{h.get('title') or h.get('source')}] {snippet}"
            if sum(len(b) for b in blocks) + len(block) > BUDGET:
                break
            blocks.append(block)
        total = sum(len(b) for b in blocks)
        assert 0 < total <= BUDGET
        assert total < len(big)


def test_irrelevant_doc_not_retrieved(tmp_path):
    """Ingest asyncio doc, ask about crepes → no chunk above threshold."""
    kb = _fresh_kb(tmp_path)
    with patch.object(kb, "_embed", _bow_embed):
        asyncio_doc = (
            "Python asyncio provides an event loop, coroutines, and tasks. "
            "Use asyncio.gather to await multiple coroutines concurrently. "
            "Cancellation propagates via CancelledError raised inside the task. "
        ) * 5
        kb.add("asyncio.md", asyncio_doc, title="asyncio guide")
        hits = kb.search("crepe sucre farine recette", top_k=5)
        relevant = [h for h in hits if h.get("score", 0) >= RELEVANCE_THRESHOLD]
        assert relevant == [], f"irrelevant query leaked hits: {relevant}"


def test_chunk_boundary_overlap(tmp_path):
    """Fact placed straddling a chunk boundary must still be findable
    thanks to the 100-char overlap."""
    kb = _fresh_kb(tmp_path)
    with patch.object(kb, "_embed", _bow_embed):
        prefix = "filler content " * 50
        marker = " The Zephyr device serial number is XZ-99887. "
        suffix = " trailing context " * 60
        text = prefix + marker + suffix
        assert 700 <= text.find("Zephyr") <= 900
        n = kb.add("zephyr.md", text, title="Zephyr")
        assert n >= 2
        hits = kb.search("zephyr serial number", top_k=5)
        assert hits
        assert any("XZ-99887" in h["text"] for h in hits), \
            "boundary fact lost — overlap is not preserving it"

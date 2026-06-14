"""Unified knowledge base — reads/writes the desktop SQLite store.

Single source of truth: `~/.monkey/data.db` (created and owned by the Tauri
desktop app). The Python sidecar opens it directly via stdlib sqlite3. There
is no JSONL mirror, no second copy of the data.

Layout: tables `knowledge_document` + `knowledge_chunk` + FTS5 virtual table
`knowledge_chunk_fts`. Schema is mirrored from `desktop/src-tauri/src/db.rs`
and re-created idempotently in case the sidecar starts before the desktop.

Embedding format: Float32 little-endian, dim from `EMBED_MODEL_DIM`. Same as
the TS `vecToBlob`/`blobToVec` helpers, so vectors written by either side
deserialize on the other.

Retrieval: hybrid FTS5 (BM25) + cosine on embeddings + RRF fusion (K=60),
identical to `desktop/src/memory/knowledge.service.ts:searchKb`.

Public API (unchanged from the previous JSONL implementation):
  add(source, text, *, title="", tags=None) -> int
  search(query, top_k=5) -> list[{text, source, title, score}]
  size() -> int
"""
from __future__ import annotations
import math
import os
import re
import sqlite3
import struct
import time
import uuid
from pathlib import Path


# Chunking — aligned with desktop's CHUNK_MAX/CHUNK_OVERLAP (knowledge.service.ts:25)
CHUNK_SIZE = 800
OVERLAP = 100
MIN_CHUNK = 200

# Embedding model — default. Real value lives in kb_setting (DB), written by
# the desktop app. Sidecar reads it on every operation so a model switch is
# picked up without restart.
DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small"
DEFAULT_EMBED_DIM = 512
EMBED_MODEL = DEFAULT_EMBED_MODEL  # legacy name kept for tests/imports
EMBED_DIM = DEFAULT_EMBED_DIM

# Catalog mirrors desktop/src/memory/embedding-catalog.ts. Used to resolve dim
# when only the model id is stored in kb_setting (older rows / migration).
_MODEL_DIMS = {
    "openai/text-embedding-3-small": 512,
    "openai/text-embedding-3-large": 3072,
    "qwen/qwen3-embedding-8b": 4096,
    "qwen/qwen3-embedding-4b": 2560,
    "google/gemini-embedding-001": 3072,
    "mistralai/mistral-embed-2312": 1024,
}

# RRF fusion constant (mirrors knowledge.service.ts:176)
RRF_K = 60

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS knowledge_document (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    language TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_chunk (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    start_char INTEGER NOT NULL,
    end_char INTEGER NOT NULL,
    page_number INTEGER,
    embedding_model TEXT,
    embedding_dim INTEGER,
    embedding_blob BLOB,
    resonance_score REAL NOT NULL DEFAULT 0.0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(document_id) REFERENCES knowledge_document(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunk_doc ON knowledge_chunk(document_id);
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunk_fts USING fts5(content, content='knowledge_chunk', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS chunk_ai AFTER INSERT ON knowledge_chunk BEGIN
    INSERT INTO knowledge_chunk_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS chunk_ad AFTER DELETE ON knowledge_chunk BEGIN
    DELETE FROM knowledge_chunk_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS chunk_au AFTER UPDATE ON knowledge_chunk BEGIN
    DELETE FROM knowledge_chunk_fts WHERE rowid = old.rowid;
    INSERT INTO knowledge_chunk_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TABLE IF NOT EXISTS kb_setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
"""


def _db_path() -> Path:
    override = os.getenv("KB_DB_PATH")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".monkey" / "data.db"


_FIX_FTS_TRIGGERS_SQL = """
DROP TRIGGER IF EXISTS chunk_ad;
DROP TRIGGER IF EXISTS chunk_au;
CREATE TRIGGER chunk_ad AFTER DELETE ON knowledge_chunk BEGIN
    INSERT INTO knowledge_chunk_fts(knowledge_chunk_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER chunk_au AFTER UPDATE ON knowledge_chunk BEGIN
    INSERT INTO knowledge_chunk_fts(knowledge_chunk_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO knowledge_chunk_fts(rowid, content) VALUES (new.rowid, new.content);
END;
"""


def _conn() -> sqlite3.Connection:
    p = _db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(p))
    c.execute("PRAGMA foreign_keys=ON")
    c.executescript(_SCHEMA_SQL)
    # External-content FTS5 needs the 'delete' command to remove tokens —
    # plain `DELETE FROM fts WHERE rowid=…` fails with `no such column: T.content_rowid`.
    # Patch the buggy triggers (from older schema in db.rs) idempotently.
    try:
        c.executescript(_FIX_FTS_TRIGGERS_SQL)
    except Exception:
        pass
    return c


def _current_model(c: sqlite3.Connection) -> tuple[str | None, int | None]:
    """Read embedding model + dim from kb_setting. Returns (None, None) when
    user has not picked a model yet — KB is then considered inactive."""
    try:
        row = c.execute(
            "SELECT value FROM kb_setting WHERE key = 'embedding_model'"
        ).fetchone()
        if not row or not row[0]:
            return (None, None)
        model = str(row[0])
        dim = _MODEL_DIMS.get(model)
        row2 = c.execute(
            "SELECT value FROM kb_setting WHERE key = 'embedding_dim'"
        ).fetchone()
        if row2 and row2[0]:
            try:
                dim = int(row2[0])
            except Exception:
                pass
        return (model, dim)
    except Exception:
        return (None, None)


def is_active() -> bool:
    """True when a model is configured and every non-archived chunk is vectorized
    with it. Mirrors knowledge.service.ts:getStatus()."""
    c = _conn()
    try:
        model, _ = _current_model(c)
        if not model:
            return False
        total = c.execute(
            "SELECT COUNT(*) FROM knowledge_chunk ch "
            "JOIN knowledge_document d ON d.id = ch.document_id "
            "WHERE d.archived = 0"
        ).fetchone()[0]
        if not total:
            return False
        vec = c.execute(
            "SELECT COUNT(*) FROM knowledge_chunk ch "
            "JOIN knowledge_document d ON d.id = ch.document_id "
            "WHERE d.archived = 0 AND ch.embedding_model = ? AND ch.embedding_blob IS NOT NULL",
            (model,),
        ).fetchone()[0]
        return int(vec) == int(total)
    finally:
        c.close()


def _embed(text: str) -> list[float] | None:
    try:
        from monkey.skills_store import _embed_text
        return _embed_text(text)
    except Exception:
        return None


def _vec_to_blob(vec: list[float]) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


def _blob_to_vec(blob: bytes) -> list[float]:
    n = len(blob) // 4
    if n == 0:
        return []
    return list(struct.unpack(f"<{n}f", blob))


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _chunk(text: str) -> list[tuple[str, int, int]]:
    """Sentence-aware chunker aligned with desktop's KnowledgeService.chunkText
    (knowledge.service.ts:205). Returns (chunk_text, start_char, end_char)."""
    text = re.sub(r"\s+\n", "\n", text).strip()
    if not text:
        return []
    if len(text) <= CHUNK_SIZE:
        return [(text, 0, len(text))]
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out: list[tuple[str, int, int]] = []
    cur = ""
    cur_start = 0
    pos = 0
    for s in sentences:
        s_start = text.find(s, pos)
        if s_start >= 0:
            pos = s_start + len(s)
        if len(cur) + len(s) + 1 > CHUNK_SIZE and cur:
            out.append((cur.strip(), cur_start, cur_start + len(cur)))
            tail = cur[max(0, len(cur) - OVERLAP):]
            cur = tail + " " + s
            cur_start = max(0, s_start - len(tail) - 1)
        else:
            if not cur:
                cur_start = s_start if s_start >= 0 else 0
            cur = (cur + " " + s).strip() if cur else s
    if cur.strip():
        out.append((cur.strip(), cur_start, cur_start + len(cur)))
    # Drop fragments below MIN_CHUNK unless they are the only chunk
    if len(out) > 1:
        out = [c for c in out if len(c[0]) >= MIN_CHUNK]
    return out


def _uuid() -> str:
    return str(uuid.uuid4())


def add(source: str, text: str, *, title: str = "", tags: list[str] | None = None) -> int:
    """Insert a document + chunks into the desktop KB. Returns number of chunks added."""
    if not text or len(text.strip()) < MIN_CHUNK:
        return 0
    chunks = _chunk(text)
    if not chunks:
        return 0
    doc_id = _uuid()
    now = int(time.time() * 1000)  # ms, like desktop's Date.now()
    size_bytes = len(text.encode("utf-8"))
    tags_json = '[' + ",".join(f'"{t}"' for t in (tags or [])) + ']'
    c = _conn()
    try:
        model, dim = _current_model(c)
        if not model:
            # No model configured → store document + chunks without vectors.
            # Hybrid search degrades to FTS-only until user picks a model and
            # runs reEmbedAll() from desktop UI.
            model, dim = (None, None)
        c.execute(
            "INSERT INTO knowledge_document (id, title, source, source_url, mime_type, size_bytes, raw_text, language, tags, metadata, archived, created_at) "
            "VALUES (?, ?, ?, ?, 'text/plain', ?, ?, NULL, ?, '{}', 0, ?)",
            (doc_id, (title or source)[:200], source[:200], source[:500], size_bytes, text, tags_json, now),
        )
        added = 0
        for i, (ch, s_pos, e_pos) in enumerate(chunks):
            vec = _embed(ch) if model else None
            blob = _vec_to_blob(vec) if (vec and dim and len(vec) == dim) else None
            c.execute(
                "INSERT INTO knowledge_chunk (id, document_id, chunk_index, content, start_char, end_char, page_number, embedding_model, embedding_dim, embedding_blob, resonance_score, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)",
                (
                    _uuid(), doc_id, i, ch, s_pos, e_pos,
                    model if blob else None,
                    dim if blob else None,
                    blob, now,
                ),
            )
            added += 1
        c.commit()
        return added
    finally:
        c.close()


def search(query: str, top_k: int = 5) -> list[dict]:
    """Hybrid FTS5 + cosine + RRF, matching desktop's KnowledgeService.searchKb.
    Returns [{text, source, title, score, document_id, chunk_index}]."""
    if not query or not query.strip():
        return []
    c = _conn()
    try:
        # FTS5 — guard against malformed MATCH expressions (quotes, operators)
        try:
            fts_query = _sanitize_fts(query)
            fts = c.execute(
                "SELECT c.id, c.document_id, c.chunk_index, c.content, d.title, d.source, d.source_url "
                "FROM knowledge_chunk_fts f "
                "JOIN knowledge_chunk c ON c.rowid = f.rowid "
                "JOIN knowledge_document d ON d.id = c.document_id "
                "WHERE knowledge_chunk_fts MATCH ? AND d.archived = 0 "
                "ORDER BY rank LIMIT 20",
                (fts_query,),
            ).fetchall()
        except sqlite3.OperationalError:
            fts = []

        # ANN — only if a model is configured and the agent's embed function
        # returns vectors at the matching dim. Otherwise we fall back to FTS only.
        ann: list[tuple] = []
        model, dim = _current_model(c)
        qvec = _embed(query) if model else None
        if qvec and dim and len(qvec) == dim:
            candidates = c.execute(
                "SELECT c.id, c.document_id, c.chunk_index, c.content, d.title, d.source, d.source_url, c.embedding_blob "
                "FROM knowledge_chunk c JOIN knowledge_document d ON d.id = c.document_id "
                "WHERE d.archived = 0 AND c.embedding_model = ? AND c.embedding_blob IS NOT NULL "
                "ORDER BY c.created_at DESC LIMIT 1000",
                (model,),
            ).fetchall()
            scored = []
            for row in candidates:
                vec = _blob_to_vec(row[7])
                sim = _cosine(qvec, vec)
                if sim >= 0.3:
                    scored.append((sim, row[:7]))
            scored.sort(key=lambda x: x[0], reverse=True)
            ann = [r for _, r in scored[:20]]
    finally:
        c.close()

    # RRF fusion
    scores: dict[str, float] = {}
    rows_by_id: dict[str, tuple] = {}
    for i, r in enumerate(ann):
        scores[r[0]] = scores.get(r[0], 0.0) + 1.0 / (RRF_K + i + 1)
        rows_by_id[r[0]] = r
    for i, r in enumerate(fts):
        scores[r[0]] = scores.get(r[0], 0.0) + 1.0 / (RRF_K + i + 1)
        rows_by_id[r[0]] = r

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:top_k]
    out = []
    for cid, score in ranked:
        r = rows_by_id[cid]
        out.append({
            "text": r[3],
            "source": r[6] or r[5] or "",
            "title": r[4] or "",
            "score": round(score, 4),
            "document_id": r[1],
            "chunk_index": int(r[2] or 0),
        })
    return out


def _sanitize_fts(q: str) -> str:
    """FTS5 MATCH chokes on bare quotes, dashes, and reserved operators. Tokenize
    to alphanum words and OR-join them. Cheap, predictable, no false-positive
    syntax errors."""
    words = re.findall(r"\w{2,}", q, flags=re.UNICODE)
    if not words:
        return '""'
    # Quote each token to disable operator parsing
    return " OR ".join(f'"{w}"' for w in words[:16])


def size() -> int:
    c = _conn()
    try:
        row = c.execute("SELECT COUNT(*) FROM knowledge_chunk").fetchone()
        return int(row[0] or 0)
    finally:
        c.close()


def _doc_row(c: sqlite3.Connection, row: tuple) -> dict:
    doc_id = row[0]
    chunks = c.execute(
        "SELECT COUNT(*), SUM(CASE WHEN embedding_blob IS NOT NULL THEN 1 ELSE 0 END) "
        "FROM knowledge_chunk WHERE document_id = ?",
        (doc_id,),
    ).fetchone()
    chunk_count = int(chunks[0] or 0)
    vec_count = int(chunks[1] or 0)
    try:
        import json as _json
        tags = _json.loads(row[4] or "[]")
    except Exception:
        tags = []
    return {
        "id": doc_id,
        "title": row[1] or "",
        "source": row[2] or "",
        "sizeBytes": int(row[3] or 0),
        "tags": tags,
        "archived": bool(row[5]),
        "createdAt": int(row[6] or 0),
        "chunkCount": chunk_count,
        "vectorizedChunks": vec_count,
        "hasEmbeddings": vec_count > 0,
    }


def list_documents(
    *,
    tag: str | None = None,
    source_prefix: str | None = None,
    search: str | None = None,
    archived: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """List docs with filters. `search` matches title or source substring."""
    limit = max(1, min(int(limit or 100), 500))
    offset = max(0, int(offset or 0))
    where = ["d.archived = ?"]
    params: list = [1 if archived else 0]
    if tag:
        where.append("d.tags LIKE ?")
        params.append(f'%"{tag}"%')
    if source_prefix:
        where.append("d.source LIKE ?")
        params.append(f"{source_prefix}%")
    if search:
        where.append("(d.title LIKE ? OR d.source LIKE ?)")
        like = f"%{search}%"
        params.extend([like, like])
    sql = (
        "SELECT d.id, d.title, d.source, d.size_bytes, d.tags, d.archived, d.created_at "
        "FROM knowledge_document d WHERE " + " AND ".join(where) +
        " ORDER BY d.created_at DESC LIMIT ? OFFSET ?"
    )
    params.extend([limit, offset])
    c = _conn()
    try:
        rows = c.execute(sql, params).fetchall()
        return [_doc_row(c, r) for r in rows]
    finally:
        c.close()


def stats() -> dict:
    c = _conn()
    try:
        model, dim = _current_model(c)
        total_docs = c.execute("SELECT COUNT(*) FROM knowledge_document WHERE archived = 0").fetchone()[0]
        archived_docs = c.execute("SELECT COUNT(*) FROM knowledge_document WHERE archived = 1").fetchone()[0]
        total_chunks = c.execute(
            "SELECT COUNT(*) FROM knowledge_chunk ch JOIN knowledge_document d ON d.id = ch.document_id WHERE d.archived = 0"
        ).fetchone()[0]
        vec_chunks = c.execute(
            "SELECT COUNT(*) FROM knowledge_chunk ch JOIN knowledge_document d ON d.id = ch.document_id "
            "WHERE d.archived = 0 AND ch.embedding_blob IS NOT NULL"
        ).fetchone()[0]
        unindexed_docs = c.execute(
            "SELECT COUNT(*) FROM knowledge_document d WHERE d.archived = 0 AND NOT EXISTS ("
            "  SELECT 1 FROM knowledge_chunk ch WHERE ch.document_id = d.id AND ch.embedding_blob IS NOT NULL"
            ")"
        ).fetchone()[0]
        # Tag histogram (top 20) — approximate, scans tags JSON string
        tag_rows = c.execute(
            "SELECT tags FROM knowledge_document WHERE archived = 0 AND tags != '[]'"
        ).fetchall()
        import json as _json
        tag_count: dict[str, int] = {}
        for (t,) in tag_rows:
            try:
                for tag in _json.loads(t or "[]"):
                    tag_count[tag] = tag_count.get(tag, 0) + 1
            except Exception:
                continue
        by_tag = sorted(tag_count.items(), key=lambda kv: kv[1], reverse=True)[:20]
        # Source prefix histogram (split on ':')
        src_rows = c.execute("SELECT source FROM knowledge_document WHERE archived = 0").fetchall()
        src_count: dict[str, int] = {}
        for (s,) in src_rows:
            prefix = (s or "").split(":", 1)[0] or "(none)"
            src_count[prefix] = src_count.get(prefix, 0) + 1
        by_source = sorted(src_count.items(), key=lambda kv: kv[1], reverse=True)[:20]
        return {
            "totalDocs": int(total_docs or 0),
            "archivedDocs": int(archived_docs or 0),
            "totalChunks": int(total_chunks or 0),
            "vectorizedChunks": int(vec_chunks or 0),
            "unindexedDocs": int(unindexed_docs or 0),
            "embeddingModel": model,
            "embeddingDim": dim,
            "byTag": [{"tag": k, "count": v} for k, v in by_tag],
            "bySourcePrefix": [{"prefix": k, "count": v} for k, v in by_source],
        }
    finally:
        c.close()


def archive_documents(doc_ids: list[str], archived: bool = True) -> int:
    if not doc_ids:
        return 0
    placeholders = ",".join("?" * len(doc_ids))
    c = _conn()
    try:
        cur = c.execute(
            f"UPDATE knowledge_document SET archived = ? WHERE id IN ({placeholders})",
            [1 if archived else 0, *doc_ids],
        )
        c.commit()
        return int(cur.rowcount or 0)
    finally:
        c.close()


def delete_documents(doc_ids: list[str]) -> int:
    """Hard delete docs + chunks (cascade) + FTS rows (via trigger)."""
    if not doc_ids:
        return 0
    placeholders = ",".join("?" * len(doc_ids))
    c = _conn()
    try:
        # Chunks first (FTS trigger relies on row presence)
        c.execute(
            f"DELETE FROM knowledge_chunk WHERE document_id IN ({placeholders})",
            doc_ids,
        )
        cur = c.execute(
            f"DELETE FROM knowledge_document WHERE id IN ({placeholders})",
            doc_ids,
        )
        c.commit()
        return int(cur.rowcount or 0)
    finally:
        c.close()


def purge_unindexed() -> int:
    """Delete all non-archived docs that have zero vectorized chunks. Returns count deleted."""
    c = _conn()
    try:
        rows = c.execute(
            "SELECT d.id FROM knowledge_document d WHERE d.archived = 0 AND NOT EXISTS ("
            "  SELECT 1 FROM knowledge_chunk ch WHERE ch.document_id = d.id AND ch.embedding_blob IS NOT NULL"
            ")"
        ).fetchall()
        ids = [r[0] for r in rows]
    finally:
        c.close()
    return delete_documents(ids)

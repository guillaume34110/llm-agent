"""Local SQLite memory: user profile facts + session history + free notes."""
import sqlite3, json, time, uuid
from pathlib import Path

DB_PATH = Path.home() / ".monkey" / "memory.db"

def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    c.executescript("""
    CREATE TABLE IF NOT EXISTS facts (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT NOT NULL,
        created_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        session_id TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL
    );
    """)
    return c

def upsert_fact(key: str, value: str):
    with _conn() as c:
        c.execute("INSERT INTO facts(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                  (key, value, time.time()))

def get_facts() -> dict[str, str]:
    with _conn() as c:
        rows = c.execute("SELECT key, value FROM facts ORDER BY updated_at DESC").fetchall()
    return {r["key"]: r["value"] for r in rows}

def get_profile_summary(max_facts: int = 8) -> str:
    facts = get_facts()
    if not facts:
        return ""
    items = list(facts.items())[:max_facts]
    return "\n".join(f"- {k}: {v}" for k, v in items)


def get_relevant_profile(user_message: str, max_facts: int = 6) -> str:
    """Return only facts whose key or value shares a token with the user message.

    Avoids leaking unrelated stale facts (old project paths, past contexts) into
    every system prompt. Agent can still call recall_facts tool when it needs
    the full set explicitly.
    """
    import re
    facts = get_facts()
    if not facts:
        return ""
    msg = (user_message or "").lower()
    tokens = {t for t in re.findall(r"[a-zà-ÿ0-9_]{3,}", msg)}
    if not tokens:
        return ""
    scored: list[tuple[int, str, str]] = []
    for k, v in facts.items():
        hay = f"{k} {v}".lower()
        hay_tokens = set(re.findall(r"[a-zà-ÿ0-9_]{3,}", hay))
        overlap = len(tokens & hay_tokens)
        if overlap > 0:
            scored.append((overlap, k, v))
    if not scored:
        return ""
    scored.sort(key=lambda x: -x[0])
    return "\n".join(f"- {k}: {v}" for _, k, v in scored[:max_facts])

def save_session(summary: str):
    with _conn() as c:
        c.execute("INSERT INTO sessions(summary, created_at) VALUES(?,?)", (summary, time.time()))

def get_recent_sessions(n: int = 3) -> list[str]:
    with _conn() as c:
        rows = c.execute("SELECT summary FROM sessions ORDER BY created_at DESC LIMIT ?", (n,)).fetchall()
    return [r["summary"] for r in rows]


# ── Free notes ────────────────────────────────────────────────────────────────

def add_note(content: str, tags: list[str] | None = None, session_id: str = "") -> str:
    nid = uuid.uuid4().hex
    tags_json = json.dumps(list(tags or []), ensure_ascii=False)
    with _conn() as c:
        c.execute(
            "INSERT INTO notes(id, content, tags, session_id, archived, created_at) VALUES(?,?,?,?,0,?)",
            (nid, content, tags_json, session_id or "", time.time()),
        )
    return nid


def archive_note(note_id: str) -> bool:
    with _conn() as c:
        cur = c.execute("UPDATE notes SET archived = 1 WHERE id = ?", (note_id,))
        return cur.rowcount > 0


def list_atoms(limit: int = 50, q: str | None = None) -> list[dict]:
    """Return facts + notes + sessions unified as 'atom' shape for the UI."""
    q_norm = (q or "").strip().lower()
    items: list[dict] = []
    with _conn() as c:
        # Facts → atom(type=fact)
        fact_sql = "SELECT key, value, updated_at FROM facts"
        for r in c.execute(fact_sql).fetchall():
            content = f"{r['key']}: {r['value']}"
            if q_norm and q_norm not in content.lower():
                continue
            items.append({
                "id": f"fact:{r['key']}",
                "content": content,
                "type": "fact",
                "tags": ["profile"],
                "sessionId": "",
                "createdAt": int(r["updated_at"] * 1000),
            })
        # Notes → atom(type=note)
        note_sql = "SELECT id, content, tags, session_id, created_at FROM notes WHERE archived = 0"
        for r in c.execute(note_sql).fetchall():
            content = r["content"]
            if q_norm and q_norm not in content.lower():
                continue
            try:
                tags = json.loads(r["tags"] or "[]")
            except Exception:
                tags = []
            items.append({
                "id": f"note:{r['id']}",
                "content": content,
                "type": "note",
                "tags": tags,
                "sessionId": r["session_id"] or "",
                "createdAt": int(r["created_at"] * 1000),
            })
        # Sessions → atom(type=session)
        sess_sql = "SELECT id, summary, created_at FROM sessions"
        for r in c.execute(sess_sql).fetchall():
            content = r["summary"]
            if q_norm and q_norm not in content.lower():
                continue
            items.append({
                "id": f"session:{r['id']}",
                "content": content,
                "type": "session",
                "tags": [],
                "sessionId": str(r["id"]),
                "createdAt": int(r["created_at"] * 1000),
            })
    items.sort(key=lambda x: x["createdAt"], reverse=True)
    return items[:limit]


def archive_atom(atom_id: str) -> bool:
    """Archive any atom: fact:<key>, note:<id>, session:<id>."""
    if not atom_id:
        return False
    if atom_id.startswith("fact:"):
        key = atom_id[5:]
        with _conn() as c:
            cur = c.execute("DELETE FROM facts WHERE key = ?", (key,))
            return cur.rowcount > 0
    if atom_id.startswith("note:"):
        return archive_note(atom_id[5:])
    if atom_id.startswith("session:"):
        try:
            sid = int(atom_id[8:])
        except ValueError:
            return False
        with _conn() as c:
            cur = c.execute("DELETE FROM sessions WHERE id = ?", (sid,))
            return cur.rowcount > 0
    return False

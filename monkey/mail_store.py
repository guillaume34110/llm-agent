"""Mail storage — SQLite CRUD for accounts and synced messages.

Shares ~/.monkey/data.db with kb_store.py and desktop's db.rs. Schema is
mirrored here for sidecar-first boots (when Tauri hasn't run yet).
Passwords are NEVER stored in this DB — they live in the OS keychain via
`keyring`. Account rows hold only server config + sync state.
"""
from __future__ import annotations
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS mail_account (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    imap_host TEXT NOT NULL,
    imap_port INTEGER NOT NULL,
    imap_socket TEXT NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port INTEGER NOT NULL,
    smtp_socket TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'password',
    index_in_kb INTEGER NOT NULL DEFAULT 0,
    last_sync_at INTEGER NOT NULL DEFAULT 0,
    last_uid INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_message (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    uid INTEGER NOT NULL,
    folder TEXT NOT NULL DEFAULT 'INBOX',
    message_id TEXT,
    in_reply_to TEXT,
    thread_id TEXT,
    from_addr TEXT NOT NULL DEFAULT '',
    to_addrs TEXT NOT NULL DEFAULT '[]',
    cc_addrs TEXT NOT NULL DEFAULT '[]',
    subject TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    body_html TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    flags TEXT NOT NULL DEFAULT '[]',
    date_ts INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    indexed_in_kb INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(account_id) REFERENCES mail_account(id) ON DELETE CASCADE,
    UNIQUE(account_id, folder, uid)
);
CREATE INDEX IF NOT EXISTS idx_mail_account ON mail_message(account_id, date_ts DESC);
CREATE INDEX IF NOT EXISTS idx_mail_thread ON mail_message(thread_id);
CREATE INDEX IF NOT EXISTS idx_mail_unread ON mail_message(account_id, flags);
CREATE VIRTUAL TABLE IF NOT EXISTS mail_message_fts USING fts5(
    subject, body_text, from_addr,
    content='mail_message', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS mail_message_ai AFTER INSERT ON mail_message BEGIN
    INSERT INTO mail_message_fts(rowid, subject, body_text, from_addr)
    VALUES (new.rowid, new.subject, new.body_text, new.from_addr);
END;
CREATE TRIGGER IF NOT EXISTS mail_message_ad AFTER DELETE ON mail_message BEGIN
    DELETE FROM mail_message_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS mail_message_au AFTER UPDATE ON mail_message BEGIN
    DELETE FROM mail_message_fts WHERE rowid = old.rowid;
    INSERT INTO mail_message_fts(rowid, subject, body_text, from_addr)
    VALUES (new.rowid, new.subject, new.body_text, new.from_addr);
END;
CREATE TABLE IF NOT EXISTS mail_attachment (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    storage_path TEXT,
    FOREIGN KEY(message_id) REFERENCES mail_message(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mail_attach_msg ON mail_attachment(message_id);
"""

KEYRING_SERVICE = "monkey-mail"


def _db_path() -> Path:
    override = os.getenv("KB_DB_PATH")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".monkey" / "data.db"


def _conn() -> sqlite3.Connection:
    p = _db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(p))
    c.execute("PRAGMA foreign_keys=ON")
    c.executescript(_SCHEMA_SQL)
    return c


def _row_to_account(r: tuple) -> dict:
    return {
        "id": r[0],
        "label": r[1],
        "email": r[2],
        "imap": {"host": r[3], "port": int(r[4]), "socket": r[5]},
        "smtp": {"host": r[6], "port": int(r[7]), "socket": r[8]},
        "authType": r[9],
        "indexInKb": bool(r[10]),
        "lastSyncAt": int(r[11]),
        "lastUid": int(r[12]),
        "lastError": r[13] or "",
        "createdAt": int(r[14]),
    }


_ACCOUNT_COLS = (
    "id, label, email, imap_host, imap_port, imap_socket, "
    "smtp_host, smtp_port, smtp_socket, auth_type, index_in_kb, "
    "last_sync_at, last_uid, last_error, created_at"
)


def list_accounts() -> list[dict]:
    c = _conn()
    try:
        rows = c.execute(f"SELECT {_ACCOUNT_COLS} FROM mail_account ORDER BY created_at").fetchall()
        return [_row_to_account(r) for r in rows]
    finally:
        c.close()


def get_account(account_id: str) -> dict | None:
    c = _conn()
    try:
        row = c.execute(
            f"SELECT {_ACCOUNT_COLS} FROM mail_account WHERE id = ?",
            (account_id,),
        ).fetchone()
        return _row_to_account(row) if row else None
    finally:
        c.close()


def upsert_account(payload: dict) -> dict:
    """Insert or update an account. Email is the natural key for upsert."""
    email = str(payload.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise ValueError("invalid email")
    imap = payload.get("imap") or {}
    smtp = payload.get("smtp") or {}
    if not imap.get("host") or not smtp.get("host"):
        raise ValueError("imap/smtp host required")
    now = int(time.time() * 1000)
    c = _conn()
    try:
        existing = c.execute(
            "SELECT id FROM mail_account WHERE email = ?", (email,)
        ).fetchone()
        if existing:
            aid = existing[0]
            c.execute(
                "UPDATE mail_account SET label=?, imap_host=?, imap_port=?, imap_socket=?, "
                "smtp_host=?, smtp_port=?, smtp_socket=?, auth_type=?, index_in_kb=? "
                "WHERE id=?",
                (
                    payload.get("label") or email,
                    imap["host"], int(imap["port"]), imap.get("socket") or "SSL",
                    smtp["host"], int(smtp["port"]), smtp.get("socket") or "SSL",
                    payload.get("authType") or "password",
                    1 if payload.get("indexInKb") else 0,
                    aid,
                ),
            )
        else:
            aid = payload.get("id") or f"mail_{uuid.uuid4().hex[:12]}"
            c.execute(
                f"INSERT INTO mail_account ({_ACCOUNT_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    aid,
                    payload.get("label") or email,
                    email,
                    imap["host"], int(imap["port"]), imap.get("socket") or "SSL",
                    smtp["host"], int(smtp["port"]), smtp.get("socket") or "SSL",
                    payload.get("authType") or "password",
                    1 if payload.get("indexInKb") else 0,
                    0, 0, "", now,
                ),
            )
        c.commit()
        row = c.execute(
            f"SELECT {_ACCOUNT_COLS} FROM mail_account WHERE id = ?", (aid,)
        ).fetchone()
        return _row_to_account(row)
    finally:
        c.close()


def delete_account(account_id: str) -> bool:
    c = _conn()
    try:
        cur = c.execute("DELETE FROM mail_account WHERE id = ?", (account_id,))
        c.commit()
        return cur.rowcount > 0
    finally:
        c.close()


def set_sync_state(account_id: str, *, last_uid: int | None = None,
                   last_error: str | None = None, touched: bool = True) -> None:
    sets = []
    vals: list = []
    if last_uid is not None:
        sets.append("last_uid = ?")
        vals.append(int(last_uid))
    if last_error is not None:
        sets.append("last_error = ?")
        vals.append(str(last_error)[:500])
    if touched:
        sets.append("last_sync_at = ?")
        vals.append(int(time.time() * 1000))
    if not sets:
        return
    vals.append(account_id)
    c = _conn()
    try:
        c.execute(f"UPDATE mail_account SET {', '.join(sets)} WHERE id = ?", vals)
        c.commit()
    finally:
        c.close()


# ── Password (keychain) ──────────────────────────────────────────────────────

def set_password(account_id: str, password: str) -> None:
    import keyring
    keyring.set_password(KEYRING_SERVICE, account_id, password)


def get_password(account_id: str) -> str | None:
    try:
        import keyring
        return keyring.get_password(KEYRING_SERVICE, account_id)
    except Exception:
        return None


def delete_password(account_id: str) -> None:
    try:
        import keyring
        keyring.delete_password(KEYRING_SERVICE, account_id)
    except Exception:
        pass


# ── Messages ─────────────────────────────────────────────────────────────────

_MSG_COLS = (
    "id, account_id, uid, folder, message_id, in_reply_to, thread_id, "
    "from_addr, to_addrs, cc_addrs, subject, body_text, body_html, "
    "has_attachments, flags, date_ts, size_bytes, indexed_in_kb, created_at"
)


def _row_to_message(r: tuple, *, with_html: bool = False) -> dict:
    out = {
        "id": r[0],
        "accountId": r[1],
        "uid": int(r[2]),
        "folder": r[3],
        "messageId": r[4] or "",
        "inReplyTo": r[5] or "",
        "threadId": r[6] or "",
        "from": r[7] or "",
        "to": json.loads(r[8] or "[]"),
        "cc": json.loads(r[9] or "[]"),
        "subject": r[10] or "",
        "bodyText": r[11] or "",
        "hasAttachments": bool(r[13]),
        "flags": json.loads(r[14] or "[]"),
        "dateTs": int(r[15]),
        "sizeBytes": int(r[16]),
        "indexedInKb": bool(r[17]),
    }
    if with_html:
        out["bodyHtml"] = r[12] or ""
    return out


def insert_message(account_id: str, msg: dict) -> str | None:
    """Insert a parsed message. Returns the new id or None if already present."""
    c = _conn()
    try:
        existing = c.execute(
            "SELECT id FROM mail_message WHERE account_id = ? AND folder = ? AND uid = ?",
            (account_id, msg.get("folder") or "INBOX", int(msg["uid"])),
        ).fetchone()
        if existing:
            return None
        mid = f"mm_{uuid.uuid4().hex[:16]}"
        now = int(time.time() * 1000)
        c.execute(
            f"INSERT INTO mail_message ({_MSG_COLS}) VALUES "
            "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                mid, account_id, int(msg["uid"]), msg.get("folder") or "INBOX",
                msg.get("messageId") or "", msg.get("inReplyTo") or "",
                msg.get("threadId") or msg.get("messageId") or "",
                msg.get("from") or "",
                json.dumps(msg.get("to") or []),
                json.dumps(msg.get("cc") or []),
                msg.get("subject") or "",
                msg.get("bodyText") or "",
                msg.get("bodyHtml") or None,
                1 if msg.get("hasAttachments") else 0,
                json.dumps(msg.get("flags") or []),
                int(msg.get("dateTs") or now),
                int(msg.get("sizeBytes") or 0),
                0, now,
            ),
        )
        c.commit()
        return mid
    finally:
        c.close()


def list_messages(account_id: str | None = None, *, folder: str = "INBOX",
                  limit: int = 50, offset: int = 0,
                  unread_only: bool = False) -> list[dict]:
    c = _conn()
    try:
        where = ["folder = ?"]
        vals: list = [folder]
        if account_id:
            where.append("account_id = ?")
            vals.append(account_id)
        if unread_only:
            where.append("flags NOT LIKE '%\\Seen%'")
        vals += [int(limit), int(offset)]
        sql = (
            f"SELECT {_MSG_COLS} FROM mail_message WHERE "
            + " AND ".join(where)
            + " ORDER BY date_ts DESC LIMIT ? OFFSET ?"
        )
        rows = c.execute(sql, vals).fetchall()
        return [_row_to_message(r) for r in rows]
    finally:
        c.close()


def get_message(message_id: str, *, with_html: bool = True) -> dict | None:
    c = _conn()
    try:
        row = c.execute(
            f"SELECT {_MSG_COLS} FROM mail_message WHERE id = ?", (message_id,)
        ).fetchone()
        return _row_to_message(row, with_html=with_html) if row else None
    finally:
        c.close()


def update_flags(message_id: str, flags: list[str]) -> None:
    c = _conn()
    try:
        c.execute(
            "UPDATE mail_message SET flags = ? WHERE id = ?",
            (json.dumps(flags), message_id),
        )
        c.commit()
    finally:
        c.close()


def update_folder(message_id: str, folder: str) -> None:
    c = _conn()
    try:
        c.execute(
            "UPDATE mail_message SET folder = ? WHERE id = ?",
            (folder, message_id),
        )
        c.commit()
    finally:
        c.close()


def mark_indexed(message_id: str) -> None:
    c = _conn()
    try:
        c.execute("UPDATE mail_message SET indexed_in_kb = 1 WHERE id = ?", (message_id,))
        c.commit()
    finally:
        c.close()


def search_messages(query: str, *, account_id: str | None = None,
                    limit: int = 20) -> list[dict]:
    if not query.strip():
        return []
    import re
    words = re.findall(r"\w{2,}", query, flags=re.UNICODE)
    if not words:
        return []
    fts_query = " OR ".join(f'"{w}"' for w in words[:16])
    c = _conn()
    try:
        if account_id:
            sql = (
                f"SELECT {_MSG_COLS.replace('id,', 'm.id,').replace(',', ', m.', 1)} "
                "FROM mail_message_fts f JOIN mail_message m ON m.rowid = f.rowid "
                "WHERE mail_message_fts MATCH ? AND m.account_id = ? "
                "ORDER BY rank LIMIT ?"
            )
            # Simpler: project explicitly
            sql = (
                "SELECT m.id, m.account_id, m.uid, m.folder, m.message_id, m.in_reply_to, "
                "m.thread_id, m.from_addr, m.to_addrs, m.cc_addrs, m.subject, m.body_text, "
                "m.body_html, m.has_attachments, m.flags, m.date_ts, m.size_bytes, "
                "m.indexed_in_kb, m.created_at "
                "FROM mail_message_fts f JOIN mail_message m ON m.rowid = f.rowid "
                "WHERE mail_message_fts MATCH ? AND m.account_id = ? "
                "ORDER BY rank LIMIT ?"
            )
            rows = c.execute(sql, (fts_query, account_id, int(limit))).fetchall()
        else:
            sql = (
                "SELECT m.id, m.account_id, m.uid, m.folder, m.message_id, m.in_reply_to, "
                "m.thread_id, m.from_addr, m.to_addrs, m.cc_addrs, m.subject, m.body_text, "
                "m.body_html, m.has_attachments, m.flags, m.date_ts, m.size_bytes, "
                "m.indexed_in_kb, m.created_at "
                "FROM mail_message_fts f JOIN mail_message m ON m.rowid = f.rowid "
                "WHERE mail_message_fts MATCH ? "
                "ORDER BY rank LIMIT ?"
            )
            rows = c.execute(sql, (fts_query, int(limit))).fetchall()
        return [_row_to_message(r) for r in rows]
    except sqlite3.OperationalError:
        return []
    finally:
        c.close()


def unread_count(account_id: str | None = None) -> int:
    c = _conn()
    try:
        where = ["flags NOT LIKE '%\\Seen%'"]
        vals: list = []
        if account_id:
            where.append("account_id = ?")
            vals.append(account_id)
        sql = "SELECT COUNT(*) FROM mail_message WHERE " + " AND ".join(where)
        row = c.execute(sql, vals).fetchone()
        return int(row[0] or 0)
    finally:
        c.close()

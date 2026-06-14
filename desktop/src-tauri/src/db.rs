use rusqlite::Connection;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct DbState {
    pub conn: Mutex<Connection>,
}

pub fn db_path() -> PathBuf {
    let mut p = dirs::home_dir().expect("no home dir");
    p.push(".monkey");
    std::fs::create_dir_all(&p).ok();
    p.push("data.db");
    p
}

pub fn init() -> Connection {
    // Register sqlite-vec as an auto-extension so every connection loads it.
    // Best-effort: ignore errors if registration fails.
    unsafe {
        let _ = rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }

    let path = db_path();
    let conn = Connection::open(&path).expect("failed to open db");

    conn.execute_batch(SCHEMA_SQL)
        .expect("schema bootstrap failed");
    conn
}

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS memory_atom (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'discussion',
    tags TEXT NOT NULL DEFAULT '[]',
    resonance_score REAL NOT NULL DEFAULT 0.0,
    session_id TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    embedding_model TEXT,
    embedding_dim INTEGER,
    embedding_blob BLOB,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_atom_archived ON memory_atom(archived, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atom_type ON memory_atom(type);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_atom_fts USING fts5(content, content='memory_atom', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS memory_atom_ai AFTER INSERT ON memory_atom BEGIN
    INSERT INTO memory_atom_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memory_atom_ad AFTER DELETE ON memory_atom BEGIN
    DELETE FROM memory_atom_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS memory_atom_au AFTER UPDATE ON memory_atom BEGIN
    DELETE FROM memory_atom_fts WHERE rowid = old.rowid;
    INSERT INTO memory_atom_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TABLE IF NOT EXISTS memory_dream (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source_atom_ids TEXT NOT NULL DEFAULT '[]',
    resonance_score REAL NOT NULL DEFAULT 0.0,
    validated INTEGER NOT NULL DEFAULT 0,
    embedding_model TEXT,
    embedding_dim INTEGER,
    embedding_blob BLOB,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dream_validated ON memory_dream(validated, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_document (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'upload',
    source_url TEXT,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    raw_text TEXT NOT NULL,
    language TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_archived ON knowledge_document(archived, created_at DESC);

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
    INSERT INTO knowledge_chunk_fts(knowledge_chunk_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS chunk_au AFTER UPDATE ON knowledge_chunk BEGIN
    INSERT INTO knowledge_chunk_fts(knowledge_chunk_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO knowledge_chunk_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TABLE IF NOT EXISTS knowledge_collection (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coll_updated ON knowledge_collection(updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_collection_document (
    collection_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY(collection_id, document_id),
    FOREIGN KEY(collection_id) REFERENCES knowledge_collection(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES knowledge_document(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_coll_doc_doc ON knowledge_collection_document(document_id);

CREATE TABLE IF NOT EXISTS user_profile (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kb_setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS wa_chat (
    jid TEXT PRIMARY KEY,
    display_name TEXT,
    last_message_at INTEGER,
    last_preview TEXT NOT NULL DEFAULT '',
    message_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_chat_recent ON wa_chat(last_message_at DESC);

CREATE TABLE IF NOT EXISTS wa_message (
    id TEXT PRIMARY KEY,
    jid TEXT NOT NULL,
    from_bot INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL DEFAULT '',
    ts INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_message_jid_ts ON wa_message(jid, ts DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS wa_message_fts USING fts5(text, content='wa_message', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS wa_message_ai AFTER INSERT ON wa_message BEGIN
    INSERT INTO wa_message_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS wa_message_ad AFTER DELETE ON wa_message BEGIN
    DELETE FROM wa_message_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS wa_message_au AFTER UPDATE ON wa_message BEGIN
    DELETE FROM wa_message_fts WHERE rowid = old.rowid;
    INSERT INTO wa_message_fts(rowid, text) VALUES (new.rowid, new.text);
END;
"#;

#[tauri::command]
pub fn db_query(
    state: State<DbState>,
    sql: String,
    params_json: String,
) -> Result<Vec<Vec<Value>>, String> {
    let params_arr: Vec<Value> =
        serde_json::from_str(&params_json).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().unwrap();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let col_count = stmt.column_count();
    let rows: Result<Vec<Vec<Value>>, _> = stmt
        .query_map(
            rusqlite::params_from_iter(params_arr.iter().map(json_to_sql)),
            |row| {
                let mut out: Vec<Value> = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    let val: rusqlite::types::Value = row.get(i)?;
                    out.push(sql_to_json(val));
                }
                Ok(out)
            },
        )
        .map_err(|e| e.to_string())?
        .collect();
    rows.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_execute(
    state: State<DbState>,
    sql: String,
    params_json: String,
) -> Result<usize, String> {
    let params_arr: Vec<Value> =
        serde_json::from_str(&params_json).map_err(|e| e.to_string())?;
    let conn = state.conn.lock().unwrap();
    conn.execute(
        &sql,
        rusqlite::params_from_iter(params_arr.iter().map(json_to_sql)),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_execute_batch(state: State<DbState>, sql: String) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    conn.execute_batch(&sql).map_err(|e| e.to_string())
}

fn json_to_sql(v: &Value) -> Box<dyn rusqlite::ToSql> {
    match v {
        Value::Null => Box::new(rusqlite::types::Null),
        Value::Bool(b) => Box::new(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        Value::String(s) => Box::new(s.clone()),
        Value::Array(a) => {
            // assume array of u8 -> BLOB (embeddings serialized as Vec<u8>)
            let bytes: Vec<u8> = a
                .iter()
                .filter_map(|v| v.as_u64().map(|n| n as u8))
                .collect();
            Box::new(bytes)
        }
        Value::Object(_) => Box::new(v.to_string()),
    }
}

fn sql_to_json(v: rusqlite::types::Value) -> Value {
    match v {
        rusqlite::types::Value::Null => Value::Null,
        rusqlite::types::Value::Integer(i) => Value::from(i),
        rusqlite::types::Value::Real(f) => Value::from(f),
        rusqlite::types::Value::Text(s) => Value::String(s),
        rusqlite::types::Value::Blob(b) => Value::Array(b.into_iter().map(Value::from).collect()),
    }
}

// Local-first WhatsApp persistence: messages + chat roster + FTS search.
// Backed by Tauri SQLite (db.rs: wa_chat, wa_message, wa_message_fts).

import { dbQuery, dbExecute } from '../db';

const MAX_MESSAGES_PER_CHAT = 2000;
const PURGE_OLDER_THAN_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

export interface PersistedMessage {
  id: string;
  jid: string;
  fromBot: boolean;
  text: string;
  ts: number;
}

export interface PersistedChat {
  jid: string;
  displayName: string | null;
  lastMessageAt: number | null;
  lastPreview: string;
  messageCount: number;
}

const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) { try { fn(); } catch {} } }

export function subscribePersistedChats(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function preview(text: string, max = 140): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export async function recordMessage(msg: PersistedMessage, displayName?: string | null): Promise<boolean> {
  const now = Date.now();
  const inserted = await dbExecute(
    'INSERT OR IGNORE INTO wa_message (id, jid, from_bot, text, ts, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [msg.id, msg.jid, msg.fromBot ? 1 : 0, msg.text || '', msg.ts || now, now],
  );
  if (inserted === 0) return false;

  const prev = await dbQuery<[number | null, string | null, number]>(
    'SELECT last_message_at, display_name, message_count FROM wa_chat WHERE jid = ?',
    [msg.jid],
  );
  const row = prev[0];
  const prevTs = row ? (row[0] as number | null) : null;
  const prevName = row ? (row[1] as string | null) : null;
  const prevCount = row ? Number(row[2] || 0) : 0;
  const nextTs = Math.max(prevTs || 0, msg.ts || now);
  const nextName = displayName || prevName || null;
  const nextPreview = preview(msg.text);

  await dbExecute(
    `INSERT INTO wa_chat (jid, display_name, last_message_at, last_preview, message_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(jid) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, wa_chat.display_name),
       last_message_at = MAX(COALESCE(wa_chat.last_message_at, 0), excluded.last_message_at),
       last_preview = excluded.last_preview,
       message_count = wa_chat.message_count + 1,
       updated_at = excluded.updated_at`,
    [msg.jid, nextName, nextTs, nextPreview, prevCount + 1, now],
  );

  notify();
  return true;
}

export async function upsertChatMeta(jid: string, displayName: string | null): Promise<void> {
  if (!jid) return;
  const now = Date.now();
  await dbExecute(
    `INSERT INTO wa_chat (jid, display_name, last_message_at, last_preview, message_count, updated_at)
     VALUES (?, ?, NULL, '', 0, ?)
     ON CONFLICT(jid) DO UPDATE SET
       display_name = COALESCE(excluded.display_name, wa_chat.display_name),
       updated_at = excluded.updated_at`,
    [jid, displayName, now],
  );
  notify();
}

export async function listPersistedChats(): Promise<PersistedChat[]> {
  const rows = await dbQuery<[string, string | null, number | null, string, number]>(
    `SELECT jid, display_name, last_message_at, last_preview, message_count
     FROM wa_chat
     ORDER BY COALESCE(last_message_at, 0) DESC`,
  );
  return rows.map(r => ({
    jid: r[0] as string,
    displayName: (r[1] as string | null) || null,
    lastMessageAt: r[2] as number | null,
    lastPreview: (r[3] as string) || '',
    messageCount: Number(r[4] || 0),
  }));
}

export async function getRecentMessages(jid: string, limit = 20): Promise<PersistedMessage[]> {
  const rows = await dbQuery<[string, string, number, string, number]>(
    `SELECT id, jid, from_bot, text, ts FROM wa_message
     WHERE jid = ? ORDER BY ts DESC LIMIT ?`,
    [jid, limit],
  );
  return rows
    .map(r => ({
      id: r[0] as string,
      jid: r[1] as string,
      fromBot: Number(r[2]) === 1,
      text: (r[3] as string) || '',
      ts: Number(r[4]) || 0,
    }))
    .reverse();
}

export async function searchMessages(jid: string, query: string, limit = 5): Promise<PersistedMessage[]> {
  const q = (query || '').trim();
  if (!q) return [];
  const ftsQuery = q
    .split(/\s+/)
    .filter(Boolean)
    .map(t => t.replace(/["']/g, ''))
    .filter(t => t.length >= 2)
    .map(t => `"${t}"`)
    .join(' OR ');
  if (!ftsQuery) return [];
  try {
    const rows = await dbQuery<[string, string, number, string, number]>(
      `SELECT m.id, m.jid, m.from_bot, m.text, m.ts
       FROM wa_message m
       JOIN wa_message_fts fts ON fts.rowid = m.rowid
       WHERE m.jid = ? AND wa_message_fts MATCH ?
       ORDER BY bm25(wa_message_fts) ASC, m.ts DESC
       LIMIT ?`,
      [jid, ftsQuery, limit],
    );
    return rows.map(r => ({
      id: r[0] as string,
      jid: r[1] as string,
      fromBot: Number(r[2]) === 1,
      text: (r[3] as string) || '',
      ts: Number(r[4]) || 0,
    }));
  } catch (e) {
    console.warn('[wa-store] FTS search failed:', e);
    return [];
  }
}

export async function purgeOldMessages(): Promise<void> {
  const cutoff = Date.now() - PURGE_OLDER_THAN_MS;
  await dbExecute('DELETE FROM wa_message WHERE ts < ?', [cutoff]);
  const jids = await dbQuery<[string]>('SELECT jid FROM wa_chat');
  for (const [jid] of jids) {
    await dbExecute(
      `DELETE FROM wa_message
       WHERE jid = ? AND rowid NOT IN (
         SELECT rowid FROM wa_message WHERE jid = ? ORDER BY ts DESC LIMIT ?
       )`,
      [jid, jid, MAX_MESSAGES_PER_CHAT],
    );
    const counts = await dbQuery<[number]>(
      'SELECT COUNT(*) FROM wa_message WHERE jid = ?',
      [jid],
    );
    const count = Number(counts[0]?.[0] || 0);
    await dbExecute('UPDATE wa_chat SET message_count = ? WHERE jid = ?', [count, jid]);
  }
  notify();
}

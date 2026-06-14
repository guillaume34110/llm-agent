// Client for /api/social/wall/* — encrypted forum per tag.
// One broadcast key per (tag, generation), fetched by anyone opted-in for the
// tag (server enforces). Same AES key wraps all payloads under that generation
// — clients encrypt locally before posting and decrypt locally after listing.
// Server only sees ciphertext + metadata (tag, mode, pseudonym, expiresAt).

import { bytesToBase64, base64ToBytes } from './share-crypto';

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type WallMode = 'find_collab' | 'find_expertise' | 'announce_project' | 'rfc';

export interface WallKey {
  tag: string;
  generation: number;
  wrappedKey: string; // base64 raw 32 bytes
}

export interface WallPostRow {
  id: string;
  authorPseudonymForTag: string;
  tag: string;
  mode: WallMode;
  schemaVersion: string;
  payloadEnc: string; // base64 [iv(12) || ct]
  keyGen: number;
  filters: any;
  createdAt: string;
  expiresAt: string;
}

export interface WallPostDecoded {
  id: string;
  pseudonym: string;
  tag: string;
  mode: WallMode;
  payload: any;
  filters: any;
  createdAt: string;
  expiresAt: string;
}

export interface WallReplyRow {
  id: string;
  postId: string;
  responderPseudonymForTag: string;
  answer: any;
  rationaleEnc?: string | null;
  guardPassed: boolean;
  createdAt: string;
}

const keyCache = new Map<string, { key: CryptoKey; generation: number; at: number }>();
const CACHE_TTL = 5 * 60_000;

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function fetchWallKey(tag: string): Promise<{ key: CryptoKey; generation: number }> {
  const hit = keyCache.get(tag);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { key: hit.key, generation: hit.generation };
  const res = await fetch(`${backendUrl}/api/social/wall/key/${encodeURIComponent(tag)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`wall key failed: ${res.status}`);
  const body: WallKey = await res.json();
  const raw = base64ToBytes(body.wrappedKey);
  if (raw.length !== 32) throw new Error(`bad wall key length: ${raw.length}`);
  const key = await importKey(raw);
  keyCache.set(tag, { key, generation: body.generation, at: Date.now() });
  return { key, generation: body.generation };
}

async function encryptForTag(tag: string, payload: unknown): Promise<{ payloadEncB64: string; generation: number }> {
  const { key, generation } = await fetchWallKey(tag);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv, 0);
  blob.set(ct, iv.length);
  return { payloadEncB64: bytesToBase64(blob), generation };
}

async function decryptForTag(tag: string, payloadEncB64: string): Promise<any> {
  const { key } = await fetchWallKey(tag);
  const blob = base64ToBytes(payloadEncB64);
  if (blob.length < 13) throw new Error('blob too small');
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function postWall(input: {
  tag: string;
  mode: WallMode;
  payload: any;
  filters?: any;
}): Promise<{ id: string }> {
  const { payloadEncB64 } = await encryptForTag(input.tag, input.payload);
  const res = await fetch(`${backendUrl}/api/social/wall/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      tag: input.tag,
      mode: input.mode,
      schemaVersion: '1',
      payloadEnc: payloadEncB64,
      filters: input.filters ?? {},
      guardPassed: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`wall post failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function listWall(tag: string, limit = 50): Promise<WallPostDecoded[]> {
  const u = new URL(`${backendUrl}/api/social/wall/tag/${encodeURIComponent(tag)}`);
  u.searchParams.set('limit', String(limit));
  const res = await fetch(u.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error(`wall list failed: ${res.status}`);
  const body = await res.json();
  const rows: WallPostRow[] = body.posts || [];
  const out: WallPostDecoded[] = [];
  for (const r of rows) {
    try {
      const payload = await decryptForTag(tag, r.payloadEnc);
      out.push({
        id: r.id,
        pseudonym: r.authorPseudonymForTag,
        tag: r.tag,
        mode: r.mode,
        payload,
        filters: r.filters,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      });
    } catch {
      // Old generation or corrupt blob — skip.
    }
  }
  return out;
}

export async function replyWall(
  postId: string,
  body: { answer: unknown; rationaleEnc?: string },
): Promise<WallReplyRow> {
  const res = await fetch(`${backendUrl}/api/social/wall/${encodeURIComponent(postId)}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      answer: body.answer,
      rationaleEnc: body.rationaleEnc,
      guardPassed: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`wall reply failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchReplies(postId: string): Promise<{ count?: number; replies?: WallReplyRow[] }> {
  const res = await fetch(`${backendUrl}/api/social/wall/${encodeURIComponent(postId)}/replies`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`replies failed: ${res.status}`);
  const body = await res.json();
  if (Array.isArray(body)) return { replies: body };
  if (typeof body.count === 'number') return { count: body.count };
  return { replies: body.replies || [] };
}

// AES-GCM helpers for end-to-end encrypted share blobs.
// The key never reaches the server: it lives in the URL fragment and is
// stripped from outbound HTTP requests by browsers and fetch.
//
// Wire format: [12-byte IV][AES-GCM ciphertext]. Same layout for conversation
// shares and collection-share-v1 bundles.

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface ShareUploadResult {
  id: string;
  url: string;
  keyB64u: string;
}

// Encrypts `payload` (JSON-serializable), uploads ciphertext to
// /api/social/conversations, and returns the share URL with key in fragment.
// `fragmentExtras` lets callers prepend extra fragment params (e.g.
// `kind=collection`) before the `key=...` component.
export async function encryptAndUploadShare(
  payload: unknown,
  fragmentExtras: string = '',
): Promise<ShareUploadResult> {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv, 0);
  blob.set(ct, iv.length);

  const res = await fetch(`${backendUrl}/api/social/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ encryptedBlobB64: bytesToBase64(blob) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`share failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const { id } = await res.json();
  const keyB64u = bytesToB64Url(keyBytes);
  const fragment = fragmentExtras ? `${fragmentExtras}&key=${keyB64u}` : `key=${keyB64u}`;
  const url = `${backendUrl}/api/social/conversations/${id}#${fragment}`;
  return { id, url, keyB64u };
}

// Fetches ciphertext for `id` and decrypts with the provided url-safe base64 key.
// Returns the parsed JSON payload (caller validates `kind`/schema).
export async function fetchAndDecryptShare<T = unknown>(id: string, keyB64u: string): Promise<T> {
  const keyBytes = base64ToBytes(keyB64u);
  const res = await fetch(`${backendUrl}/api/social/conversations/${id}`);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 13) throw new Error('blob too small');
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    'AES-GCM',
    false,
    ['decrypt'],
  );
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

// Extracts `{ id, keyB64u, params }` from a share URL whose fragment contains
// `key=<urlsafe-b64>` (and optionally other params like `kind=collection`).
export function parseShareUrl(url: string): { id: string; keyB64u: string; params: URLSearchParams } {
  const match = url.match(/conversations\/([\w-]+)/);
  if (!match) throw new Error('invalid share URL');
  const id = match[1];
  const fragment = url.split('#')[1] || '';
  const params = new URLSearchParams(fragment);
  const keyB64u = params.get('key');
  if (!keyB64u) throw new Error('missing key in URL fragment');
  return { id, keyB64u, params };
}

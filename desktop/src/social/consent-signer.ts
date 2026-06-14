// Cryptographic consent signer for sensitive P2P actions (broadcasts, KB share).
// Generates a persistent ECDSA P-256 keypair on first use (JWK in localStorage),
// signs a canonical consent payload, and exposes a local audit log so the user
// can later prove that *they* (not an automated agent) approved the action.
//
// This is intentionally client-only: the server never sees the private key, and
// signatures travel alongside the request as opaque base64 for future verification.

const KEY_STORAGE_PRIV = 'consent_priv_jwk_v1';
const KEY_STORAGE_PUB = 'consent_pub_jwk_v1';
const AUDIT_STORAGE = 'consent_audit_v1';
const MAX_AUDIT_ENTRIES = 200;

export interface ConsentEnvelope {
  pubkey: string; // base64 raw SPKI
  sig: string;    // base64 raw ECDSA signature
  nonce: string;  // 16-byte hex, replay protection
  ts: number;     // unix ms
  payloadDigest: string; // sha256 hex of canonical payload string
}

export interface ConsentAuditEntry extends ConsentEnvelope {
  scope: string;     // e.g. 'inquiry.broadcast' | 'group.kb.publish'
  summary: string;   // human-readable digest of what was approved
  approvedAt: string; // iso
}

function b64encode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function getOrCreateKeyPair(): Promise<CryptoKeyPair> {
  const privRaw = localStorage.getItem(KEY_STORAGE_PRIV);
  const pubRaw = localStorage.getItem(KEY_STORAGE_PUB);
  if (privRaw && pubRaw) {
    try {
      const priv = await crypto.subtle.importKey(
        'jwk', JSON.parse(privRaw), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
      );
      const pub = await crypto.subtle.importKey(
        'jwk', JSON.parse(pubRaw), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'],
      );
      return { privateKey: priv, publicKey: pub };
    } catch {
      // fall through to regenerate
    }
  }
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  localStorage.setItem(KEY_STORAGE_PRIV, JSON.stringify(privJwk));
  localStorage.setItem(KEY_STORAGE_PUB, JSON.stringify(pubJwk));
  return kp;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canonicalize(payload: Record<string, unknown>): string {
  // Deterministic JSON: keys sorted recursively.
  const sort = (v: any): any => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc, k) => {
        acc[k] = sort(v[k]);
        return acc;
      }, {} as Record<string, any>);
    }
    return v;
  };
  return JSON.stringify(sort(payload));
}

function randomNonceHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signConsent(
  scope: string,
  summary: string,
  payload: Record<string, unknown>,
): Promise<ConsentEnvelope> {
  const kp = await getOrCreateKeyPair();
  const nonce = randomNonceHex();
  const ts = Date.now();
  const enriched = { ...payload, scope, nonce, ts };
  const canonical = canonicalize(enriched);
  const payloadDigest = await sha256Hex(canonical);

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    kp.privateKey,
    new TextEncoder().encode(canonical),
  );
  const pubSpki = await crypto.subtle.exportKey('spki', kp.publicKey);

  const env: ConsentEnvelope = {
    pubkey: b64encode(pubSpki),
    sig: b64encode(sigBuf),
    nonce,
    ts,
    payloadDigest,
  };

  appendAudit({ ...env, scope, summary, approvedAt: new Date(ts).toISOString() });
  return env;
}

function appendAudit(entry: ConsentAuditEntry): void {
  let arr: ConsentAuditEntry[] = [];
  try {
    arr = JSON.parse(localStorage.getItem(AUDIT_STORAGE) || '[]');
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  arr.unshift(entry);
  if (arr.length > MAX_AUDIT_ENTRIES) arr.length = MAX_AUDIT_ENTRIES;
  localStorage.setItem(AUDIT_STORAGE, JSON.stringify(arr));
}

export function listConsentAudit(): ConsentAuditEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(AUDIT_STORAGE) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

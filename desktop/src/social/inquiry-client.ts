// Client for /api/social/inquiry/* — LLM(A) side of the collab match flow.
//
// LLM(A) crafts a natural-language question about a project need, hashes it
// locally (sha256), and broadcasts {mode, tags, questionDigest} to the server.
// The server fans out to up to N opted-in users matching mode+tags. The actual
// question text is never sent — it travels later over the E2E channel between
// matched agents.

import type { AvailabilityMode, AvailabilityTag } from './availability-client';
import type { ConsentEnvelope } from './consent-signer';

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface BroadcastInput {
  mode: AvailabilityMode;
  tags: AvailabilityTag[];
  question: string;
  fanout?: number;
  consent?: ConsentEnvelope; // signed double opt-in, attached on re-consent
}

export interface BroadcastResult {
  id: string;
  fanout: number;
  expiresAt: string;
  recipients: string[];
}

export interface InquiryRecord {
  id: string;
  initiatorId: string;
  mode: AvailabilityMode;
  filters: { tags: string[] };
  fanout: number;
  costCents: number;
  status: 'open' | 'closed' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface InquiryWithResponses extends InquiryRecord {
  responses: Array<{
    id: string;
    responderId: string;
    answer: unknown;
    rationaleEnc?: string | null;
    guardPassed: boolean;
    agentSig?: string | null;
    createdAt: string;
  }>;
}

export interface RespondInput {
  answer: unknown;
  rationaleEnc?: string;
  guardPassed: boolean;
  agentSig?: string;
  // Runtime fingerprint. When present, server registers the cert on first
  // sighting and refuses payloads from revoked runtimes. Keeps moderation
  // bans effective without de-anonymizing the user.
  agentPubkey?: string;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function broadcastInquiry(input: BroadcastInput): Promise<BroadcastResult> {
  if (!input.question || input.question.trim().length < 8) {
    throw new Error('question too short');
  }
  if (!input.tags || input.tags.length === 0) {
    throw new Error('at least one tag required');
  }
  const questionDigest = await sha256Hex(input.question.trim());
  const res = await fetch(`${backendUrl}/api/social/inquiry/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      mode: input.mode,
      tags: input.tags,
      fanout: input.fanout,
      questionDigest,
      ...(input.consent
        ? {
            consentSig: input.consent.sig,
            consentPubkey: input.consent.pubkey,
            consentNonce: input.consent.nonce,
            consentTs: input.consent.ts,
            consentDigest: input.consent.payloadDigest,
          }
        : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`broadcast failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchInquiryInbox(): Promise<InquiryRecord[]> {
  const res = await fetch(`${backendUrl}/api/social/inquiry/inbox`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`inbox fetch failed: ${res.status}`);
  const body = await res.json();
  return body.inquiries || [];
}

export async function getInquiry(id: string): Promise<InquiryWithResponses> {
  const res = await fetch(`${backendUrl}/api/social/inquiry/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`inquiry get failed: ${res.status}`);
  return res.json();
}

export async function respondToInquiry(id: string, body: RespondInput): Promise<unknown> {
  const res = await fetch(`${backendUrl}/api/social/inquiry/${encodeURIComponent(id)}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`respond failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function closeInquiry(id: string): Promise<void> {
  const res = await fetch(`${backendUrl}/api/social/inquiry/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`close failed: ${res.status}`);
}

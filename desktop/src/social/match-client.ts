// Client for /api/social/match/* — multi-turn LLM(A)<->LLM(B) negotiation.
//
// After a "yes" response on an inquiry, the initiator opens a MatchSession
// and the two agents exchange up to 5 turns (E2E ciphertext). Server stores
// opaque payloads only; it knows the pair but never the content.

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface MatchSession {
  id: string;
  inquiryId: string;
  initiatorId: string;
  responderId: string;
  status: 'open' | 'closed' | 'expired';
  createdAt: string;
  expiresAt: string;
  closedAt?: string | null;
  closedReason?: string | null;
}

export interface MatchTurn {
  id: string;
  sessionId: string;
  turnIndex: number;
  roleA: boolean;
  ciphertext: string; // base64
  createdAt: string;
}

export interface MatchSessionDetail extends MatchSession {
  turns: MatchTurn[];
}

export async function startMatchSession(inquiryId: string, responderId: string): Promise<MatchSession> {
  const res = await fetch(`${backendUrl}/api/social/match/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ inquiryId, responderId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`match start failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function listMyMatchSessions(): Promise<MatchSession[]> {
  const res = await fetch(`${backendUrl}/api/social/match/mine`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`match list failed: ${res.status}`);
  const body = await res.json();
  return body.sessions || [];
}

export async function getMatchSession(id: string): Promise<MatchSessionDetail> {
  const res = await fetch(`${backendUrl}/api/social/match/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`match get failed: ${res.status}`);
  return res.json();
}

export async function appendMatchTurn(
  id: string,
  ciphertext: string,
  cert?: { agentPubkey: string; agentSig?: string },
): Promise<MatchTurn> {
  const res = await fetch(`${backendUrl}/api/social/match/${encodeURIComponent(id)}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ciphertext, ...(cert ?? {}) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`match turn failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function closeMatchSession(
  id: string,
  reason: 'completed' | 'rejected' | 'timeout' | 'abort',
): Promise<void> {
  const res = await fetch(`${backendUrl}/api/social/match/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`match close failed: ${res.status}`);
}

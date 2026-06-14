// Client for /api/social/friends/* and /api/social/match/:id/{consent,report}.
// Double-consent + reputation surface live here.

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Friend {
  id: string;
  userId: string;
  friendId: string;
  viaSessionId?: string | null;
  createdAt: string;
}

export async function listFriends(): Promise<Friend[]> {
  const res = await fetch(`${backendUrl}/api/social/friends`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`friends list failed: ${res.status}`);
  const body = await res.json();
  return body.friends || [];
}

export async function removeFriend(friendId: string): Promise<void> {
  const res = await fetch(
    `${backendUrl}/api/social/friends/${encodeURIComponent(friendId)}/remove`,
    { method: 'POST', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`remove failed: ${res.status}`);
}

export interface FriendInvite {
  token: string;
  expiresAt: string;
  createdAt?: string;
}

export async function createFriendInvite(): Promise<FriendInvite> {
  const res = await fetch(`${backendUrl}/api/social/friends/invite`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`invite create failed: ${res.status}`);
  return res.json();
}

export async function listFriendInvites(): Promise<FriendInvite[]> {
  const res = await fetch(`${backendUrl}/api/social/friends/invite`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`invite list failed: ${res.status}`);
  const body = await res.json();
  return body.invites || [];
}

export async function redeemFriendInvite(
  token: string,
): Promise<{ ok: boolean; friendId: string; already: boolean }> {
  const res = await fetch(`${backendUrl}/api/social/friends/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.message || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function revokeFriendInvite(token: string): Promise<void> {
  const res = await fetch(
    `${backendUrl}/api/social/friends/invite/${encodeURIComponent(token)}/revoke`,
    { method: 'POST', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`revoke failed: ${res.status}`);
}

export async function getReputation(): Promise<{ earned: number; score: number }> {
  const res = await fetch(`${backendUrl}/api/social/friends/reputation`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`reputation failed: ${res.status}`);
  return res.json();
}

export async function consentMatch(sessionId: string, decision: 'accept' | 'reject') {
  const res = await fetch(
    `${backendUrl}/api/social/match/${encodeURIComponent(sessionId)}/consent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ decision }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`consent failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<{ ok: boolean; friended: boolean }>;
}

export async function submitMatchReport(sessionId: string, ciphertext: string, agentSigA: string) {
  const res = await fetch(
    `${backendUrl}/api/social/match/${encodeURIComponent(sessionId)}/report`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ciphertext, agentSigA }),
    },
  );
  if (!res.ok) throw new Error(`report failed: ${res.status}`);
  return res.json();
}

export async function ackMatchReport(sessionId: string, agentSigB: string) {
  const res = await fetch(
    `${backendUrl}/api/social/match/${encodeURIComponent(sessionId)}/report/ack`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ agentSigB }),
    },
  );
  if (!res.ok) throw new Error(`report ack failed: ${res.status}`);
  return res.json();
}

export async function getMatchReport(sessionId: string) {
  const res = await fetch(
    `${backendUrl}/api/social/match/${encodeURIComponent(sessionId)}/report`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`report fetch failed: ${res.status}`);
  return res.json() as Promise<{
    id: string;
    sessionId: string;
    ciphertext: string;
    agentSigA: string;
    agentSigB: string | null;
    ackedAt: string | null;
    createdAt: string;
  }>;
}

export async function getMatchAnonView(sessionId: string) {
  const res = await fetch(
    `${backendUrl}/api/social/match/${encodeURIComponent(sessionId)}/anon`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`anon view failed: ${res.status}`);
  return res.json() as Promise<{
    sessionId: string;
    myAnonId: string;
    peerAnonId: string | null;
    roleA: boolean;
  }>;
}

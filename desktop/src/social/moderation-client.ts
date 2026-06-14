// Client for /api/social/moderation/*. Block/signal endpoints are user-facing;
// revoke-cert is admin-only (server checks role) and lets a moderator kill a
// runtime fingerprint without ever needing the user id behind it.

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function revokeAgentCert(fingerprint: string, reason: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error('bad fingerprint');
  const res = await fetch(`${backendUrl}/api/social/moderation/revoke-cert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ fingerprint, reason }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`revoke-cert failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function signalContent(input: {
  targetUserId: string;
  targetKind: 'inquiry' | 'inquiry_response' | 'wall_post' | 'wall_reply' | 'project_member';
  targetId: string;
  reason: 'spam' | 'harass' | 'leak' | 'guard_bypass' | 'other';
  note?: string;
}): Promise<unknown> {
  const res = await fetch(`${backendUrl}/api/social/moderation/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`signal failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

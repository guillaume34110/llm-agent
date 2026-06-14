// Client for /api/social/group/* — server relay opaque forum + KB share.
// Server stores ciphertext + per-recipient wrappedKey; clients hold the
// symmetric key. KB bundles expire after 1h (owner re-publishes if online).

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface GroupThread {
  id: string;
  ownerId: string;
  title: string;
  createdAt: string;
  members?: Array<{ userId: string }>;
}

export interface GroupMessage {
  id: string;
  senderId: string;
  ciphertext: string;
  createdAt: string;
}

export interface GroupKbBundle {
  id: string;
  ownerId: string;
  modelId: string;
  ciphertext: string;
  expiresAt: string;
  createdAt: string;
}

export async function createGroupThread(input: {
  title: string;
  members: Array<{ userId: string; wrappedKey: string }>;
}): Promise<GroupThread> {
  const res = await fetch(`${backendUrl}/api/social/group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`group create failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function listMyGroupThreads(): Promise<GroupThread[]> {
  const res = await fetch(`${backendUrl}/api/social/group/mine`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`group list failed: ${res.status}`);
  const body = await res.json();
  return body.threads || [];
}

export async function fetchMyGroupKey(threadId: string): Promise<string> {
  const res = await fetch(`${backendUrl}/api/social/group/${encodeURIComponent(threadId)}/key`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`group key failed: ${res.status}`);
  const body = await res.json();
  return body.wrappedKey;
}

export async function postGroupMessage(threadId: string, ciphertext: string): Promise<GroupMessage> {
  const res = await fetch(
    `${backendUrl}/api/social/group/${encodeURIComponent(threadId)}/post`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ciphertext }),
    },
  );
  if (!res.ok) throw new Error(`group post failed: ${res.status}`);
  return res.json();
}

export async function fetchGroupMessages(threadId: string, since?: string): Promise<GroupMessage[]> {
  const u = new URL(`${backendUrl}/api/social/group/${encodeURIComponent(threadId)}/messages`);
  if (since) u.searchParams.set('since', since);
  const res = await fetch(u.toString(), { headers: authHeaders() });
  if (!res.ok) throw new Error(`group messages failed: ${res.status}`);
  const body = await res.json();
  return body.messages || [];
}

export async function publishGroupKb(
  threadId: string,
  modelId: string,
  ciphertext: string,
): Promise<GroupKbBundle> {
  const res = await fetch(
    `${backendUrl}/api/social/group/${encodeURIComponent(threadId)}/kb`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ modelId, ciphertext }),
    },
  );
  if (!res.ok) throw new Error(`kb publish failed: ${res.status}`);
  return res.json();
}

export async function fetchGroupKb(threadId: string): Promise<GroupKbBundle[]> {
  const res = await fetch(
    `${backendUrl}/api/social/group/${encodeURIComponent(threadId)}/kb`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`kb fetch failed: ${res.status}`);
  const body = await res.json();
  return body.bundles || [];
}

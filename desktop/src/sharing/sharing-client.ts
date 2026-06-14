// Per-friend ACL client (Spec A). Maps GET/PUT/DELETE /api/sharing/acl.
// Row exists ⇔ friend may consume my compute. Default OFF, requires mutual friendship.

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface AclRow {
  friendId: string;
  createdAt: string;
}

export async function listAcl(): Promise<AclRow[]> {
  const res = await fetch(`${backendUrl}/api/sharing/acl`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`acl list failed: ${res.status}`);
  return res.json();
}

export async function grantAcl(friendId: string): Promise<void> {
  const res = await fetch(
    `${backendUrl}/api/sharing/acl/${encodeURIComponent(friendId)}`,
    { method: 'PUT', headers: authHeaders() },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`acl grant failed: ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function revokeAcl(friendId: string): Promise<void> {
  const res = await fetch(
    `${backendUrl}/api/sharing/acl/${encodeURIComponent(friendId)}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`acl revoke failed: ${res.status}`);
}

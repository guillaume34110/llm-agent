// Client for the public-profile + shared-conversation endpoints.
// Conversation blobs are encrypted client-side; the server stores opaque bytes.

import { encryptAndUploadShare } from './share-crypto';

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface PublicProfile {
  handle: string | null;
  bio?: string | null;
  avatarCosmeticId?: string | null;
}

export async function fetchMyProfile(): Promise<PublicProfile> {
  const res = await fetch(`${backendUrl}/api/social/me/profile`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  return res.json();
}

export async function upsertMyProfile(input: { handle?: string; bio?: string; avatarCosmeticId?: string | null }): Promise<PublicProfile> {
  const res = await fetch(`${backendUrl}/api/social/me/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`profile update failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function deleteMyProfile(): Promise<void> {
  await fetch(`${backendUrl}/api/social/me/profile`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function fetchProfileByHandle(handle: string): Promise<PublicProfile | null> {
  const res = await fetch(`${backendUrl}/api/social/profile/${encodeURIComponent(handle)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`profile lookup failed: ${res.status}`);
  return res.json();
}

// Encrypt a JSON-serializable conversation, upload the ciphertext, and return a
// shareable URL with the key in the fragment. The server never sees the key.
export async function shareConversation(payload: unknown): Promise<{ url: string; id: string }> {
  const { id, url } = await encryptAndUploadShare(payload);
  return { id, url };
}

// Client for /api/forge/accounts/* — user-supplied OAuth tokens for
// GitHub/GitLab/Gitea/Forgejo. The agent uses these to clone, list repos,
// open PRs, etc. Repo content is never stored server-side.

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type ForgeProvider = 'github' | 'gitlab' | 'gitea' | 'forgejo';

export interface ForgeAccount {
  id: string;
  provider: ForgeProvider;
  externalId: string;
  handle: string;
  scope: string;
  expiresAt: string | null;
  createdAt: string;
}

export async function listForgeAccounts(): Promise<ForgeAccount[]> {
  const res = await fetch(`${backendUrl}/api/forge/accounts`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`forge list failed: ${res.status}`);
  const body = await res.json();
  return body.accounts || [];
}

export async function upsertForgeAccount(input: {
  provider: ForgeProvider;
  externalId: string;
  handle: string;
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: string;
}): Promise<void> {
  const res = await fetch(`${backendUrl}/api/forge/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`forge upsert failed: ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function removeForgeAccount(provider: ForgeProvider): Promise<void> {
  const res = await fetch(`${backendUrl}/api/forge/accounts/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`forge remove failed: ${res.status}`);
}

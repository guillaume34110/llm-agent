// GDPR Art. 15 (export) + Art. 17 (erasure) — calls server endpoints and bundles local data.
const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'https://ai.progsoft.eu';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function exportAccountData(): Promise<Blob> {
  const res = await fetch(`${backendUrl}/api/account/export`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
  const server = await res.json();

  const local: Record<string, any> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k === 'jwt') continue;
    local[k] = localStorage.getItem(k);
  }

  const bundle = {
    exportedAt: new Date().toISOString(),
    note: 'GDPR Art. 15 data export. Server holds billing/auth only; local holds chat history, memory, knowledge.',
    server,
    localStorage: local,
  };
  return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${backendUrl}/api/account`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
  localStorage.clear();
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

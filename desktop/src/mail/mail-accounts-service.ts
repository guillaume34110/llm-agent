import type { MailServerConfig, ServerConfig } from './autodiscover';

const SIDECAR_BASE = (import.meta as any).env?.VITE_SIDECAR_URL || 'http://localhost:3471';

export interface MailAccount {
  id: string;
  label: string;
  email: string;
  imap: ServerConfig;
  smtp: ServerConfig;
  authType: 'password' | 'oauth';
  indexInKb: boolean;
  createdAt: number;
  lastSyncAt: number;
  lastError: string;
  /** True when a password is present in the OS keychain for this account. */
  credentialsReady: boolean;
}

let cache: MailAccount[] = [];
const listeners = new Set<(accounts: MailAccount[]) => void>();

function notify() {
  for (const l of listeners) l(cache);
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SIDECAR_BASE}${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = j.detail || j.error || detail; } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function refreshAccounts(): Promise<MailAccount[]> {
  const data = await http<{ accounts: MailAccount[] }>('/mail/accounts');
  cache = data.accounts || [];
  notify();
  return cache;
}

export function listAccounts(): MailAccount[] {
  return cache;
}

export function subscribe(listener: (accounts: MailAccount[]) => void): () => void {
  listeners.add(listener);
  listener(cache);
  return () => listeners.delete(listener);
}

export interface AddAccountInput {
  email: string;
  label?: string;
  config: MailServerConfig;
  password: string;
  indexInKb?: boolean;
}

export async function addAccount(input: AddAccountInput): Promise<MailAccount> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Adresse e-mail invalide');
  const payload = {
    email,
    label: input.label?.trim() || input.config.displayName || email,
    imap: input.config.imap,
    smtp: input.config.smtp,
    authType: 'password',
    indexInKb: input.indexInKb ?? false,
    password: input.password,
  };
  const data = await http<{ account: MailAccount }>('/mail/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await refreshAccounts();
  return data.account;
}

export async function updateAccount(account: MailAccount, password?: string): Promise<MailAccount> {
  const payload = {
    id: account.id,
    email: account.email,
    label: account.label,
    imap: account.imap,
    smtp: account.smtp,
    authType: account.authType,
    indexInKb: account.indexInKb,
    password,
  };
  const data = await http<{ account: MailAccount }>('/mail/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await refreshAccounts();
  return data.account;
}

export async function removeAccount(id: string): Promise<void> {
  await http(`/mail/accounts/${id}`, { method: 'DELETE' });
  await refreshAccounts();
}

export async function setPassword(account: MailAccount, password: string): Promise<void> {
  await updateAccount(account, password);
}

export async function testAccountConnection(
  imap: ServerConfig, email: string, password: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!password) return { ok: false, error: 'Mot de passe requis' };
  if (!imap.host || !imap.port) return { ok: false, error: 'IMAP host/port manquant' };
  try {
    const data = await http<{ ok: boolean; error?: string }>('/mail/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imap, email, password }),
    });
    return data;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function syncAccount(id: string, maxMessages = 200): Promise<{ ok: boolean; fetched: number; inserted: number; indexed: number }> {
  const data = await http<{ ok: boolean; fetched: number; inserted: number; indexed: number }>(
    `/mail/sync/${id}?max_messages=${maxMessages}`,
    { method: 'POST' },
  );
  await refreshAccounts();
  return data;
}

export function getAccount(id: string): MailAccount | null {
  return cache.find(a => a.id === id) || null;
}

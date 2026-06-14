// Friend-graph P2P presence client (Spec A, 2026-05-22).
//
// The legacy "matchmaking" concept is gone — the server no longer routes jobs,
// no longer settles payments. It just hosts a presence directory filtered by
// mutual friendship + opt-in ProviderAcl. We keep the file name and exported
// function names so existing callers (panels, settings, p2p transport) don't
// have to change.
//
// listProviders(modelId)  -> mutual+opted-in friends serving modelId
// listMyDevices(modelId?) -> the caller's own devices (other installs of
//                            same account), excluding this one via X-Device-Id
// announceProvider(...)   -> POST /api/presence/announce
// withdrawProvider(...)   -> DELETE /api/presence/withdraw

import type { ProviderHandle } from './types';
import { getDeviceId } from './device-id';

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return {
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface RouteResult {
  jobId: string | null;
  providers: ProviderHandle[];
}

interface PresenceRow {
  userId: string;
  deviceId?: string;
  modelId: string;
  networkAddr: string;
  noisePubkey: string;
  modelDigest: string | null;
  weightDigest: string | null;
  attested?: boolean;
  lastSeenAt: string;
}

function toProvider(r: PresenceRow, attestedDefault: boolean): ProviderHandle {
  return {
    id: `${r.userId}:${r.deviceId ?? 'legacy'}:${r.modelId}`,
    userId: r.userId,
    endpoint: r.networkAddr,
    publicKey: r.noisePubkey,
    attested: r.attested ?? attestedDefault,
    lastSeenAt: r.lastSeenAt,
  };
}

export async function listProviders(modelId: string): Promise<RouteResult> {
  const qs = new URLSearchParams({ modelId });
  const res = await fetch(`${backendUrl}/api/presence/friends?${qs.toString()}`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`presence/friends failed: ${res.status}`);
  const rows: PresenceRow[] = await res.json();
  return { jobId: null, providers: rows.map(r => toProvider(r, true)) };
}

// Same user's other devices. Server uses the X-Device-Id header to exclude
// the calling install so we don't try to ping ourselves.
export async function listMyDevices(modelId?: string): Promise<RouteResult> {
  const qs = new URLSearchParams();
  if (modelId) qs.set('modelId', modelId);
  const url = `${backendUrl}/api/presence/mine${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`presence/mine failed: ${res.status}`);
  const rows: PresenceRow[] = await res.json();
  return { jobId: null, providers: rows.map(r => toProvider(r, false)) };
}

export async function announceProvider(input: {
  modelId: string;
  endpoint: string;
  publicKey: string;
  modelDigest?: string;
  weightDigest?: string;
  task?: string;
}) {
  const res = await fetch(`${backendUrl}/api/presence/announce`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
    body: JSON.stringify({
      deviceId: getDeviceId(),
      modelId: input.modelId,
      networkAddr: input.endpoint,
      noisePubkey: input.publicKey,
      modelDigest: input.modelDigest,
      weightDigest: input.weightDigest,
      task: input.task,
    }),
  });
  if (!res.ok) throw new Error(`presence/announce failed: ${res.status}`);
  return res.json();
}

export async function withdrawProvider(modelId?: string) {
  const qs = new URLSearchParams({ deviceId: getDeviceId() });
  if (modelId) qs.set('modelId', modelId);
  const url = `${backendUrl}/api/presence/withdraw?${qs.toString()}`;
  await fetch(url, { method: 'DELETE', credentials: 'include', headers: authHeaders() });
}

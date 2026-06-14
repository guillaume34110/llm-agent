// Custom OpenAI-compatible endpoints (Ollama, LM Studio, A1111, ComfyUI…).
// Local-first AND local-only: URLs must point to localhost / private LAN.
// Public cloud providers are forbidden here — the product is P2P + local only,
// no commercial cloud LLM proxy (CLAUDE.md pivot 2026-05-18).

// Allow: localhost, 127.0.0.0/8, ::1, *.local, and RFC1918 private ranges.
const PRIVATE_HOST_RE = /^(localhost|127(?:\.\d+){3}|::1|0\.0\.0\.0|\[::1\]|[^.]+\.local|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d+){2})$/i;

function assertLocalUrl(url: string): void {
  let host: string;
  try {
    const u = new URL(url);
    host = u.hostname;
  } catch {
    throw new Error('URL invalide');
  }
  if (!PRIVATE_HOST_RE.test(host)) {
    throw new Error(`Hôte non local: ${host}. Seuls localhost / LAN privé acceptés (pas de provider cloud).`);
  }
}

const SIDECAR_BASE = (import.meta as any).env?.VITE_SIDECAR_URL || 'http://localhost:3471';
const STORAGE_KEY = 'monkey.customEndpoints.v1';

export interface CustomModel {
  id: string;
  name?: string;
  supportsVision?: boolean;
  supportsAudioInput?: boolean;
}

export interface CustomEndpoint {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  models: CustomModel[];
  kind?: 'chat' | 'image' | 'music' | 'video'; // default 'chat' for backward compat
  protocol?: string; // e.g. 'openai' (default), 'a1111', 'comfyui', 'ollama'
}

function loadAll(): CustomEndpoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    // Ensure kind defaults to 'chat' for backward compat
    const endpoints = Array.isArray(data) ? data : [];
    return endpoints.map(ep => ({ ...ep, kind: ep.kind || 'chat' as const }));
  } catch {
    return [];
  }
}

function saveAll(endpoints: CustomEndpoint[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
}

export function listEndpoints(): CustomEndpoint[] {
  return loadAll();
}

function makeId(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const base = slug || 'endpoint';
  const existing = new Set(loadAll().map(e => e.id));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export async function addEndpoint(input: { label: string; baseUrl: string; apiKey?: string; kind?: 'chat' | 'image' | 'music' | 'video'; protocol?: string }): Promise<CustomEndpoint> {
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  assertLocalUrl(baseUrl);
  const ep: CustomEndpoint = {
    id: makeId(input.label),
    label: input.label.trim() || 'Custom',
    baseUrl,
    apiKey: input.apiKey?.trim() || undefined,
    models: [],
    kind: input.kind || 'chat',
    protocol: input.protocol,
  };
  const all = [...loadAll(), ep];
  saveAll(all);
  await syncToSidecar();
  return ep;
}

export async function updateEndpoint(id: string, patch: Partial<Omit<CustomEndpoint, 'id'>>): Promise<void> {
  if (patch.baseUrl) assertLocalUrl(patch.baseUrl.replace(/\/+$/, ''));
  const all = loadAll().map(e => (e.id === id ? { ...e, ...patch, baseUrl: (patch.baseUrl ?? e.baseUrl).replace(/\/+$/, '') } : e));
  saveAll(all);
  await syncToSidecar();
}

export async function deleteEndpoint(id: string): Promise<void> {
  saveAll(loadAll().filter(e => e.id !== id));
  await syncToSidecar();
}

// Discovery: hit /v1/models on the endpoint. Updates the stored model list.
// Only supported for chat endpoints.
export async function discoverModels(id: string): Promise<CustomModel[]> {
  const ep = loadAll().find(e => e.id === id);
  if (!ep) throw new Error(`Endpoint ${id} not found`);
  if (ep.kind !== 'chat') throw new Error('Discovery only supported for chat endpoints');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ep.apiKey) headers.Authorization = `Bearer ${ep.apiKey}`;
  const res = await fetch(`${ep.baseUrl}/v1/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} on /v1/models`);
  const body = await res.json();
  const raw = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const models: CustomModel[] = raw
    .map((m: any) => ({ id: m.id || m.name, name: m.name || m.id }))
    .filter((m: any) => !!m.id);
  await updateEndpoint(id, { models });
  return models;
}

// Push the full set (sans secrets stripping — sidecar needs the API key to
// forward calls; it stays on the loopback interface only).
export async function syncToSidecar(): Promise<void> {
  const all = loadAll();
  const payload = {
    endpoints: all.map(e => ({
      id: e.id,
      label: e.label,
      base_url: e.baseUrl,
      api_key: e.apiKey || '',
      models: e.models,
      kind: e.kind || 'chat',
      protocol: e.protocol,
    })),
  };
  try {
    await fetch(`${SIDECAR_BASE}/custom-endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // sidecar may not be up yet — retried on next save / boot
  }
}

export function listEndpointsByKind(kind: CustomEndpoint['kind']): CustomEndpoint[] {
  return loadAll().filter(e => (e.kind || 'chat') === kind);
}

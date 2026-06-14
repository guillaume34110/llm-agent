// Local on-device models — desktop client.
// Talks to the Python sidecar (/local-models/*) which owns the runtime,
// catalogue, and download lifecycle. UI shown in Settings > Modèles locaux.

const SIDECAR_BASE = (import.meta as any).env?.VITE_SIDECAR_URL || 'http://localhost:3471';

export interface LocalModel {
  id: string;
  task: string;
  label: string;
  description: string;
  repo: string;
  size_mb: number;
  runtime: 'onnx' | 'ct2' | 'system' | 'sdcpp' | 'torch';
  tool_name: string;
  tool_desc: string;
  license: string;
  languages: string[];
  installed: boolean;
  meta?: { installed_at?: number; size_bytes?: number } | null;
}

export interface DownloadEvent {
  event: 'start' | 'progress' | 'done' | 'error' | 'skipped';
  bytes?: number;
  total?: number;
  percent?: number;
  message?: string;
}

export async function listLocalModels(): Promise<LocalModel[]> {
  const res = await fetch(`${SIDECAR_BASE}/local-models`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.models) ? data.models : [];
}

export async function uninstallLocalModel(id: string): Promise<boolean> {
  const res = await fetch(`${SIDECAR_BASE}/local-models/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return res.ok;
}

export async function loadLocalModel(id: string): Promise<boolean> {
  const res = await fetch(`${SIDECAR_BASE}/local-models/${encodeURIComponent(id)}/load`, { method: 'POST' });
  return res.ok;
}

export async function unloadLocalModel(id: string): Promise<boolean> {
  const res = await fetch(`${SIDECAR_BASE}/local-models/${encodeURIComponent(id)}/unload`, { method: 'POST' });
  return res.ok;
}

export interface LocalModelStatus {
  installed: boolean;
  loaded: boolean;
  download: { status?: string; percent?: number; bytes?: number; total?: number; error?: string };
}

export async function getLocalModelStatus(id: string): Promise<LocalModelStatus | null> {
  try {
    const res = await fetch(`${SIDECAR_BASE}/local-models/${encodeURIComponent(id)}/status`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface Convert3DResult {
  output_path: string;
  format: string;
  bytes: number;
  gaussians?: number | null;
}

// Convert a 2D image (base64, no data-URL prefix) into a 3D .ply via TripoSplat.
// The sidecar streams SSE heartbeats while converting (a conversion takes
// minutes; WKWebView kills idle fetches at ~60s), then a final done/error event.
export async function convertImageTo3D(
  imageB64: string,
  gaussians?: number,
  onProgress?: (elapsedSec: number) => void,
  name?: string,
): Promise<Convert3DResult> {
  const res = await fetch(`${SIDECAR_BASE}/image-to-3d`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_b64: imageB64, ...(gaussians ? { gaussians } : {}), ...(name ? { name } : {}) }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({} as any));
    throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      let ev: any;
      try {
        ev = JSON.parse(payload);
      } catch {
        continue;
      }
      if (ev.event === 'progress') {
        onProgress?.(ev.elapsed ?? 0);
      } else if (ev.event === 'error') {
        throw new Error(ev.message || 'conversion failed');
      } else if (ev.event === 'done') {
        return ev as Convert3DResult;
      }
    }
  }
  throw new Error('connection closed before conversion finished');
}

export interface Asset3D {
  name: string;
  path: string;
  bytes: number;
  mtime: number;
}

// Generated .ply files from ~/.monkey/3d, newest first.
export async function list3DAssets(): Promise<Asset3D[]> {
  try {
    const res = await fetch(`${SIDECAR_BASE}/3d-assets`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.assets) ? data.assets : [];
  } catch {
    return [];
  }
}

// --- 2D -> 3D conversion store ----------------------------------------------
// Module-level so an in-flight conversion survives tab switches: the panel
// unmounts but the fetch lives here, and remounting re-attaches to live state.
export interface Conversion3DState {
  converting: boolean;
  elapsed: number;
  imageName: string | null;
  preview: string | null;
  imageB64: string | null;
  result: Convert3DResult | null;
  error: string | null;
}

let conv3d: Conversion3DState = {
  converting: false, elapsed: 0, imageName: null, preview: null,
  imageB64: null, result: null, error: null,
};
const conv3dListeners = new Set<() => void>();

function patchConv3d(patch: Partial<Conversion3DState>) {
  conv3d = { ...conv3d, ...patch };
  conv3dListeners.forEach(l => l());
}

export function getConversion3D(): Conversion3DState {
  return conv3d;
}

export function subscribeConversion3D(fn: () => void): () => void {
  conv3dListeners.add(fn);
  return () => conv3dListeners.delete(fn);
}

export function setConversion3DImage(name: string, preview: string, b64: string) {
  patchConv3d({ imageName: name, preview, imageB64: b64, result: null, error: null });
}

export async function startConversion3D(gaussians?: number): Promise<void> {
  if (!conv3d.imageB64 || conv3d.converting) return;
  patchConv3d({ converting: true, elapsed: 0, result: null, error: null });
  try {
    const r = await convertImageTo3D(
      conv3d.imageB64, gaussians,
      s => patchConv3d({ elapsed: s }),
      conv3d.imageName ?? undefined,
    );
    patchConv3d({ result: r, converting: false });
  } catch (e: any) {
    patchConv3d({ error: String(e?.message || e), converting: false });
  }
}

// Streams SSE progress events. Caller passes onEvent + signal for abort.
export async function downloadLocalModel(
  id: string,
  onEvent: (ev: DownloadEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${SIDECAR_BASE}/local-models/${encodeURIComponent(id)}/download`, {
    method: 'POST',
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ event: 'error', message: `HTTP ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        // ignore malformed event
      }
    }
  }
}

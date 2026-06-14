import { convertFileSrc } from '@tauri-apps/api/core';
import { api } from '../api';

let cached: string | null = null;
let pending: Promise<string> | null = null;

export async function getWorkspacePath(): Promise<string> {
  if (cached) return cached;
  if (pending) return pending;
  pending = api.getWorkspace().then(r => {
    cached = r.path.replace(/\/$/, '');
    return cached;
  }).catch(() => {
    cached = '';
    return '';
  }).finally(() => { pending = null; });
  return pending;
}

export function getWorkspacePathSync(): string | null {
  return cached;
}

// Kick off fetch at module load
getWorkspacePath();

/** Resolve a markdown image src to a webview-usable URL.
 *  - http(s)/data/blob/asset URLs pass through
 *  - absolute filesystem path → convertFileSrc
 *  - relative path → resolved against workspace, then convertFileSrc
 */
export function resolveImageSrc(src: string): string {
  if (!src) return src;
  if (/^(https?:|data:|blob:|asset:)/i.test(src)) return src;
  let abs = src;
  if (!src.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(src)) {
    const ws = cached || '';
    if (!ws) return src; // workspace not yet known; will re-render once loaded
    abs = `${ws}/${src.replace(/^\.?\//, '')}`;
  }
  try { return convertFileSrc(abs); } catch { return abs; }
}

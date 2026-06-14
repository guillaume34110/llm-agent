// Single source of truth for the local LLM runtime activation toggle.
//
// CRITICAL INVARIANT — A model download MUST NOT stop when the user
// navigates away from the surface that started it. The Rust task
// (ollama_pull_model or llama_runtime_download_model) runs independently
// of any JS Promise being awaited; if we stash progress in React-local
// state, switching tabs (panel unmount) silently drops the progress and
// the UI looks frozen even though the download is still streaming bytes
// to disk. So progress + busy live at MODULE scope here; every UI surface
// reads via `getLocalProgress()` / `getLocalBusy()` on mount, then keeps
// in sync via `subscribeLocalRuntime`. A freshly mounted component sees
// the latest state immediately. See `local-runtime.test.ts` for the
// regression test.
//
// Two UI surfaces (TopBar power button, ProviderHostingPanel "Activate
// locally" + "Start" buttons, plus the standalone LocalRuntimeToggle)
// all funnel through here so clicking any of them runs the same code
// path and reflects the same state.
import { invoke } from '@tauri-apps/api/core';
import { ensureActiveModel, withDownloadRate, type AutoProgress, type EnsureResult } from './auto-runtime';
import { getLocalModelPick, getRuntimeMode, setRuntimeMode } from '../preferences/runtime-mode';

export type LocalRuntimeMode = 'shared' | 'dedicated';

export interface ActivateOpts {
  preferModelId?: string;
  mode?: LocalRuntimeMode;
}

let _busy = false;
let _progress: AutoProgress | null = null;
let _lastResult: EnsureResult | null = null;
let _inflight: Promise<EnsureResult> | null = null;
const _subs = new Set<() => void>();

function _emit(): void {
  for (const fn of _subs) {
    try { fn(); } catch {}
  }
}

export function getLocalBusy(): boolean { return _busy; }
export function getLocalProgress(): AutoProgress | null { return _progress; }
export function getLocalLastResult(): EnsureResult | null { return _lastResult; }

export function subscribeLocalRuntime(listener: () => void): () => void {
  _subs.add(listener);
  return () => { _subs.delete(listener); };
}

export async function activateLocalRuntime(opts: ActivateOpts = {}): Promise<EnsureResult> {
  // Coalesce concurrent callers (TopBar + panel + LocalRuntimeToggle) to a
  // single in-flight activation so a click on one surface while another is
  // already running shares the same download instead of throwing.
  if (_inflight) return _inflight;
  _busy = true;
  _progress = { phase: 'probing' };
  _emit();
  _inflight = (async () => {
    try {
      const pick = opts.preferModelId || getLocalModelPick() || undefined;
      const emit = withDownloadRate(p => { _progress = p; _emit(); });
      const result = await ensureActiveModel(emit, {
        mode: opts.mode || 'shared',
        preferModelId: pick,
      });
      setRuntimeMode('local');
      _lastResult = result;
      return result;
    } finally {
      _busy = false;
      _progress = null;
      _inflight = null;
      _emit();
    }
  })();
  return _inflight;
}

export async function deactivateLocalRuntime(): Promise<void> {
  if (_busy) throw new Error('local runtime busy');
  _busy = true;
  _progress = null;
  _emit();
  try {
    await invoke('provider_runtime_stop').catch(() => {});
    await invoke('llama_runtime_stop');
    setRuntimeMode('online');
  } finally {
    _busy = false;
    _emit();
  }
}

export async function toggleLocalRuntime(opts: ActivateOpts = {}): Promise<'on' | 'off'> {
  if (getRuntimeMode() === 'local') {
    await deactivateLocalRuntime();
    return 'off';
  }
  await activateLocalRuntime(opts);
  return 'on';
}

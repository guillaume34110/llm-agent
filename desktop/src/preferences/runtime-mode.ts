import { canonicalModelId } from '../models/model-id-alias';

// P2P pivot: two runtime modes for picking the LLM.
//   * online (default) — server-side balancer picks based on real-time supply.
//     UI shows a readonly badge, no picker.
//   * local — user runs Ollama and selects a model manually.
// Mode is a persistent user setting; defaults to online for the P2P-first
// pivot. Switching modes is a settings-screen action.
//
// Subscribers (UI hooks) get notified on every change, both same-tab (via
// the internal dispatcher) and cross-tab (via the `storage` event). This
// replaces the previous setInterval poll patterns scattered in callers.

const KEY = 'app.runtimeMode';
const LOCAL_PICK_KEY = 'app.localModelPick';
const EVENT = 'runtime-mode-changed';

export type RuntimeMode = 'online' | 'local';

export function getRuntimeMode(): RuntimeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'local' ? 'local' : 'online';
  } catch {
    return 'online';
  }
}

export function setRuntimeMode(mode: RuntimeMode) {
  try { localStorage.setItem(KEY, mode); } catch {}
  _emit();
}

export function isOnline(): boolean {
  return getRuntimeMode() === 'online';
}

export function getLocalModelPick(): string {
  try { return canonicalModelId(localStorage.getItem(LOCAL_PICK_KEY) || ''); } catch { return ''; }
}

export function setLocalModelPick(id: string) {
  try { localStorage.setItem(LOCAL_PICK_KEY, canonicalModelId(id)); } catch {}
  _emit();
}

/** What the agent should send as model_id. Online mode = empty (server auto). */
export function getEffectiveModelId(): string {
  return isOnline() ? '' : getLocalModelPick();
}

/**
 * Subscribe to runtime-mode or local-pick changes. Listener is invoked on
 * any mutation, same-tab or cross-tab. Returns an unsubscribe function.
 */
export function subscribeRuntimeMode(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener();
  window.addEventListener(EVENT, handler);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === KEY || e.key === LOCAL_PICK_KEY) listener();
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

function _emit() {
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
}

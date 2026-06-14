const KEY = 'monkey.inbox.dismissed.v1';
const CHANGE_EVENT = 'monkey:inbox-dismissed:change';

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function write(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(s)));
  } catch {}
  try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch {}
}

export function isDismissed(id: string): boolean {
  return read().has(id);
}

export function dismiss(id: string): void {
  const s = read();
  if (s.has(id)) return;
  s.add(id);
  write(s);
}

export function undismiss(id: string): void {
  const s = read();
  if (!s.delete(id)) return;
  write(s);
}

export function clearDismissed(): void {
  try { localStorage.removeItem(KEY); } catch {}
  try { window.dispatchEvent(new Event(CHANGE_EVENT)); } catch {}
}

export function subscribeDismissChange(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

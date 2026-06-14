const KEY = 'input.history';
const MAX_ENTRIES = 100;

export function pushHistory(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const current = getHistory();
  const deduped = current.filter(h => h !== trimmed);
  deduped.unshift(trimmed);
  try { localStorage.setItem(KEY, JSON.stringify(deduped.slice(0, MAX_ENTRIES))); } catch {}
}

export function getHistory(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : [];
  } catch { return []; }
}

export function clearHistory(): void {
  try { localStorage.removeItem(KEY); } catch {}
}

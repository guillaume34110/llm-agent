const KEY = 'input.draft';

export function saveDraft(text: string): void {
  try {
    if (text) { localStorage.setItem(KEY, text); }
    else { localStorage.removeItem(KEY); }
  } catch {}
}

export function loadDraft(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export function clearDraft(): void {
  try { localStorage.removeItem(KEY); } catch {}
}

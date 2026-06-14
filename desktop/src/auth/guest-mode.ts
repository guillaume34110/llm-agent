// Guest mode: the user skips login and uses local-only features (chat with
// local models, memory, games, preferences). Account-backed features (social,
// friend sharing, account export/delete) are gated behind <AuthGate>.
// The flag lives in localStorage so guest mode survives app restarts; it is
// cleared as soon as the user logs in with a real account.

const KEY = 'guest_mode';

export function isGuestMode(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function enterGuestMode(): void {
  try { localStorage.setItem(KEY, '1'); } catch {}
}

export function exitGuestMode(): void {
  try { localStorage.removeItem(KEY); } catch {}
}

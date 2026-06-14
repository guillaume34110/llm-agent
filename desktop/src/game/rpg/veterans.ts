import type { RpgState, VeteranRecord } from './types';

// ── Veterans (heroes kept after a victory; the "vignette de depart" roster) ───
// Stored under their own key, separate from the active save, so summoning a
// veteran into a new run never collides with a run in progress. Capped, newest
// first, deduped by character id.
const HEROES_KEY = 'monkey.rpg.veterans';
export const VET_CAP = 12;

export function loadVeterans(): VeteranRecord[] {
  try {
    const raw = localStorage.getItem(HEROES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(r => r && r.char && typeof r.char.level === 'number') as VeteranRecord[];
  } catch { return []; }
}

// Persist every surviving party member of a cleared run as a summonable veteran.
// Multiple heroes can be kept (the user asked for "plusieurs possible").
export function saveVeterans(state: RpgState): void {
  const survivors = state.party.filter(c => c.alive);
  if (!survivors.length) return;
  const existing = loadVeterans();
  const fresh: VeteranRecord[] = survivors.map(c => ({
    char: { ...c, hp: c.maxHp, alive: true, stats: { ...c.stats } },
    theme: state.theme,
    title: state.title,
    ngPlus: state.ngPlus || 0,
    savedAt: Date.now(),
  }));
  const byId = new Map<string, VeteranRecord>();
  for (const r of [...fresh, ...existing]) if (!byId.has(r.char.id)) byId.set(r.char.id, r);
  const merged = Array.from(byId.values()).slice(0, VET_CAP);
  try { localStorage.setItem(HEROES_KEY, JSON.stringify(merged)); } catch { /* quota */ }
}

export function clearVeterans(): void {
  try { localStorage.removeItem(HEROES_KEY); } catch { /* noop */ }
}

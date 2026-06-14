// Persistent rapport — a people remembers your finest visit.
//
// CE2's Standing is not a one-off: goodwill you earn with a culture in one
// expedition carries into the next time you cross their lands. Monkey Quest's
// per-run reputation (reputation.ts) resets every world; rapport is the meta
// layer above it, keyed by PEOPLE id, kept client-side like veterans/logbook.
//
// The accrual is monotone-max: each return, your best showing with a people
// (the spread between the settlement you helped most and the baseline) sets a
// floor on the standing they grant you next time. Re-applying the same returned
// state yields the same value, so it is idempotent without a run-id guard — no
// raw increment, never double-counts on a remount.
//
// Client-owns-numbers: every value here is computed and clamped in code; no LLM
// string ever sets a standing point.
import { peopleFor } from './peoples';
import type { RpgState } from './types';

const RAPPORT_KEY = 'monkey.rpg.rapport';

// How much per-run settlement goodwill maps to one point of persistent standing,
// and the ceiling a single people's remembered floor can reach. Capped well
// inside the reputation band so rapport tilts a welcome, never dominates it.
export const RAPPORT_STEP = 6;
export const RAPPORT_CAP = 8;

export type Rapport = Record<string, number>;

// Load the remembered standing per people, coerced and clamped. Corrupt or
// absent storage yields an empty ledger (no rapport with anyone yet).
export function loadRapport(): Rapport {
  try {
    const raw = localStorage.getItem(RAPPORT_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return {};
    const out: Rapport = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = Math.max(0, Math.min(RAPPORT_CAP, Math.floor(v)));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function clearRapport(): void {
  try { localStorage.removeItem(RAPPORT_KEY); } catch { /* noop */ }
}

// The standing head-start a people grants thanks to past deeds, clamped to the
// cap. Never negative — rapport only ever warms a welcome.
export function rapportBonus(peopleId: string): number {
  const r = loadRapport();
  return Math.max(0, Math.min(RAPPORT_CAP, r[peopleId] ?? 0));
}

// Goodwill earned with a people THIS run: the spread between the settlement the
// party helped most and the baseline (a settlement that gained nothing stays at
// the starting floor). Self-contained from state, so it counts only what this
// expedition added — never the floor rapport already granted at world-gen.
function earnedThisRun(state: RpgState): number {
  const reps = Object.values(state.nodes || {})
    .map(n => n.reputation)
    .filter((r): r is number => typeof r === 'number');
  if (reps.length === 0) return 0;
  const spread = Math.max(...reps) - Math.min(...reps);
  return Math.max(0, Math.floor(spread / RAPPORT_STEP));
}

// Record a return's goodwill against the world's people. Monotone-max: keeps the
// better of the stored floor and this run's earning, so it is idempotent and
// only ever rises. Returns the updated ledger.
export function recordRapport(state: RpgState): Rapport {
  const r = loadRapport();
  const id = peopleFor(state.seed, state.peopleId).id;
  const gained = Math.min(RAPPORT_CAP, earnedThisRun(state));
  const next = Math.max(r[id] ?? 0, gained);
  if (next !== (r[id] ?? 0)) {
    r[id] = next;
    try { localStorage.setItem(RAPPORT_KEY, JSON.stringify(r)); } catch { /* quota */ }
  }
  return r;
}

import type { RpgState } from './types';

// ── Morale (party resolve, 0..100; client-owned) ─────────────────────────────
// The expedition's collective will. Drains on hard travel and losses, recovers
// at rest and in safe towns. Low morale tilts the road toward danger and risks a
// companion deserting (they leave — never die — to keep the tone grand-public).
export const MORALE_MAX = 100;
export function clampMorale(n: number): number {
  return Math.max(0, Math.min(MORALE_MAX, Math.round(n)));
}
// Mutate party morale in place; returns the signed delta actually applied (after
// clamping). All callers pre-scale drains by diffOf(state).morale themselves.
export function adjustMorale(state: RpgState, delta: number): number {
  const before = state.morale;
  state.morale = clampMorale(state.morale + delta);
  return state.morale - before;
}
// Coarse band for HUD colour + the road-danger tilt. high≥70, steady≥40, low≥20.
export type MoraleBand = 'high' | 'steady' | 'low' | 'breaking';
export function moraleBand(m: number): MoraleBand {
  if (m >= 70) return 'high';
  if (m >= 40) return 'steady';
  if (m >= 20) return 'low';
  return 'breaking';
}

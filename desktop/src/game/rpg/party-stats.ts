import type { RpgState, StatKey } from './types';

// ── Party combat stats (client-owned aggregates over the living roster) ───────
// All four feed combat math; the LLM never sees them, it only narrates outcomes.

// Best party value for a stat (the most capable member acts).
export function partyBest(state: RpgState, key: StatKey): number {
  return Math.max(0, ...state.party.filter(c => c.alive).map(c => c.stats[key]));
}

export function partyPower(state: RpgState): number {
  return state.party
    .filter(c => c.alive)
    .reduce((sum, c) => sum + c.stats.might + c.stats.agility + Math.floor(c.level), 0);
}

// Estimated damage the party deals in one full attack volley: hit chance ×
// (offensive stat + average d6 + a slice of crit), summed over living members.
// Every foe's bulk is scaled against this so a fight never collapses into a
// one-shot as the party grows — a stronger band simply meets sturdier foes.
// Client-owned; the LLM never sees these numbers.
export function partyDamagePerRound(state: RpgState): number {
  const dpr = state.party
    .filter(c => c.alive)
    .reduce((sum, c) => sum + 0.9 * (Math.max(c.stats.might, c.stats.agility) + 4.2), 0);
  return Math.max(6, dpr);   // a lone, wounded survivor still faces a real fight
}

// Mean level of the living party — drives how hard foes hit (so a veteran band
// meets foes that can actually threaten it, not level-1 chip damage).
export function partyAvgLevel(state: RpgState): number {
  const live = state.party.filter(c => c.alive);
  if (!live.length) return 1;
  return live.reduce((s, c) => s + c.level, 0) / live.length;
}

import type { RpgState } from './types';
import { statProfile } from './character';

// ── Team synergy (composition matters — CE2 party chemistry) ──────────────────
// A balanced, varied band fights as more than the sum of its parts. Synergy is a
// small flat edge (0..4) earned from: covering distinct disciplines (the four
// stat focuses), a variety of traits pulling together, and a full fellowship. It
// adds to combat damage WITHOUT inflating the foe-HP scaling (that keys off raw
// stats only — see partyDamagePerRound), so a synergised party is genuinely
// stronger, not merely met by sturdier foes. Client-owned; the LLM authors none.
export interface SynergyReadout { bonus: number; parts: string[]; }
export function teamSynergy(state: RpgState): SynergyReadout {
  const live = state.party.filter(c => c.alive);
  const parts: string[] = [];
  if (live.length === 0) return { bonus: 0, parts };
  let bonus = 0;
  const focuses = new Set(live.map(c => statProfile(c.className).key));
  if (focuses.size >= 2) { bonus += 1; parts.push(`${focuses.size} disciplines in concert (+1)`); }
  if (focuses.size >= 3) { bonus += 1; parts.push('a well-rounded band (+1)'); }
  const traits = new Set(live.filter(c => c.trait).map(c => c.trait!.id));
  if (traits.size >= 3) { bonus += 1; parts.push('varied talents (+1)'); }
  if (live.length >= 4) { bonus += 1; parts.push('a full fellowship (+1)'); }
  return { bonus: Math.min(4, bonus), parts };
}

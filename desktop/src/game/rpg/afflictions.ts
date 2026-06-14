import type { RpgState, Character, AfflictionId, Affliction } from './types';
import { hasTrinket, CHARM_AFFLICT_MUL, recoverChance } from './trinkets';

// ── Afflictions (sanity escalation; client-owned) ────────────────────────────
// A low-morale road frays the mind. Each affliction is INDIVIDUAL (one per member)
// and TEMPORARY: it bites one existing mechanic and lifts on recovery (rest, or a
// stretch of high morale). Effects stay small so a single bad patch never spirals
// past saving — the point is tension, not a death-spiral. The LLM never authors one.
export const AFFLICTIONS: Record<AfflictionId, Affliction> = {
  haunted:  { id: 'haunted',  label: 'Haunted',  blurb: 'Sleepless and jumpy — falters at scene checks (−1 to their die).' },
  mutinous: { id: 'mutinous', label: 'Mutinous', blurb: 'Resentful and distracted — fights worse (−1) and likelier to desert.' },
  feverish: { id: 'feverish', label: 'Feverish', blurb: 'Run-down and ailing — suffers extra harm from hazards and hunger.' },
  ravenous: { id: 'ravenous', label: 'Ravenous', blurb: 'Hollow-bellied and gnawing — eats an extra ration on every march.' },
  cursed:   { id: 'cursed',   label: 'Cursed',   blurb: 'Dogged by ill luck — roadside finds turn up thinner while they march.' },
};
export const AFFLICTION_IDS: AfflictionId[] = ['haunted', 'mutinous', 'feverish', 'ravenous', 'cursed'];
// Morale at/under which the mind starts to crack (the `low` band and below).
export const AFFLICT_MORALE = 40;
// Morale at/over which spirits are high enough to shake an affliction off.
export const RECOVER_MORALE = 70;
// Extra HP a feverish member loses to a hazard or to hunger.
export const FEVERISH_EXTRA = 2;
// Extra rations a single ravenous member eats on each travel leg.
export const RAVENOUS_RATION_EXTRA = 1;
// How much a roadside boon's gold shrinks while anyone in the band is cursed.
export const CURSED_BOON_MUL = 0.5;

// A member is afflicted with this id right now (and still alive).
export function hasAffliction(c: Character, id: AfflictionId): boolean {
  return c.alive && c.affliction === id;
}

// Total extra rations the march burns this leg for every ravenous member aboard
// (economic pressure, never harm — a hungry mouth eats more, that's all).
export function ravenousRationExtra(state: RpgState): number {
  return state.party.reduce((n, c) => n + (hasAffliction(c, 'ravenous') ? RAVENOUS_RATION_EXTRA : 0), 0);
}

// The luck-tax on roadside finds: cut while any living member is cursed, else full.
export function cursedBoonMul(state: RpgState): number {
  return state.party.some(c => hasAffliction(c, 'cursed')) ? CURSED_BOON_MUL : 1;
}

// At low morale, the road may inflict a fresh affliction on a clean member. Chance
// scales as morale sinks (0 at the threshold, up to ~0.5 when broken). One catch per
// call. Returns a thematic log line, or null. Mutates `state` in place.
export function maybeAfflict(state: RpgState, rng: () => number): string | null {
  if (state.morale >= AFFLICT_MORALE) return null;
  const clean = state.party.filter(c => c.alive && !c.affliction);
  if (clean.length === 0) return null;
  // A warding charm steadies the party — it cracks half as readily.
  const ward = hasTrinket(state, 'charm') ? CHARM_AFFLICT_MUL : 1;
  const chance = Math.min(0.5, (AFFLICT_MORALE - state.morale) / 60) * ward;
  if (rng() >= chance) return null;
  const who = clean[Math.floor(rng() * clean.length)];
  const id = AFFLICTION_IDS[Math.floor(rng() * AFFLICTION_IDS.length)];
  who.affliction = id;
  return `The strain tells: ${who.name} turns ${AFFLICTIONS[id].label.toLowerCase()}.`;
}

// When spirits are high again, an afflicted member may shake it off (one per call).
// Returns a thematic log line, or null. Mutates `state` in place.
export function maybeRecover(state: RpgState, rng: () => number): string | null {
  if (state.morale < RECOVER_MORALE) return null;
  const sick = state.party.filter(c => c.alive && c.affliction);
  if (sick.length === 0) return null;
  // A soothing tonic mends troubled minds faster (higher recover chance).
  if (rng() >= recoverChance(state)) return null;
  const who = sick[Math.floor(rng() * sick.length)];
  who.affliction = undefined;
  return `Spirits lift: ${who.name} shakes off the gloom.`;
}

// Run both sides of the sanity cycle after morale has settled for a turn: a fresh
// catch if morale is low, a recovery if it is high. Returns any log lines.
export function tickAfflictions(state: RpgState, rng: () => number): string[] {
  const lines: string[] = [];
  const caught = maybeAfflict(state, rng);
  if (caught) lines.push(caught);
  const healed = maybeRecover(state, rng);
  if (healed) lines.push(healed);
  return lines;
}

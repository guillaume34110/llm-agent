import type { RpgState, TraitId, CompanionTrait, Character } from './types';

// ── Companion traits (client-owned quirks; presence-based party perks) ────────
// One trait per member, assigned at generation from the seeded RNG. Five perks are
// PARTY-LEVEL: if any living member carries them the bonus applies (gated by
// partyHasTrait), so recruiting/losing companions visibly shifts the run. `tough`
// is the one individual perk — its bonus HP is baked into maxHp at birth. Every
// effect is a single client-owned number wired into existing mechanics; the LLM
// never authors one. Keep effects mild so no single trait dominates a run.
export const TRAITS: Record<TraitId, CompanionTrait> = {
  forager:    { id: 'forager',    label: 'Forager',    blurb: 'Lives off the land — the party eats one less ration each leg.' },
  stalwart:   { id: 'stalwart',   label: 'Stalwart',   blurb: 'Steady under strain — the road wears the party down more slowly.' },
  lucky:      { id: 'lucky',      label: 'Lucky',      blurb: 'Fortune favours them — roadside finds yield more gold.' },
  cheerful:   { id: 'cheerful',   label: 'Cheerful',   blurb: 'Good company — resting lifts the party’s spirits further.' },
  tough:      { id: 'tough',      label: 'Tough',      blurb: 'Hardy build — carries extra health into every fight.' },
  pathfinder: { id: 'pathfinder', label: 'Pathfinder', blurb: 'Reads the land — the party is ambushed on the road less often.' },
  haggler:    { id: 'haggler',    label: 'Haggler',    blurb: 'Drives a hard bargain — rations cost the party less to restock.' },
  brave:      { id: 'brave',      label: 'Brave',      blurb: 'Fights without flinching — strikes a touch harder in battle (+1).' },
};
export const TRAIT_IDS: TraitId[] = ['forager', 'stalwart', 'lucky', 'cheerful', 'tough', 'pathfinder', 'haggler', 'brave'];
export const TOUGH_HP = 6; // extra max-HP baked in for a `tough` member at generation
// A haggler shaves the restock price (×0.8); a brave fighter swings +1 in combat.
export const HAGGLER_PRICE_MUL = 0.8;
export const BRAVE_OFFENSE = 1;

// Does any LIVING member carry this trait? Gates every party-level perk so the
// bonus tracks the current roster (a deserter/death can switch it off).
export function partyHasTrait(state: RpgState, id: TraitId): boolean {
  return state.party.some(c => c.alive && c.trait?.id === id);
}

// The combat offence bonus a single member earns from being brave (individual, like
// `tough` — only the brave fighter swings harder, so it never dominates the band).
export function braveOffenseBonus(c: Character): number {
  return c.alive && c.trait?.id === 'brave' ? BRAVE_OFFENSE : 0;
}

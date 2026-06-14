import type { RpgState, TrinketId, Trinket, Item } from './types';
import { uid } from './ids';

// ── Trinkets (curios claimed at map discoveries) ─────────────────────────────
// Permanent, presence-based party boons carried in the satchel. Each hooks ONE
// mechanic (see the effect helpers below + their consumers). The catalog is the
// source of truth for name + blurb; the LLM authors none of it. Effects stay
// small — a trinket sweetens a knob, it never trivialises a system. Ten distinct
// curios so a world's scattered landmarks each yield something different.
export const TRINKETS: Record<TrinketId, Trinket> = {
  idol:     { id: 'idol',     name: 'Idol of Fortune',      blurb: 'A lucky idol — lends one extra die to every scene check.' },
  charm:    { id: 'charm',    name: 'Warding Charm',        blurb: 'A steadying charm — the party cracks half as readily under strain.' },
  talisman: { id: 'talisman', name: "Wayfarer's Talisman",  blurb: 'A traveller’s talisman — softens hazards and hunger by 1 HP each.' },
  compass:  { id: 'compass',  name: "Pathfinder's Compass", blurb: 'A true compass — pushing a dice pool again costs less resolve.' },
  lantern:  { id: 'lantern',  name: 'Pathlight Lantern',    blurb: 'A steady lantern — every march wears a little less on the spirits.' },
  snare:    { id: 'snare',    name: "Forager's Snare",      blurb: 'A clever snare — the band lives lighter off the land (one less ration per leg).' },
  banner:   { id: 'banner',   name: 'Rally Banner',         blurb: 'A proud banner — making camp lifts spirits higher.' },
  lodestar: { id: 'lodestar', name: 'Lucky Lodestar',       blurb: 'A fortunate stone — roadside finds pay out richer.' },
  aegis:    { id: 'aegis',    name: 'Bulwark Charm',        blurb: 'A warding bulwark — soaks the worst off every blow the party takes.' },
  tonic:    { id: 'tonic',    name: 'Soothing Tonic',       blurb: 'A soothing draught — troubled minds mend faster.' },
};
export const TRINKET_IDS: TrinketId[] = [
  'idol', 'charm', 'talisman', 'compass', 'lantern', 'snare', 'banner', 'lodestar', 'aegis', 'tonic',
];

// Tuning constants (all client-owned). Each is the size of one trinket's nudge.
export const CHARM_AFFLICT_MUL = 0.5;     // charm: ×chance the party catches an affliction
export const TALISMAN_WARD = 1;           // talisman: HP shaved off each hazard/hunger bite
export const COMPASS_REROLL_CUT = 3;      // compass: morale shaved off each dice-pool push
export const LANTERN_DRAIN_MUL = 0.85;    // lantern: ×the morale a travel leg drains
export const SNARE_RATION_CUT = 1;        // snare: rations shaved off each leg's appetite
export const BANNER_CAMP_MORALE = 10;     // banner: extra morale gained when making camp
export const LODESTAR_GOLD_MUL = 1.5;     // lodestar: ×gold from a roadside boon
export const AEGIS_WARD = 2;              // aegis: HP shaved off each blow the party takes
export const TONIC_RECOVER_CHANCE = 0.75; // tonic: chance an afflicted member shakes it off
export const BASE_RECOVER_CHANCE = 0.5;   // …versus this with no tonic

// The party holds this trinket right now (any copy in the satchel counts).
export function hasTrinket(state: RpgState, id: TrinketId): boolean {
  return (state.inventory || []).some(i => i.kind === 'trinket' && i.trinket === id);
}

// Mint the satchel item for a trinket id (a permanent curio, not a consumable).
export function makeTrinket(id: TrinketId): Item {
  const t = TRINKETS[id];
  return { id: uid('item'), kind: 'trinket', name: t.name, desc: t.blurb, trinket: id };
}

// ── Effect helpers ───────────────────────────────────────────────────────────
// Each maps the carried trinket to its numeric tweak, so the consumer stays a
// one-liner and the effect is unit-tested here (pure). No carry → identity value.
export const lanternDrainMul = (s: RpgState) => (hasTrinket(s, 'lantern') ? LANTERN_DRAIN_MUL : 1);
export const snareRationCut = (s: RpgState) => (hasTrinket(s, 'snare') ? SNARE_RATION_CUT : 0);
export const bannerCampMorale = (s: RpgState) => (hasTrinket(s, 'banner') ? BANNER_CAMP_MORALE : 0);
export const lodestarGoldMul = (s: RpgState) => (hasTrinket(s, 'lodestar') ? LODESTAR_GOLD_MUL : 1);
export const aegisWard = (s: RpgState) => (hasTrinket(s, 'aegis') ? AEGIS_WARD : 0);
export const compassRerollCut = (s: RpgState) => (hasTrinket(s, 'compass') ? COMPASS_REROLL_CUT : 0);
export const recoverChance = (s: RpgState) => (hasTrinket(s, 'tonic') ? TONIC_RECOVER_CHANCE : BASE_RECOVER_CHANCE);

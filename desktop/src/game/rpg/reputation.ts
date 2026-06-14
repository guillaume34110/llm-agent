import type { RpgState, MapNode, Character } from './types';
import { PROV_COST } from './provisions';
import { recruitCost } from './character';

// ── Settlement reputation (client-owned) ─────────────────────────────────────
// Towns and villages remember the party. Clearing nearby danger and trading there
// earn standing; a welcomed party pays less for food and hires, and rests easier.
// Every number is computed/clamped client-side — the LLM authors none of it.
export const REP_MIN = -20;
export const REP_MAX = 40;
export const REP_CLEAR = 6;    // earned by every settlement bordering a danger site you clear
export const REP_PATRON = 1;   // earned per ration purchase
export const REP_HIRE = 3;     // earned per paid hire

export function settlementRep(node: MapNode): number { return node.reputation ?? 0; }
// Up to 30% off at +30 standing; never a surcharge (floors at 0 below neutral).
export function repDiscount(node: MapNode): number {
  return Math.max(0, Math.min(0.3, settlementRep(node) / 100));
}
export type RepTier = 'reviled' | 'stranger' | 'known' | 'welcomed' | 'honored';
export function repTier(rep: number): RepTier {
  if (rep <= -8) return 'reviled';
  if (rep < 8) return 'stranger';
  if (rep < 20) return 'known';
  if (rep < 32) return 'welcomed';
  return 'honored';
}
// Player-favorable rounding: RPG gold is a client-owned game token (not the billing
// system, which charges in ceil'd cents), so a discount always rounds the price down.
export function provPriceAt(node: MapNode): number {
  return Math.max(1, Math.floor(PROV_COST * (1 - repDiscount(node))));
}
export function recruitPriceAt(node: MapNode, ally: Character, partySize: number): number {
  return Math.max(1, Math.floor(recruitCost(ally, partySize) * (1 - repDiscount(node))));
}
// Bump a settlement's standing (no-op on non-settlements), clamped to the band.
export function addRep(node: MapNode | undefined, delta: number): void {
  if (!node || (node.kind !== 'town' && node.kind !== 'village')) return;
  node.reputation = Math.max(REP_MIN, Math.min(REP_MAX, settlementRep(node) + delta));
}
// Clearing a danger site endears the party to every settlement that borders it.
// Returns the names of the settlements that gained standing (for the outcome text).
export function creditRegionForClear(state: RpgState, nodeId: string): string[] {
  const n = state.nodes[nodeId];
  if (!n || n.kind === 'town' || n.kind === 'village') return []; // settlements aren't the danger
  const thanked: string[] = [];
  for (const nb of n.edges) {
    const s = state.nodes[nb];
    if (s && (s.kind === 'town' || s.kind === 'village')) { addRep(s, REP_CLEAR); thanked.push(s.name); }
  }
  return thanked;
}
// "Townsfolk of X are grateful." — only when a cleared site borders settlements.
export function gratitudeLine(names: string[]): string {
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0]
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return ` Word spreads — the folk of ${list} are grateful (+goodwill).`;
}

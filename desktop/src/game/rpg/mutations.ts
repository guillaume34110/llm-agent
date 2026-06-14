import type { RpgState, MapNode, DilemmaDelta } from './types';
import { adjustMorale } from './morale';
import { diffOf } from './difficulty';
import { xpForLevel } from './progression';
import { statProfile, STAT_KEYS } from './character';
import { makeTrinket, aegisWard } from './trinkets';

// ── Shared run-state mutators ────────────────────────────────────────────────
// The low-level state edits every reducer leans on (combat, dilemmas, dice-pool,
// mechanics, travel). Kept in one leaf — they depend only on already-extracted
// helpers, never back on the reducers — so any engine slice can import them
// without a cycle. All numbers are client-owned and clamped here.

// Claim a node's hidden discovery into the satchel (idempotent — once only).
export function claimDiscovery(state: RpgState, node: MapNode): void {
  const d = node.discovery;
  if (!d || d.claimed) return;
  d.claimed = true;
  state.inventory.push(makeTrinket(d.trinket));
  state.log.push(`Discovery — ${d.blurb} Claimed for the satchel.`);
}

// Spread damage onto the front-most living members; downs anyone who hits 0.
// Returns a human summary of who took what. Mutates the party in place.
export function damageParty(state: RpgState, amount: number): string {
  // A Bulwark Charm soaks the worst off each blow (floored at 0 — never heals).
  let left = Math.max(0, amount - aegisWard(state));
  const hit: string[] = [];
  for (const c of state.party) {
    if (left <= 0) break;
    if (!c.alive) continue;
    const dealt = Math.min(c.hp, left);
    c.hp -= dealt;
    left -= dealt;
    if (c.hp <= 0) { c.alive = false; hit.push(`${c.name} falls`); }
    else hit.push(`${c.name} takes ${dealt}`);
  }
  return hit.join(', ');
}

// Award XP to the living party (scaled by difficulty), levelling anyone who
// crosses the threshold. Returns a "; "-joined level-up note, or ''.
export function grantXp(state: RpgState, amount: number): string {
  const amt = Math.max(1, Math.ceil(amount * diffOf(state).xp));
  const gains: string[] = [];
  for (const c of state.party) {
    if (!c.alive) continue;
    c.xp += amt;
    while (c.xp >= xpForLevel(c.level)) {
      c.xp -= xpForLevel(c.level);
      c.level += 1;
      // Since foe HP scales to the party's offence, a level's chief reward is
      // survivability (a fatter HP pool) — that's what stops one-shots from
      // becoming "one-shot or be one-shot". Primary stat still creeps up so big
      // hits and skill checks improve, but the durability is the load-bearing gain.
      c.maxHp += 7;
      const k = statProfile(c.className).key;
      c.stats[k] += 1;
      // A secondary stat nudges up every other level (rounded martials/casters).
      if (c.level % 2 === 0) {
        const sec = STAT_KEYS.filter(s => s !== k).sort((a, b) => c.stats[a] - c.stats[b])[0];
        c.stats[sec] += 1;
      }
      c.hp = c.maxHp;     // a level-up is a second wind: fully restored
      gains.push(`${c.name} reaches level ${c.level}`);
    }
  }
  return gains.length ? ` ${gains.join('; ')}.` : '';
}

// Apply a dilemma's bundled reward/penalty (gold/hp/morale/xp), each clamped.
// Returns a "[...]" bracket summary, or '' when nothing changed.
export function applyDilemmaDelta(state: RpgState, delta: DilemmaDelta): string {
  const bits: string[] = [];
  if (delta.gold) {
    if (delta.gold < 0) { const paid = Math.min(state.gold, -delta.gold); state.gold -= paid; if (paid) bits.push(`-${paid} gold`); }
    else { state.gold += delta.gold; bits.push(`+${delta.gold} gold`); }
  }
  if (delta.hp) {
    if (delta.hp < 0) { const dmg = -delta.hp; for (const c of state.party) if (c.alive) c.hp = Math.max(1, c.hp - dmg); bits.push(`-${dmg} HP each`); }
    else { for (const c of state.party) if (c.alive) c.hp = Math.min(c.maxHp, c.hp + delta.hp); bits.push(`+${delta.hp} HP each`); }
  }
  if (delta.morale) { const m = adjustMorale(state, delta.morale); if (m) bits.push(`${m > 0 ? '+' : ''}${m} morale`); }
  if (delta.xp) { const x = grantXp(state, delta.xp).trim(); if (x) bits.push(x); }
  return bits.length ? ` [${bits.join(', ')}]` : '';
}

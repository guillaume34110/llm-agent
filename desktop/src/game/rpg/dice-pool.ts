import type { RpgState, StatKey, PoolDie, DicePoolState, DiceCheckKind } from './types';
import { poolBonus, rollPoolDie } from './dice';
import { hasTrinket, TRINKETS, compassRerollCut } from './trinkets';
import { hasAffliction } from './afflictions';

// ── Dice-pool checks (the CE-style visible pool) ─────────────────────────────
export const POOL_MAX_REROLLS = 3;
export const POOL_REROLL_BASE = 8;   // morale cost of the first reroll
export const POOL_REROLL_STEP = 4;   // each further push costs this much more

// Hits needed for a full success, scaled to the pool size and the check's
// difficulty (0..1). Always 1..poolSize, so even a lone hero can clear it with a
// lucky push, while a deep-danger check leans on a fuller, sharper party.
export function requiredHits(poolSize: number, difficulty01: number): number {
  const d = Math.max(0.2, Math.min(0.95, difficulty01));
  return Math.max(1, Math.min(poolSize, Math.ceil(poolSize * (0.35 + d * 0.5))));
}

// Item dice: each piece of worn gear that boosts the check's stat lends a strong
// extra die (capped). The Idol of Fortune trinket lends one stat-agnostic wild die
// to EVERY check on top. All client-rolled.
export function poolItemDice(state: RpgState, stat: StatKey, rng: () => number): PoolDie[] {
  const dice: PoolDie[] = [];
  for (const it of state.inventory) {
    if (it.kind === 'gear' && it.stat === stat) {
      const bonus = (it.bonus ?? 1) + 1;
      const r = rollPoolDie(rng, bonus);
      dice.push({ id: `pd-item-${it.id}`, by: it.name, stat, bonus, face: r.face, hit: r.hit, kept: r.hit, item: true });
      if (dice.length >= 2) break;
    }
  }
  // Idol of Fortune: a lucky curio that helps any check (one extra die, +1).
  if (hasTrinket(state, 'idol')) {
    const r = rollPoolDie(rng, 1);
    dice.push({ id: 'pd-trinket-idol', by: TRINKETS.idol.name, stat, bonus: 1, face: r.face, hit: r.hit, kept: r.hit, item: true });
  }
  return dice;
}

// Build + roll a fresh dice pool: one themed die per living member (face + the
// member's stat bonus) plus item dice. Every face is client-rolled here.
export function buildDicePool(
  state: RpgState, kind: DiceCheckKind, stat: StatKey, prompt: string,
  nodeId: string, danger: number, difficulty01: number, rng: () => number, optionIndex?: number,
): DicePoolState {
  const dice: PoolDie[] = [];
  let i = 0;
  for (const c of state.party) {
    if (!c.alive) continue;
    // A haunted member's nerves cost them a pip on every scene-check die (≥0).
    const bonus = Math.max(0, poolBonus(c.stats[stat]) - (hasAffliction(c, 'haunted') ? 1 : 0));
    const r = rollPoolDie(rng, bonus);
    dice.push({ id: `pd-${c.id}-${i++}`, by: c.name, stat, bonus, face: r.face, hit: r.hit, kept: r.hit });
  }
  dice.push(...poolItemDice(state, stat, rng));
  const required = requiredHits(dice.length, difficulty01);
  return {
    kind, stat, prompt, nodeId, danger, dice, required,
    rerollsUsed: 0, rerollCost: POOL_REROLL_BASE, maxRerolls: POOL_MAX_REROLLS,
    resolved: false, optionIndex,
  };
}

// Count the dice currently showing a hit.
export function poolHits(pool: DicePoolState): number {
  return pool.dice.reduce((n, d) => n + (d.hit ? 1 : 0), 0);
}

// Morale a push (reroll) actually costs: the pool's escalating base, shaved by a
// Pathfinder's Compass if carried (never below 1). Used for both the affordability
// gate and the charge, so they always agree.
export function rerollMoraleCost(pool: DicePoolState, state: RpgState): number {
  return Math.max(1, pool.rerollCost - compassRerollCut(state));
}

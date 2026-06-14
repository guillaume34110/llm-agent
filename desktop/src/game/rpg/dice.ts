// Deterministic, seedable RNG so a saved game replays identically and the
// client (never the LLM) owns every random outcome. mulberry32 is tiny and good
// enough for a game's dice.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Pick one element of `arr` with the seeded RNG (the modulo guards a rng()===1).
// The client owns every selection; the LLM only supplies the labels in the array.
export function pickRng<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// Roll `count` dice of `sides` each, return individual rolls + sum.
export function roll(rng: () => number, sides: number, count = 1): { rolls: number[]; total: number } {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(rng() * sides));
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
}

export const d20 = (rng: () => number) => roll(rng, 20).total;
export const d6 = (rng: () => number, count = 1) => roll(rng, 6, count).total;

export interface CheckResult {
  roll: number;
  modifier: number;
  total: number;
  dc: number;
  success: boolean;
  crit: boolean;        // natural 20
  fumble: boolean;      // natural 1
}

// A d20 skill check vs a difficulty class. Pure mechanics — the LLM never
// computes this; it only narrates the boolean result afterwards.
export function skillCheck(rng: () => number, modifier: number, dc: number): CheckResult {
  const r = d20(rng);
  const total = r + modifier;
  return {
    roll: r,
    modifier,
    total,
    dc,
    success: r === 20 ? true : r === 1 ? false : total >= dc,
    crit: r === 20,
    fumble: r === 1,
  };
}

// ── Dice pool (the Curious-Expedition signature) ─────────────────────────────
// A check is resolved by rolling a POOL of six-sided dice, one per contributor,
// instead of a single hidden d20. Each die "hits" when its face plus the
// contributor's stat bonus clears HIT_TARGET; the count of hits is compared to a
// required number. The player can re-roll the misses (push-your-luck), at a cost
// paid in morale. Every face is rolled by the client RNG — the LLM never sees a
// die, only the narration afterwards. Pure functions; callers own the state.
export const POOL_SIDES = 6;
export const POOL_HIT_TARGET = 4;   // face + bonus ≥ this scores a hit
// A stat's contribution to each of its dice. floor(stat/2): a raw stat-2 rookie
// adds +1 (hits on 3+), a honed stat-5 specialist adds +2 (hits on 2+), a stat-7
// veteran adds +3 (auto-hit). Leveling visibly tilts the pool.
export function poolBonus(stat: number): number {
  return Math.floor(stat / 2);
}
// Roll one face and decide whether it hits given a flat bonus.
export function rollPoolDie(rng: () => number, bonus: number): { face: number; hit: boolean } {
  const face = 1 + Math.floor(rng() * POOL_SIDES);
  return { face, hit: face + bonus >= POOL_HIT_TARGET };
}

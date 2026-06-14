import type { RpgState, Difficulty } from './types';

// ── Difficulty (client-owned multipliers; the only thing a level choice picks) ─
// Every number stays algorithmic — difficulty just scales foe HP/ATK, the XP the
// party earns, the loot rate, the post-fight breather heal, and the goal's
// recommended level (reqDelta), which is the soft gate that makes farming matter.
export interface DiffParams {
  hp: number; atk: number; xp: number; loot: number; breather: number; reqDelta: number;
  morale: number; // multiplier on every morale DRAIN (higher = harsher road)
}
export const DIFFICULTY: Record<Difficulty, DiffParams> = {
  easy:   { hp: 0.8, atk: 0.7,  xp: 1.35, loot: 1.2, breather: 0.45, reqDelta: -1, morale: 0.7  },
  normal: { hp: 1.0, atk: 1.0,  xp: 1.0,  loot: 1.0, breather: 0.3,  reqDelta: 0,  morale: 1.0  },
  hard:   { hp: 1.3, atk: 1.25, xp: 0.8,  loot: 0.9, breather: 0.18, reqDelta: 1,  morale: 1.35 },
};
export function diffOf(state: RpgState): DiffParams {
  return DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
}

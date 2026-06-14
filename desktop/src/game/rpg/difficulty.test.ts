import { describe, it, expect } from 'vitest';
import type { RpgState } from './types';
import { DIFFICULTY, diffOf } from './difficulty';

describe('DIFFICULTY table', () => {
  it('defines the three tiers with normal as the 1.0 baseline', () => {
    expect(DIFFICULTY.normal.hp).toBe(1.0);
    expect(DIFFICULTY.normal.atk).toBe(1.0);
    expect(DIFFICULTY.normal.xp).toBe(1.0);
    expect(DIFFICULTY.normal.morale).toBe(1.0);
  });
  it('scales monotonically: easy is softer, hard is harsher', () => {
    expect(DIFFICULTY.easy.hp).toBeLessThan(DIFFICULTY.normal.hp);
    expect(DIFFICULTY.hard.hp).toBeGreaterThan(DIFFICULTY.normal.hp);
    // easy rewards more XP/loot; hard rewards less
    expect(DIFFICULTY.easy.xp).toBeGreaterThan(DIFFICULTY.hard.xp);
    // the goal gate eases on easy, tightens on hard
    expect(DIFFICULTY.easy.reqDelta).toBeLessThan(DIFFICULTY.hard.reqDelta);
  });
});

describe('diffOf', () => {
  it('reads the params for the state difficulty', () => {
    expect(diffOf({ difficulty: 'hard' } as RpgState)).toBe(DIFFICULTY.hard);
  });
  it('falls back to normal for an unknown/missing difficulty', () => {
    expect(diffOf({ difficulty: 'wat' as unknown } as RpgState)).toBe(DIFFICULTY.normal);
    expect(diffOf({} as RpgState)).toBe(DIFFICULTY.normal);
  });
});

import { describe, it, expect } from 'vitest';
import {
  requiredHits, poolHits, poolItemDice, buildDicePool, rerollMoraleCost,
  POOL_MAX_REROLLS, POOL_REROLL_BASE, POOL_REROLL_STEP,
} from './dice-pool';
import { makeTrinket, COMPASS_REROLL_CUT } from './trinkets';
import type { RpgState, Character, DicePoolState, PoolDie } from './types';

// A deterministic rng handing back a fixed queue (then 0 forever). rollPoolDie
// reads ONE value per die: face = 1 + floor(rng()*6) → 0→1, 0.5→4, 0.9→6.
function rngOf(...vals: number[]): () => number {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
}

function ch(partial: Partial<Character> = {}): Character {
  return {
    id: 'c1', name: 'Hero', className: 'warrior',
    stats: { might: 6, agility: 2, wits: 2, spirit: 2 },
    hp: 30, maxHp: 30, level: 1, xp: 0, alive: true,
    ...partial,
  } as Character;
}

function state(partial: Partial<RpgState> = {}): RpgState {
  return { party: [ch()], inventory: [], ...partial } as unknown as RpgState;
}

describe('reroll constants', () => {
  it('hold the push-your-luck economy', () => {
    expect(POOL_MAX_REROLLS).toBe(3);
    expect(POOL_REROLL_BASE).toBe(8);
    expect(POOL_REROLL_STEP).toBe(4);
  });
});

describe('requiredHits', () => {
  it('scales with pool size and difficulty', () => {
    expect(requiredHits(4, 0.5)).toBe(3);  // ceil(4*(0.35+0.25))=ceil(2.4)
    expect(requiredHits(1, 0.9)).toBe(1);  // ceil(1*0.8)=1
  });
  it('clamps difficulty into [0.2, 0.95]', () => {
    expect(requiredHits(4, 0)).toBe(2);    // 0→0.2 → ceil(4*0.45)=ceil(1.8)
    expect(requiredHits(4, 1)).toBe(4);    // 1→0.95 → ceil(4*0.825)=ceil(3.3)
  });
  it('never demands more than the pool nor fewer than one', () => {
    expect(requiredHits(3, 1)).toBeLessThanOrEqual(3);
    expect(requiredHits(2, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('poolHits', () => {
  it('counts only the dice showing a hit', () => {
    const pool = { dice: [
      { hit: true } as PoolDie, { hit: false } as PoolDie, { hit: true } as PoolDie,
    ] } as DicePoolState;
    expect(poolHits(pool)).toBe(2);
  });
  it('is zero on an all-miss pool', () => {
    expect(poolHits({ dice: [{ hit: false } as PoolDie] } as DicePoolState)).toBe(0);
  });
});

describe('poolItemDice', () => {
  it('lends a strong die per stat-matching gear, capped at two', () => {
    const inv = [
      { id: 'g1', name: 'Axe', kind: 'gear', stat: 'might', bonus: 1 },
      { id: 'g2', name: 'Gauntlet', kind: 'gear', stat: 'might', bonus: 2 },
      { id: 'g3', name: 'Helm', kind: 'gear', stat: 'might', bonus: 1 }, // beyond the cap
      { id: 'g4', name: 'Boots', kind: 'gear', stat: 'agility', bonus: 1 }, // wrong stat
    ];
    const dice = poolItemDice(state({ inventory: inv as never }), 'might', rngOf(0, 0, 0, 0));
    expect(dice.length).toBe(2);
    expect(dice.every(d => d.item)).toBe(true);
    expect(dice[0].bonus).toBe(2); // (1)+1
    expect(dice[1].bonus).toBe(3); // (2)+1
  });
  it('adds one stat-agnostic wild die when the Idol of Fortune is carried', () => {
    const inv = [{ id: 't1', name: 'Idol', kind: 'trinket', trinket: 'idol' }];
    const dice = poolItemDice(state({ inventory: inv as never }), 'wits', rngOf(0));
    expect(dice.length).toBe(1);
    expect(dice[0].id).toBe('pd-trinket-idol');
    expect(dice[0].bonus).toBe(1);
  });
  it('yields nothing with no relevant gear or trinket', () => {
    expect(poolItemDice(state(), 'spirit', rngOf(0)).length).toBe(0);
  });
});

describe('rerollMoraleCost', () => {
  const pool = { rerollCost: POOL_REROLL_BASE } as DicePoolState;
  it('is the pool cost as-is with no compass', () => {
    expect(rerollMoraleCost(pool, state())).toBe(POOL_REROLL_BASE);
  });
  it('shaves the compass cut when the compass is carried', () => {
    const s = state({ inventory: [makeTrinket('compass')] as never });
    expect(rerollMoraleCost(pool, s)).toBe(POOL_REROLL_BASE - COMPASS_REROLL_CUT);
  });
  it('never drops below one', () => {
    const cheap = { rerollCost: 1 } as DicePoolState;
    const s = state({ inventory: [makeTrinket('compass')] as never });
    expect(rerollMoraleCost(cheap, s)).toBe(1);
  });
});

describe('buildDicePool', () => {
  it('rolls one die per living member (skipping the downed) plus item dice', () => {
    const alive = ch({ id: 'a', name: 'A', stats: { might: 6, agility: 2, wits: 2, spirit: 2 } });
    const dead = ch({ id: 'd', name: 'D', alive: false });
    const inv = [{ id: 'g1', name: 'Axe', kind: 'gear', stat: 'might', bonus: 1 }];
    const s = state({ party: [alive, dead], inventory: inv as never });
    const pool = buildDicePool(s, 'search', 'might', 'Heave', 'n1', 1, 0.5, rngOf(0.9, 0.9), 0);
    expect(pool.dice.length).toBe(2);              // one member + one gear (dead skipped)
    expect(pool.dice[0].by).toBe('A');
    expect(pool.dice[1].item).toBe(true);
    expect(pool.kind).toBe('search');
    expect(pool.nodeId).toBe('n1');
    expect(pool.optionIndex).toBe(0);
    expect(pool.required).toBe(requiredHits(2, 0.5));
    expect(pool.rerollCost).toBe(POOL_REROLL_BASE);
    expect(pool.maxRerolls).toBe(POOL_MAX_REROLLS);
    expect(pool.resolved).toBe(false);
  });
  it('a haunted member loses a pip on the die (floored at 0)', () => {
    const calm = ch({ id: 'a', name: 'A', stats: { might: 6, agility: 2, wits: 2, spirit: 2 } });
    const haunted = ch({ id: 'b', name: 'B', stats: { might: 6, agility: 2, wits: 2, spirit: 2 }, affliction: 'haunted' });
    const s = state({ party: [calm, haunted] });
    const pool = buildDicePool(s, 'dilemma', 'might', 'p', 'n', 0, 0.5, rngOf(0, 0));
    // poolBonus(6)=3; haunted shaves to 2.
    expect(pool.dice[0].bonus).toBe(3);
    expect(pool.dice[1].bonus).toBe(2);
  });
});

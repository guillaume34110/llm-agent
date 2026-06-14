import { describe, it, expect } from 'vitest';
import { partyBest, partyPower, partyDamagePerRound, partyAvgLevel } from './party-stats';
import type { Character, RpgState } from './types';

function ch(partial: Partial<Character>): Character {
  return {
    id: 'c', name: 'C', className: 'Knight', blurb: '', isHero: false,
    level: 1, xp: 0, hp: 20, maxHp: 20, alive: true,
    stats: { might: 2, agility: 2, wits: 2, spirit: 2 },
    ...partial,
  } as Character;
}

const state = (party: Character[]): RpgState => ({ party } as unknown as RpgState);

describe('partyBest', () => {
  it('returns the strongest living member for a stat', () => {
    const s = state([ch({ stats: { might: 5, agility: 2, wits: 2, spirit: 2 } }), ch({ stats: { might: 3, agility: 6, wits: 2, spirit: 2 } })]);
    expect(partyBest(s, 'might')).toBe(5);
    expect(partyBest(s, 'agility')).toBe(6);
  });

  it('ignores the dead', () => {
    const s = state([ch({ alive: false, stats: { might: 9, agility: 2, wits: 2, spirit: 2 } }), ch({ stats: { might: 3, agility: 2, wits: 2, spirit: 2 } })]);
    expect(partyBest(s, 'might')).toBe(3);
  });

  it('returns 0 for an empty/dead roster', () => {
    expect(partyBest(state([]), 'might')).toBe(0);
  });
});

describe('partyPower', () => {
  it('sums might+agility+level over the living', () => {
    const s = state([ch({ level: 2, stats: { might: 3, agility: 3, wits: 0, spirit: 0 } })]);
    expect(partyPower(s)).toBe(3 + 3 + 2);
  });

  it('excludes the dead', () => {
    const s = state([ch({ alive: false, level: 9, stats: { might: 9, agility: 9, wits: 0, spirit: 0 } })]);
    expect(partyPower(s)).toBe(0);
  });
});

describe('partyDamagePerRound', () => {
  it('never drops below the floor of 6', () => {
    expect(partyDamagePerRound(state([]))).toBe(6);
  });

  it('grows with more capable members', () => {
    const weak = state([ch({ stats: { might: 2, agility: 2, wits: 2, spirit: 2 } })]);
    const strong = state([ch({ stats: { might: 8, agility: 8, wits: 2, spirit: 2 } })]);
    expect(partyDamagePerRound(strong)).toBeGreaterThan(partyDamagePerRound(weak));
  });
});

describe('partyAvgLevel', () => {
  it('defaults to 1 for an empty roster', () => {
    expect(partyAvgLevel(state([]))).toBe(1);
  });

  it('averages living levels', () => {
    const s = state([ch({ level: 2 }), ch({ level: 4 }), ch({ alive: false, level: 100 })]);
    expect(partyAvgLevel(s)).toBe(3);
  });
});

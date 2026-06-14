import { describe, it, expect } from 'vitest';
import type { RpgState, Character } from './types';
import { TRAITS, TRAIT_IDS, partyHasTrait, braveOffenseBonus, BRAVE_OFFENSE } from './traits';

const member = (over: Partial<Character>): Character => ({
  id: 'c', name: 'X', className: 'Warrior', level: 1, xp: 0,
  hp: 10, maxHp: 10, alive: true, stats: {} as Character['stats'],
  ...over,
} as Character);

describe('TRAITS catalog', () => {
  it('every id in TRAIT_IDS resolves to a defined trait', () => {
    for (const id of TRAIT_IDS) {
      expect(TRAITS[id]).toBeDefined();
      expect(TRAITS[id].id).toBe(id);
    }
  });
});

describe('partyHasTrait', () => {
  it('true when a living member carries the trait', () => {
    const st = { party: [member({ trait: TRAITS.forager })] } as RpgState;
    expect(partyHasTrait(st, 'forager')).toBe(true);
  });
  it('false when the only carrier is down (perks track the live roster)', () => {
    const st = { party: [member({ alive: false, trait: TRAITS.forager })] } as RpgState;
    expect(partyHasTrait(st, 'forager')).toBe(false);
  });
  it('false when nobody carries it', () => {
    const st = { party: [member({ trait: TRAITS.lucky })] } as RpgState;
    expect(partyHasTrait(st, 'forager')).toBe(false);
  });
});

describe('braveOffenseBonus', () => {
  it('grants the bonus only to a living brave member', () => {
    expect(braveOffenseBonus(member({ trait: TRAITS.brave }))).toBe(BRAVE_OFFENSE);
    expect(braveOffenseBonus(member({ trait: TRAITS.brave, alive: false }))).toBe(0);
    expect(braveOffenseBonus(member({ trait: TRAITS.lucky }))).toBe(0);
    expect(braveOffenseBonus(member({}))).toBe(0);
  });
});

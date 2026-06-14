import { describe, it, expect } from 'vitest';
import { NAMES, STAT_KEYS, statProfile, makeCharacter, statMod, recruitCost } from './character';
import type { Character } from './types';

describe('statProfile', () => {
  it('exposes the four canonical stat keys', () => {
    expect(STAT_KEYS).toEqual(['might', 'agility', 'wits', 'spirit']);
  });

  it('maps martial classes to might focus with high HP', () => {
    const p = statProfile('Knight');
    expect(p.key).toBe('might');
    expect(p.stats.might).toBe(5);
    expect(p.hp).toBe(32);
  });

  it('maps agile classes to agility focus', () => {
    const p = statProfile('Rogue assassin');
    expect(p.key).toBe('agility');
    expect(p.stats.agility).toBe(5);
    expect(p.hp).toBe(26);
  });

  it('maps arcane classes to wits, low HP', () => {
    const p = statProfile('Sorcerer');
    expect(p.key).toBe('wits');
    expect(p.stats.wits).toBe(5);
    expect(p.hp).toBe(20);
  });

  it('maps faith classes to spirit', () => {
    const p = statProfile('Druid');
    expect(p.key).toBe('spirit');
    expect(p.stats.spirit).toBe(5);
  });

  it('falls back to a balanced might profile for unknown classes', () => {
    const p = statProfile('Glassblower');
    expect(p.key).toBe('might');
    expect(p.stats.might).toBe(4);
    expect(p.stats.agility).toBe(3);
  });

  it('is case-insensitive', () => {
    expect(statProfile('WIZARD').key).toBe('wits');
  });
});

describe('makeCharacter', () => {
  const opt = { className: 'Knight', blurb: 'a sworn blade' };

  it('builds a hero with hero id prefix and full HP', () => {
    const c = makeCharacter(opt, 'Aldric', true);
    expect(c.isHero).toBe(true);
    expect(c.id.startsWith('hero_')).toBe(true);
    expect(c.name).toBe('Aldric');
    expect(c.level).toBe(1);
    expect(c.xp).toBe(0);
    expect(c.alive).toBe(true);
    expect(c.hp).toBe(c.maxHp);
  });

  it('builds allies with ally id prefix', () => {
    const c = makeCharacter(opt, 'Bryn', false);
    expect(c.id.startsWith('ally_')).toBe(true);
    expect(c.isHero).toBe(false);
  });

  it('omits a trait when no rng is supplied (legacy path)', () => {
    const c = makeCharacter(opt, 'Cael', false);
    expect(c.trait).toBeUndefined();
  });

  it('rolls a trait when rng supplied', () => {
    const c = makeCharacter(opt, 'Dara', false, () => 0);
    expect(c.trait).toBeDefined();
  });

  it('grants tough members bonus max HP', () => {
    // rng=0 picks the first trait id; find which member ends tough vs not by
    // comparing a tough roll's HP against the base profile.
    const base = statProfile(opt.className).hp;
    const c = makeCharacter(opt, 'Eira', false, () => 0);
    if (c.trait?.id === 'tough') {
      expect(c.maxHp).toBeGreaterThan(base);
    } else {
      expect(c.maxHp).toBe(base);
    }
  });
});

describe('statMod', () => {
  it('returns the raw stat value', () => {
    const c = makeCharacter({ className: 'Mage', blurb: '' }, 'Nox', true);
    expect(statMod(c, 'wits')).toBe(c.stats.wits);
  });
});

describe('recruitCost', () => {
  const ally = (stats: Partial<Character['stats']>, level = 1): Character =>
    ({ stats: { might: 2, agility: 2, wits: 2, spirit: 2, ...stats }, level } as Character);

  it('rounds to whole multiples of 5', () => {
    const cost = recruitCost(ally({}), 1);
    expect(cost % 5).toBe(0);
  });

  it('scales up with party size (4th costs more than 2nd)', () => {
    const a = ally({});
    expect(recruitCost(a, 3)).toBeGreaterThan(recruitCost(a, 1));
  });

  it('scales up with recruit power', () => {
    const weak = ally({});
    const strong = ally({ might: 6, agility: 6 });
    expect(recruitCost(strong, 1)).toBeGreaterThan(recruitCost(weak, 1));
  });

  it('costs more for higher-level recruits', () => {
    expect(recruitCost(ally({}, 3), 1)).toBeGreaterThan(recruitCost(ally({}, 1), 1));
  });
});

describe('NAMES', () => {
  it('offers a non-trivial, unique pool of names', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });
});

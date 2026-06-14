import { describe, it, expect } from 'vitest';
import { teamSynergy } from './synergy';
import type { Character, RpgState, CompanionTrait, TraitId } from './types';

function ch(className: string, traitId?: TraitId, alive = true): Character {
  const trait = traitId ? ({ id: traitId, name: traitId, blurb: '' } as unknown as CompanionTrait) : undefined;
  return {
    id: 'c', name: 'C', className, blurb: '', isHero: false,
    level: 1, xp: 0, hp: 20, maxHp: 20, alive,
    stats: { might: 2, agility: 2, wits: 2, spirit: 2 }, trait,
  } as Character;
}

const state = (party: Character[]): RpgState => ({ party } as unknown as RpgState);

describe('teamSynergy', () => {
  it('grants no bonus to an empty/dead band', () => {
    expect(teamSynergy(state([])).bonus).toBe(0);
  });

  it('grants no bonus to a mono-discipline pair', () => {
    const s = state([ch('Knight'), ch('Warrior')]);
    expect(teamSynergy(s).bonus).toBe(0);
  });

  it('rewards two disciplines in concert', () => {
    const s = state([ch('Knight'), ch('Mage')]);
    const r = teamSynergy(s);
    expect(r.bonus).toBeGreaterThanOrEqual(1);
    expect(r.parts.some(p => /disciplines/.test(p))).toBe(true);
  });

  it('rewards a well-rounded three-discipline band more', () => {
    const two = teamSynergy(state([ch('Knight'), ch('Mage')])).bonus;
    const three = teamSynergy(state([ch('Knight'), ch('Mage'), ch('Rogue')])).bonus;
    expect(three).toBeGreaterThan(two);
  });

  it('caps the bonus at 4', () => {
    const s = state([
      ch('Knight', 'tough'), ch('Mage', 'lucky'), ch('Rogue', 'forager'), ch('Cleric', 'cheerful'),
    ]);
    expect(teamSynergy(s).bonus).toBeLessThanOrEqual(4);
  });

  it('ignores the dead when measuring composition', () => {
    const s = state([ch('Knight'), ch('Mage', undefined, false)]);
    expect(teamSynergy(s).bonus).toBe(0);
  });
});

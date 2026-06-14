import { describe, it, expect } from 'vitest';
import {
  AFFLICTIONS, AFFLICTION_IDS, AFFLICT_MORALE, RECOVER_MORALE,
  RAVENOUS_RATION_EXTRA, CURSED_BOON_MUL,
  hasAffliction, maybeAfflict, maybeRecover, tickAfflictions,
  ravenousRationExtra, cursedBoonMul,
} from './afflictions';
import { makeTrinket } from './trinkets';
import type { Character, RpgState, AfflictionId } from './types';

function ch(partial: Partial<Character>): Character {
  return {
    id: 'c', name: 'C', className: 'Knight', blurb: '', isHero: false,
    level: 1, xp: 0, hp: 20, maxHp: 20, alive: true,
    stats: { might: 2, agility: 2, wits: 2, spirit: 2 },
    ...partial,
  } as Character;
}

function state(partial: Partial<RpgState>): RpgState {
  return { morale: 100, party: [], inventory: [], ...partial } as unknown as RpgState;
}

describe('catalog integrity', () => {
  it('every id has a matching entry', () => {
    for (const id of AFFLICTION_IDS) {
      expect(AFFLICTIONS[id].id).toBe(id);
      expect(AFFLICTIONS[id].label.length).toBeGreaterThan(0);
    }
  });

  it('thresholds order: afflict below recover', () => {
    expect(AFFLICT_MORALE).toBeLessThan(RECOVER_MORALE);
  });
});

describe('hasAffliction', () => {
  it('true only for a living, matching member', () => {
    expect(hasAffliction(ch({ affliction: 'haunted' as AfflictionId }), 'haunted')).toBe(true);
    expect(hasAffliction(ch({ affliction: 'haunted' as AfflictionId }), 'feverish')).toBe(false);
    expect(hasAffliction(ch({ affliction: 'haunted' as AfflictionId, alive: false }), 'haunted')).toBe(false);
    expect(hasAffliction(ch({}), 'haunted')).toBe(false);
  });
});

describe('maybeAfflict', () => {
  it('never afflicts at or above the morale threshold', () => {
    const s = state({ morale: AFFLICT_MORALE, party: [ch({})] });
    expect(maybeAfflict(s, () => 0)).toBeNull();
    expect(s.party[0].affliction).toBeUndefined();
  });

  it('afflicts a clean member at low morale with a low roll', () => {
    const s = state({ morale: 0, party: [ch({})] });
    const line = maybeAfflict(s, () => 0);
    expect(line).toBeTruthy();
    expect(s.party[0].affliction).toBeDefined();
  });

  it('does not afflict when the roll exceeds the chance', () => {
    const s = state({ morale: 39, party: [ch({})] });
    expect(maybeAfflict(s, () => 0.99)).toBeNull();
  });

  it('skips already-afflicted and dead members', () => {
    const s = state({ morale: 0, party: [ch({ affliction: 'haunted' as AfflictionId }), ch({ alive: false })] });
    expect(maybeAfflict(s, () => 0)).toBeNull();
  });
});

describe('maybeRecover', () => {
  it('does nothing below the recovery threshold', () => {
    const s = state({ morale: RECOVER_MORALE - 1, party: [ch({ affliction: 'haunted' as AfflictionId })] });
    expect(maybeRecover(s, () => 0)).toBeNull();
  });

  it('clears an affliction at high morale on a low roll', () => {
    const s = state({ morale: 100, party: [ch({ affliction: 'feverish' as AfflictionId })] });
    const line = maybeRecover(s, () => 0);
    expect(line).toBeTruthy();
    expect(s.party[0].affliction).toBeUndefined();
  });

  it('keeps the affliction on a high roll', () => {
    const s = state({ morale: 100, party: [ch({ affliction: 'feverish' as AfflictionId })] });
    expect(maybeRecover(s, () => 0.99)).toBeNull();
    expect(s.party[0].affliction).toBe('feverish');
  });

  it('a Soothing Tonic lifts the recover chance (a roll that fails bare succeeds with it)', () => {
    // 0.6: fails the bare 0.5 chance (0.6 >= 0.5), clears under the 0.75 tonic chance.
    const bare = state({ morale: 100, party: [ch({ affliction: 'haunted' as AfflictionId })] });
    expect(maybeRecover(bare, () => 0.6)).toBeNull();
    const tonic = state({ morale: 100, party: [ch({ affliction: 'haunted' as AfflictionId })], inventory: [makeTrinket('tonic')] });
    expect(maybeRecover(tonic, () => 0.6)).toBeTruthy();
    expect(tonic.party[0].affliction).toBeUndefined();
  });
});

describe('ravenousRationExtra', () => {
  it('is zero with no ravenous member', () => {
    const s = state({ party: [ch({}), ch({ affliction: 'haunted' as AfflictionId })] });
    expect(ravenousRationExtra(s)).toBe(0);
  });
  it('adds one ration per living ravenous member', () => {
    const s = state({ party: [ch({ affliction: 'ravenous' as AfflictionId }), ch({ affliction: 'ravenous' as AfflictionId })] });
    expect(ravenousRationExtra(s)).toBe(2 * RAVENOUS_RATION_EXTRA);
  });
  it('ignores a dead ravenous member', () => {
    const s = state({ party: [ch({ affliction: 'ravenous' as AfflictionId, alive: false })] });
    expect(ravenousRationExtra(s)).toBe(0);
  });
});

describe('cursedBoonMul', () => {
  it('is full (1) with no cursed member', () => {
    const s = state({ party: [ch({}), ch({ affliction: 'feverish' as AfflictionId })] });
    expect(cursedBoonMul(s)).toBe(1);
  });
  it('shrinks the find while a living member is cursed', () => {
    const s = state({ party: [ch({ affliction: 'cursed' as AfflictionId })] });
    expect(cursedBoonMul(s)).toBe(CURSED_BOON_MUL);
  });
  it('ignores a dead cursed member', () => {
    const s = state({ party: [ch({ affliction: 'cursed' as AfflictionId, alive: false })] });
    expect(cursedBoonMul(s)).toBe(1);
  });
});

describe('tickAfflictions', () => {
  it('returns no lines for a healthy, high-morale party', () => {
    const s = state({ morale: 100, party: [ch({})] });
    expect(tickAfflictions(s, () => 0.99)).toEqual([]);
  });

  it('can both heal at high morale', () => {
    const s = state({ morale: 100, party: [ch({ affliction: 'haunted' as AfflictionId })] });
    const lines = tickAfflictions(s, () => 0);
    expect(lines.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from 'vitest';
import {
  REP_MIN, REP_MAX, REP_CLEAR,
  settlementRep, repDiscount, repTier, provPriceAt, recruitPriceAt,
  addRep, creditRegionForClear, gratitudeLine,
} from './reputation';
import { PROV_COST } from './provisions';
import type { MapNode, RpgState, Character } from './types';

function node(partial: Partial<MapNode>): MapNode {
  return { id: 'n', name: 'Place', kind: 'town', blurb: '', edges: [], ...partial } as MapNode;
}

describe('settlementRep / repDiscount', () => {
  it('defaults to 0 standing', () => {
    expect(settlementRep(node({}))).toBe(0);
  });

  it('never gives a surcharge below neutral', () => {
    expect(repDiscount(node({ reputation: -10 }))).toBe(0);
  });

  it('caps the discount at 30%', () => {
    expect(repDiscount(node({ reputation: 999 }))).toBe(0.3);
  });

  it('scales linearly in the band (rep/100)', () => {
    expect(repDiscount(node({ reputation: 20 }))).toBeCloseTo(0.2);
  });
});

describe('repTier', () => {
  it('classifies the standing bands', () => {
    expect(repTier(-10)).toBe('reviled');
    expect(repTier(0)).toBe('stranger');
    expect(repTier(10)).toBe('known');
    expect(repTier(25)).toBe('welcomed');
    expect(repTier(40)).toBe('honored');
  });
});

describe('provPriceAt', () => {
  it('charges full cost at neutral', () => {
    expect(provPriceAt(node({}))).toBe(PROV_COST);
  });

  it('rounds the discounted price down, never below 1', () => {
    const p = provPriceAt(node({ reputation: 30 }));
    expect(p).toBeLessThan(PROV_COST);
    expect(p).toBeGreaterThanOrEqual(1);
  });
});

describe('recruitPriceAt', () => {
  const ally = { stats: { might: 3, agility: 3, wits: 2, spirit: 2 }, level: 1 } as Character;
  it('discounts a recruit at high standing', () => {
    const full = recruitPriceAt(node({ reputation: 0 }), ally, 1);
    const cheap = recruitPriceAt(node({ reputation: 30 }), ally, 1);
    expect(cheap).toBeLessThan(full);
    expect(cheap).toBeGreaterThanOrEqual(1);
  });
});

describe('addRep', () => {
  it('bumps a settlement clamped to the band', () => {
    const t = node({ kind: 'town', reputation: REP_MAX - 1 });
    addRep(t, 10);
    expect(t.reputation).toBe(REP_MAX);
  });

  it('floors at REP_MIN', () => {
    const t = node({ kind: 'town', reputation: REP_MIN + 1 });
    addRep(t, -10);
    expect(t.reputation).toBe(REP_MIN);
  });

  it('is a no-op on non-settlements', () => {
    const ruin = node({ kind: 'ruin' as MapNode['kind'] });
    addRep(ruin, 10);
    expect(ruin.reputation).toBeUndefined();
  });

  it('tolerates undefined node', () => {
    expect(() => addRep(undefined, 5)).not.toThrow();
  });
});

describe('creditRegionForClear', () => {
  it('rewards settlements bordering a cleared danger site', () => {
    const state = {
      nodes: {
        danger: node({ id: 'danger', kind: 'ruin' as MapNode['kind'], edges: ['town1', 'town2'] }),
        town1: node({ id: 'town1', name: 'Aldermoor', kind: 'town', reputation: 0 }),
        town2: node({ id: 'town2', name: 'Brightvale', kind: 'village', reputation: 0 }),
      },
    } as unknown as RpgState;
    const thanked = creditRegionForClear(state, 'danger');
    expect(thanked.sort()).toEqual(['Aldermoor', 'Brightvale']);
    expect(state.nodes.town1.reputation).toBe(REP_CLEAR);
    expect(state.nodes.town2.reputation).toBe(REP_CLEAR);
  });

  it('returns nothing for a settlement node (settlements are not danger)', () => {
    const state = { nodes: { t: node({ id: 't', kind: 'town' }) } } as unknown as RpgState;
    expect(creditRegionForClear(state, 't')).toEqual([]);
  });
});

describe('gratitudeLine', () => {
  it('is empty for no settlements', () => {
    expect(gratitudeLine([])).toBe('');
  });

  it('names a single settlement', () => {
    expect(gratitudeLine(['Aldermoor'])).toContain('Aldermoor');
  });

  it('joins multiple settlements with "and"', () => {
    const line = gratitudeLine(['A', 'B', 'C']);
    expect(line).toContain('A, B and C');
  });
});

describe('band constants', () => {
  it('REP_MIN below REP_MAX', () => {
    expect(REP_MIN).toBeLessThan(REP_MAX);
  });
});

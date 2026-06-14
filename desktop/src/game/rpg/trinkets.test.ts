import { describe, it, expect } from 'vitest';
import type { RpgState, Item } from './types';
import {
  TRINKETS, TRINKET_IDS, hasTrinket, makeTrinket,
  lanternDrainMul, snareRationCut, bannerCampMorale, lodestarGoldMul,
  aegisWard, compassRerollCut, recoverChance,
  LANTERN_DRAIN_MUL, SNARE_RATION_CUT, BANNER_CAMP_MORALE, LODESTAR_GOLD_MUL,
  AEGIS_WARD, COMPASS_REROLL_CUT, TONIC_RECOVER_CHANCE, BASE_RECOVER_CHANCE,
} from './trinkets';

describe('TRINKETS catalog', () => {
  it('every id in TRINKET_IDS resolves to a defined trinket', () => {
    for (const id of TRINKET_IDS) {
      expect(TRINKETS[id]).toBeDefined();
      expect(TRINKETS[id].id).toBe(id);
    }
  });
});

describe('makeTrinket', () => {
  it('mints a satchel item of kind trinket carrying the id', () => {
    const it = makeTrinket('charm');
    expect(it.kind).toBe('trinket');
    expect(it.trinket).toBe('charm');
    expect(it.name).toBe(TRINKETS.charm.name);
  });
});

describe('hasTrinket', () => {
  const withInv = (inv: Item[]) => ({ inventory: inv } as RpgState);
  it('true when any copy is in the satchel', () => {
    expect(hasTrinket(withInv([makeTrinket('idol')]), 'idol')).toBe(true);
  });
  it('false for a trinket not carried, and tolerates a missing inventory', () => {
    expect(hasTrinket(withInv([makeTrinket('idol')]), 'charm')).toBe(false);
    expect(hasTrinket({} as RpgState, 'idol')).toBe(false);
  });
});

describe('effect helpers — identity without the trinket, tweak with it', () => {
  const carrying = (...ids: Item['trinket'][]) =>
    ({ inventory: ids.map(id => makeTrinket(id!)) } as RpgState);
  const none = { inventory: [] as Item[] } as RpgState;

  it('lanternDrainMul: 1 without, LANTERN_DRAIN_MUL with', () => {
    expect(lanternDrainMul(none)).toBe(1);
    expect(lanternDrainMul(carrying('lantern'))).toBe(LANTERN_DRAIN_MUL);
  });
  it('snareRationCut: 0 without, SNARE_RATION_CUT with', () => {
    expect(snareRationCut(none)).toBe(0);
    expect(snareRationCut(carrying('snare'))).toBe(SNARE_RATION_CUT);
  });
  it('bannerCampMorale: 0 without, BANNER_CAMP_MORALE with', () => {
    expect(bannerCampMorale(none)).toBe(0);
    expect(bannerCampMorale(carrying('banner'))).toBe(BANNER_CAMP_MORALE);
  });
  it('lodestarGoldMul: 1 without, LODESTAR_GOLD_MUL with', () => {
    expect(lodestarGoldMul(none)).toBe(1);
    expect(lodestarGoldMul(carrying('lodestar'))).toBe(LODESTAR_GOLD_MUL);
  });
  it('aegisWard: 0 without, AEGIS_WARD with', () => {
    expect(aegisWard(none)).toBe(0);
    expect(aegisWard(carrying('aegis'))).toBe(AEGIS_WARD);
  });
  it('compassRerollCut: 0 without, COMPASS_REROLL_CUT with', () => {
    expect(compassRerollCut(none)).toBe(0);
    expect(compassRerollCut(carrying('compass'))).toBe(COMPASS_REROLL_CUT);
  });
  it('recoverChance: BASE without, TONIC with', () => {
    expect(recoverChance(none)).toBe(BASE_RECOVER_CHANCE);
    expect(recoverChance(carrying('tonic'))).toBe(TONIC_RECOVER_CHANCE);
  });
});

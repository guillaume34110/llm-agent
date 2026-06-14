import { describe, it, expect } from 'vitest';
import {
  rollRarity, makePotion, makeGear, makeValuable, rollLoot, applyLoot,
  satchelCap, satchelBulk, satchelValue, sellValuable, usePotion,
  SATCHEL_BASE_CAP, SATCHEL_CAP_PER_MEMBER, PRIZE_PREMIUM,
} from './loot';
import { TRADE_GOODS, prizedBy } from './peoples';
import type { Character, Item, RpgState } from './types';

// A deterministic "rng" that replays a fixed sequence (looping).
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

function ch(partial: Partial<Character>): Character {
  return {
    id: 'c' + Math.random(), name: 'C', className: 'Knight', blurb: '', isHero: false,
    level: 1, xp: 0, hp: 20, maxHp: 20, alive: true,
    stats: { might: 2, agility: 2, wits: 2, spirit: 2 },
    ...partial,
  } as Character;
}

function state(partial: Partial<RpgState>): RpgState {
  return {
    gold: 0, party: [ch({})], inventory: [], log: [], nodes: {},
    quest: {}, order: [], recruitPool: [], rumors: [],
    scene: null, dialogue: null, combat: null, dilemma: null,
    rivals: [], rivalEncounter: null,
    ...partial,
  } as unknown as RpgState;
}

describe('rollRarity', () => {
  it('returns common for a low roll', () => {
    expect(rollRarity(() => 0, 0, false)).toBe('common');
  });

  it('biases up for bosses and danger', () => {
    expect(rollRarity(() => 0.9, 5, true)).toBe('fabled');
  });

  it('only ever returns a known tier', () => {
    const tiers = new Set(['common', 'fine', 'masterwork', 'fabled']);
    for (let r = 0; r <= 1; r += 0.1) {
      expect(tiers.has(rollRarity(() => r, 2, false))).toBe(true);
    }
  });
});

describe('makePotion', () => {
  it('mints a potion that heals a positive amount', () => {
    const p = makePotion(seq([0.5]), 1);
    expect(p.kind).toBe('potion');
    expect((p.heal ?? 0)).toBeGreaterThan(0);
    expect(p.id.startsWith('item_')).toBe(true);
  });
  it('mints a remedy (no heal) on a low roll', () => {
    // first rng < REMEDY_CHANCE (0.2) takes the remedy branch
    const p = makePotion(seq([0.05, 0.5]), 1);
    expect(p.kind).toBe('potion');
    expect(p.remedy).toBe(true);
    expect(p.heal).toBeUndefined();
  });
  it('mints a cordial (morale, no heal) when remedy misses but cordial hits', () => {
    // rng#1 >= 0.2 (not remedy), rng#2 < 0.18 (cordial), then morale + name rolls
    const p = makePotion(seq([0.5, 0.05, 0.5, 0.5]), 1);
    expect(p.kind).toBe('potion');
    expect((p.morale ?? 0)).toBeGreaterThan(0);
    expect(p.heal).toBeUndefined();
    expect(p.remedy).toBeUndefined();
  });
});

describe('makeGear', () => {
  it('mints stat gear with a bonus', () => {
    // rng: rarity roll low (common), then >=0.25 so not vitality, then stat/name picks
    const g = makeGear(seq([0, 0.9, 0, 0]), 0, false);
    expect(g.kind).toBe('gear');
    expect((g.bonus ?? 0) + (g.hp ?? 0)).toBeGreaterThan(0);
  });

  it('can mint vitality gear (max HP)', () => {
    const g = makeGear(seq([0, 0.1, 0]), 0, false);
    expect(g.kind).toBe('gear');
    expect(g.hp).toBeGreaterThan(0);
  });
});

describe('makeValuable', () => {
  it('mints a valuable with value and bulk', () => {
    const v = makeValuable(seq([0.5]), 2, false);
    expect(v.kind).toBe('valuable');
    expect((v.value ?? 0)).toBeGreaterThan(0);
    expect((v.bulk ?? 0)).toBeGreaterThanOrEqual(1);
  });
  it('tags every valuable with a known trade good', () => {
    const v = makeValuable(seq([0.5]), 2, false);
    expect(TRADE_GOODS).toContain(v.trade);
  });
});

describe('rollLoot', () => {
  it('always yields at least a potion, a valuable and some gold', () => {
    const loot = rollLoot(seq([0.5]), 2, false);
    expect(loot.gold).toBeGreaterThan(0);
    expect(loot.items.some(i => i.kind === 'potion')).toBe(true);
    expect(loot.items.some(i => i.kind === 'valuable')).toBe(true);
  });
});

describe('satchel capacity', () => {
  it('scales with the living roster', () => {
    const s1 = state({ party: [ch({})] });
    const s3 = state({ party: [ch({}), ch({}), ch({})] });
    expect(satchelCap(s1)).toBe(SATCHEL_BASE_CAP + 1 * SATCHEL_CAP_PER_MEMBER);
    expect(satchelCap(s3)).toBe(SATCHEL_BASE_CAP + 3 * SATCHEL_CAP_PER_MEMBER);
  });

  it('counts only valuable bulk and value', () => {
    const inv: Item[] = [
      { id: 'a', kind: 'valuable', name: 'V', desc: '', value: 100, bulk: 2 } as Item,
      { id: 'b', kind: 'potion', name: 'P', desc: '', heal: 10 } as Item,
    ];
    const s = state({ inventory: inv });
    expect(satchelBulk(s)).toBe(2);
    expect(satchelValue(s)).toBe(100);
  });
});

describe('applyLoot', () => {
  it('adds gold and a vitality drop raises max HP', () => {
    const s = state({ party: [ch({ maxHp: 20, hp: 20 })] });
    const before = s.party[0].maxHp;
    applyLoot(s, { items: [{ id: 'g', kind: 'gear', name: 'Bear', desc: '', hp: 5 } as Item], gold: 30 });
    expect(s.gold).toBe(30);
    expect(s.party[0].maxHp).toBe(before + 5);
  });

  it('bumps the weakest valuable when the satchel is full', () => {
    // Cap = 6 + 1*3 = 9. Fill near cap with a cheap heavy valuable, then add a richer one.
    const cheap: Item = { id: 'cheap', kind: 'valuable', name: 'Cheap', desc: '', value: 10, bulk: 9 } as Item;
    const s = state({ party: [ch({})], inventory: [cheap] });
    const rich: Item = { id: 'rich', kind: 'valuable', name: 'Rich', desc: '', value: 500, bulk: 2 } as Item;
    applyLoot(s, { items: [rich], gold: 0 });
    expect(s.inventory.some(i => i.id === 'rich')).toBe(true);
    expect(s.inventory.some(i => i.id === 'cheap')).toBe(false);
  });
});

describe('sellValuable', () => {
  it('turns a valuable into gold and frees its slot', () => {
    const v: Item = { id: 'v', kind: 'valuable', name: 'Gem', desc: '', value: 100, bulk: 1 } as Item;
    const prev = state({ inventory: [v], nodes: {} });
    const { state: next, note } = sellValuable(prev, 'v', 'nowhere');
    expect(next.gold).toBe(100);
    expect(next.inventory.find(i => i.id === 'v')).toBeUndefined();
    expect(note).toContain('Gem');
    expect(prev.inventory.length).toBe(1); // original untouched (immutable)
  });

  it('is a no-op for an unknown item', () => {
    const prev = state({ inventory: [] });
    expect(sellValuable(prev, 'ghost', 'x').state).toBe(prev);
  });

  it('pays a premium when the locals prize the valuable’s trade good', () => {
    const seed = 4242;
    const v: Item = { id: 'v', kind: 'valuable', name: 'Relic', desc: '', value: 100, bulk: 1, trade: prizedBy(seed) } as Item;
    const prev = state({ seed, inventory: [v], nodes: { mkt: { id: 'mkt', kind: 'town', reputation: 0, edges: [] } } } as unknown as Partial<RpgState>);
    const { state: next, note } = sellValuable(prev, 'v', 'mkt');
    expect(next.gold).toBe(Math.floor(100 * (1 + PRIZE_PREMIUM)));  // 125, rep premium 0
    expect(note).toMatch(/prize/);
  });

  it('pays no prize premium for a trade good the locals do not covet', () => {
    const seed = 4242;
    const other = TRADE_GOODS.find(t => t !== prizedBy(seed))!;
    const v: Item = { id: 'v', kind: 'valuable', name: 'Pelt', desc: '', value: 100, bulk: 1, trade: other } as Item;
    const prev = state({ seed, inventory: [v], nodes: { mkt: { id: 'mkt', kind: 'town', reputation: 0, edges: [] } } } as unknown as Partial<RpgState>);
    expect(sellValuable(prev, 'v', 'mkt').state.gold).toBe(100);
  });

  it('grants no prize premium outside a settlement (no market to bid it up)', () => {
    const seed = 4242;
    const v: Item = { id: 'v', kind: 'valuable', name: 'Relic', desc: '', value: 100, bulk: 1, trade: prizedBy(seed) } as Item;
    const prev = state({ seed, inventory: [v], nodes: { camp: { id: 'camp', kind: 'wild', reputation: 0, edges: [] } } } as unknown as Partial<RpgState>);
    expect(sellValuable(prev, 'v', 'camp').state.gold).toBe(100);
  });
});

describe('usePotion', () => {
  it('heals the most-wounded ally and consumes the potion', () => {
    const wounded = ch({ hp: 5, maxHp: 30 });
    const p: Item = { id: 'p', kind: 'potion', name: 'Draught', desc: '', heal: 10 } as Item;
    const prev = state({ party: [wounded, ch({ hp: 30, maxHp: 30 })], inventory: [p] });
    const { state: next } = usePotion(prev, 'p');
    expect(next.party[0].hp).toBe(15);
    expect(next.inventory.find(i => i.id === 'p')).toBeUndefined();
  });

  it('is a no-op for an unknown potion', () => {
    const prev = state({ inventory: [] });
    expect(usePotion(prev, 'ghost').state).toBe(prev);
  });

  it('cures an afflicted ally with a remedy and consumes it', () => {
    const sick = ch({ affliction: 'haunted' });
    const r: Item = { id: 'r', kind: 'potion', name: 'Clearmind Draught', desc: '', remedy: true } as Item;
    const prev = state({ party: [sick], inventory: [r] });
    const { state: next } = usePotion(prev, 'r');
    expect(next.party[0].affliction).toBeUndefined();
    expect(next.inventory.find(i => i.id === 'r')).toBeUndefined();
  });

  it('does not consume a remedy when no one is afflicted', () => {
    const r: Item = { id: 'r', kind: 'potion', name: 'Clearmind Draught', desc: '', remedy: true } as Item;
    const prev = state({ party: [ch({})], inventory: [r] });
    const res = usePotion(prev, 'r');
    expect(res.state).toBe(prev);             // untouched
    expect(res.note).toMatch(/afflicted/);
  });

  it('lifts party morale with a cordial and consumes it', () => {
    const c: Item = { id: 'c', kind: 'potion', name: 'Spiced Cordial', desc: '', morale: 20 } as Item;
    const prev = state({ morale: 50, inventory: [c] } as unknown as Partial<RpgState>);
    const { state: next } = usePotion(prev, 'c');
    expect(next.morale).toBe(70);
    expect(next.inventory.find(i => i.id === 'c')).toBeUndefined();
  });

  it('clamps cordial morale at the cap and does not over-restore', () => {
    const c: Item = { id: 'c', kind: 'potion', name: 'Spiced Cordial', desc: '', morale: 50 } as Item;
    const prev = state({ morale: 90, inventory: [c] } as unknown as Partial<RpgState>);
    const { state: next } = usePotion(prev, 'c');
    expect(next.morale).toBe(100);            // 90 + 50 clamped to MORALE_MAX
  });

  it('does not consume a cordial when morale is already full', () => {
    const c: Item = { id: 'c', kind: 'potion', name: 'Spiced Cordial', desc: '', morale: 20 } as Item;
    const prev = state({ morale: 100, inventory: [c] } as unknown as Partial<RpgState>);
    const res = usePotion(prev, 'c');
    expect(res.state).toBe(prev);             // untouched
    expect(res.note).toMatch(/high/);
  });
});

import { describe, it, expect } from 'vitest';
import {
  tradeInValue, askPrice, canBarter, merchantStock, barter, SPECIALTY_DISCOUNT,
} from './barter';
import { PRIZE_PREMIUM } from './loot';
import { prizedBy, TRADE_GOODS, localCraft, peopleOf, PEOPLES } from './peoples';
import type { RpgState, MapNode, Item, NodeKind } from './types';

function node(partial: Partial<MapNode> = {}): MapNode {
  return { id: 'town1', kind: 'town', reputation: 0, edges: [], ...partial } as unknown as MapNode;
}

function valuable(partial: Partial<Item> = {}): Item {
  return { id: 'v1', kind: 'valuable', name: 'Brass Idol', desc: '', rarity: 'common', value: 100, bulk: 1, ...partial } as Item;
}

function state(partial: Partial<RpgState> = {}): RpgState {
  return {
    gold: 200, ngPlus: 0, inventory: [], log: [], order: ['h'], recruitPool: [],
    party: [{ id: 'h', name: 'Hero', className: 'warrior', alive: true, hp: 20, maxHp: 20, stats: { might: 4, agility: 2, wits: 2, spirit: 2 } }],
    nodes: { town1: node() },
    ...partial,
  } as unknown as RpgState;
}

describe('tradeInValue', () => {
  it('credits a valuable at its full coin worth at neutral standing', () => {
    // parity with sellValuable: worth × (1 + repDiscount), repDiscount(0) = 0
    expect(tradeInValue(valuable({ value: 100 }), node({ reputation: 0 }))).toBe(100);
  });
  it('lifts the credit with standing (the same premium a sale would fetch)', () => {
    const honored = node({ reputation: 40 });        // repDiscount caps at +0.3
    // 100 × 1.3, floored (player-fair)
    expect(tradeInValue(valuable({ value: 100 }), honored)).toBe(130);
  });
  it('values only valuables (gear/potion are worth nothing as trade-in)', () => {
    expect(tradeInValue({ id: 'g', kind: 'gear', name: 'Sword', desc: '', bonus: 2, stat: 'might' } as Item, node())).toBe(0);
  });
  it('adds the prize premium when the good is what the locals covet (parity with sellValuable)', () => {
    const prize = prizedBy(7);
    // 100 × (1 + 0.25), floored — exactly the premium a sale would fetch
    expect(tradeInValue(valuable({ value: 100, trade: prize }), node({ reputation: 0 }), prize))
      .toBe(Math.floor(100 * (1 + PRIZE_PREMIUM)));
  });
  it('gives no prize premium to a good the locals do not covet', () => {
    const prize = prizedBy(7);
    const other = TRADE_GOODS.find(g => g !== prize)!;
    expect(tradeInValue(valuable({ value: 100, trade: other }), node({ reputation: 0 }), prize)).toBe(100);
  });
  it('gives no prize premium outside a settlement', () => {
    const prize = prizedBy(7);
    expect(tradeInValue(valuable({ value: 100, trade: prize }), node({ kind: 'ruin', reputation: 0 }), prize)).toBe(100);
  });
});

describe('askPrice', () => {
  it('scales with kind and rarity, discounted by standing', () => {
    const pot = { id: 'p', kind: 'potion', name: 'x', desc: '' } as Item;
    const gearF = { id: 'g', kind: 'gear', name: 'x', desc: '', rarity: 'fine' } as Item;
    expect(askPrice(pot, node({ reputation: 0 }))).toBe(16);
    expect(askPrice(gearF, node({ reputation: 0 }))).toBe(88);          // 44 × 2
    expect(askPrice(pot, node({ reputation: 40 }))).toBe(Math.floor(16 * 0.7)); // -30% at honored
  });
  it('omitting the local craft leaves the price unchanged (non-regression)', () => {
    const gearF = { id: 'g', kind: 'gear', name: 'x', desc: '', rarity: 'fine' } as Item;
    expect(askPrice(gearF, node({ reputation: 0 }), undefined)).toBe(askPrice(gearF, node({ reputation: 0 })));
  });
  it('shaves the specialty discount off goods the locals craft', () => {
    const gearF = { id: 'g', kind: 'gear', name: 'x', desc: '', rarity: 'fine' } as Item;
    // 88 base → -20% local craft = 70 (floored)
    expect(askPrice(gearF, node({ reputation: 0 }), 'gear')).toBe(Math.floor(88 * (1 - SPECIALTY_DISCOUNT)));
    expect(askPrice(gearF, node({ reputation: 0 }), 'gear')).toBeLessThan(askPrice(gearF, node({ reputation: 0 })));
  });
  it('leaves goods of other kinds at full price', () => {
    const pot = { id: 'p', kind: 'potion', name: 'x', desc: '' } as Item;
    expect(askPrice(pot, node({ reputation: 0 }), 'gear')).toBe(16);
  });
  it('every people crafts a real shop kind', () => {
    for (const p of PEOPLES) expect(['potion', 'gear', 'trinket']).toContain(p.craft);
  });
});

describe('regional economy (merchantStock applies the local craft discount)', () => {
  it('prices a crafted-kind item below its neutral asking price on the shelf', () => {
    // find a seed whose locals craft gear, and a node that stocks a gear item
    let seed = 1;
    while (localCraft(seed) !== 'gear') seed++;
    const s = state({ seed });
    const stock = merchantStock(node({ id: 't', kind: 'town' }), s);
    const gear = stock.find(e => e.item.kind === 'gear');
    if (gear) {
      expect(gear.price).toBe(askPrice(gear.item, node({ id: 't', kind: 'town', reputation: 0 }), 'gear'));
      expect(gear.price).toBeLessThan(askPrice(gear.item, node({ id: 't', kind: 'town', reputation: 0 })));
    }
    expect(peopleOf(seed).craft).toBe('gear');
  });
});

describe('canBarter', () => {
  it('runs only at enterable settlements (town/village)', () => {
    for (const k of ['town', 'village'] as NodeKind[]) expect(canBarter(node({ kind: k }))).toBe(true);
    for (const k of ['camp', 'wild', 'dungeon', 'forest', 'cave', 'ruin'] as NodeKind[]) expect(canBarter(node({ kind: k }))).toBe(false);
    expect(canBarter(undefined)).toBe(false);
  });
});

describe('merchantStock', () => {
  it('is deterministic per node id and stocks more in bigger settlements', () => {
    const s = state();
    const a = merchantStock(node({ id: 'x', kind: 'town' }), s);
    const b = merchantStock(node({ id: 'x', kind: 'town' }), s);
    expect(a.map(e => e.item.name)).toEqual(b.map(e => e.item.name));
    expect(merchantStock(node({ id: 'vil', kind: 'village' }), s).length)
      .toBeLessThanOrEqual(merchantStock(node({ id: 'town', kind: 'town' }), s).length);
  });
  it('uses stable, addressable ids and positive prices', () => {
    const stock = merchantStock(node({ id: 'q', kind: 'town' }), state());
    stock.forEach((e, i) => {
      expect(e.item.id).toBe(`shop:q:${i}`);
      expect(e.price).toBeGreaterThan(0);
    });
  });
  it('drops goods already bought', () => {
    const full = merchantStock(node({ id: 'z', kind: 'town' }), state());
    const soldId = full[0].item.id;
    const left = merchantStock(node({ id: 'z', kind: 'town', shopSold: [soldId] }), state());
    expect(left.find(e => e.item.id === soldId)).toBeUndefined();
    expect(left.length).toBe(full.length - 1);
  });
  it('is empty off the trade routes', () => {
    expect(merchantStock(node({ kind: 'dungeon' }), state())).toEqual([]);
  });
});

describe('barter', () => {
  function fixture() {
    const s = state();
    const stock = merchantStock(s.nodes.town1, s);
    return { s, entry: stock[0] };
  }

  it('buys with gold, debits the price and shelves the good', () => {
    const { s, entry } = fixture();
    const r = barter(s, 'town1', entry.item.id);
    expect(r.ok).toBe(true);
    expect(r.state.gold).toBe(200 - entry.price);
    expect(r.state.nodes.town1.shopSold).toContain(entry.item.id);
    // the good is gone from the shelf afterwards
    expect(merchantStock(r.state.nodes.town1, r.state).find(e => e.item.id === entry.item.id)).toBeUndefined();
  });

  it('accepts valuables as trade-in and only charges the remainder in gold', () => {
    const { s, entry } = fixture();
    s.inventory = [valuable({ id: 'v1', value: 1000 })];   // 1000 credit > any price
    const before = s.gold;
    const r = barter(s, 'town1', entry.item.id, ['v1']);
    expect(r.ok).toBe(true);
    expect(r.state.inventory.find(i => i.id === 'v1')).toBeUndefined(); // handed over
    // credit (1000) exceeds price → no gold spent, surplus returned as change
    expect(r.state.gold).toBe(before + (1000 - entry.price));
  });

  it('refuses when gold + trade-in cannot cover the price', () => {
    const { s, entry } = fixture();
    s.gold = 0;
    s.inventory = [];
    const r = barter(s, 'town1', entry.item.id);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);                 // untouched
    expect(r.note).toMatch(/short/);
  });

  it('rejects an unknown good and a non-settlement node', () => {
    const s = state();
    expect(barter(s, 'town1', 'shop:town1:999').ok).toBe(false);
    s.nodes.cave = node({ id: 'cave', kind: 'cave' });
    expect(barter(s, 'cave', 'shop:cave:0').ok).toBe(false);
  });
});

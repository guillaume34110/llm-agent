import type { RpgState, MapNode, Item } from './types';
import { makeRng, seedFrom } from './dice';
import { clone } from './clone';
import { repDiscount, addRep, REP_PATRON } from './reputation';
import { makePotion, makeGear, applyLoot, PRIZE_PREMIUM } from './loot';
import { makeTrinket, TRINKET_IDS, hasTrinket } from './trinkets';
import { prizedBy, localCraft } from './peoples';
import type { TradeGood, ShopKind } from './peoples';

// ── Barter / trade post (CE2's goods-for-goods trading) ──────────────────────
// A settlement merchant offers a small, deterministic stock of goods. The player
// buys with gold OR offers carried valuables as trade-in (the "troc"): each
// valuable is credited at a fraction of its worth, the spread narrowing the more
// the town favours the party. Surplus trade-in is returned as gold change
// (player-favourable). Every number is computed and clamped here — the LLM
// authors none of it (pure, client-owned).

// A valuable handed over toward a purchase is credited at exactly what the town
// would pay for it in coin (sellValuable: worth × (1 + standing premium + prize
// premium)). So the troc is "pay with goods instead of gold, equivalently" —
// never a worse deal than selling then buying, never a trap. `prize` is the trade
// good the world's locals covet (prizedBy(state.seed)); pass it so a prized good
// trades in at the same premium it would sell for — keeping the parity invariant.
export function tradeInValue(item: Item, node: MapNode, prize?: TradeGood): number {
  if (item.kind !== 'valuable') return 0;
  const isSettlement = node.kind === 'town' || node.kind === 'village';
  const bonus = (prize && isSettlement && item.trade === prize) ? PRIZE_PREMIUM : 0;
  return Math.max(1, Math.floor((item.value ?? 0) * (1 + repDiscount(node) + bonus)));
}

// Asking price by kind × rarity, discounted by local standing (never a surcharge).
// `craft` (the world's local specialty kind) shaves a further regional discount off
// goods of that kind — abundant where they are made. Omit it for the neutral price
// (keeps every existing caller's behaviour unchanged).
const KIND_BASE: Record<string, number> = { potion: 16, gear: 44, trinket: 95 };
const RARITY_MULT: Record<string, number> = { common: 1, fine: 2, masterwork: 3, fabled: 4 };
export const SPECIALTY_DISCOUNT = 0.2; // off goods the locals craft themselves
export function askPrice(item: Item, node: MapNode, craft?: ShopKind): number {
  const base = KIND_BASE[item.kind] ?? 30;
  const mult = RARITY_MULT[item.rarity ?? 'common'] ?? 1;
  const local = craft && item.kind === craft ? SPECIALTY_DISCOUNT : 0;
  return Math.max(1, Math.floor(base * mult * (1 - repDiscount(node) - local)));
}

// Which nodes run a trade post: the enterable settlements (town/village), matching
// where the rest of the settlement UI (standing, the interior screen) appears.
export function canBarter(node: MapNode | undefined): boolean {
  return !!node && (node.kind === 'town' || node.kind === 'village');
}

export interface StockEntry { item: Item; price: number; }

// The merchant's deterministic stock: stable per node id (the same goods every
// visit until bought), variety scaled by settlement size. Goods already bought
// (node.shopSold) drop off the shelf. Trinkets the party already carries are
// skipped (no point). Ids are stable (`shop:<node>:<i>`) so a purchase can be
// addressed across UI re-renders.
const STOCK_SIZE: Record<string, number> = { town: 4, village: 3 };
export function merchantStock(node: MapNode | undefined, state: RpgState): StockEntry[] {
  if (!node || !canBarter(node)) return [];
  const rng = makeRng(seedFrom(`shop:${node.id}`));
  const danger = 2 + (state.ngPlus ?? 0);
  const n = STOCK_SIZE[node.kind] ?? 2;
  const sold = new Set(node.shopSold ?? []);
  const craft = localCraft(state.seed, state.peopleId);   // the kind these locals make cheaply
  const out: StockEntry[] = [];
  for (let i = 0; i < n; i++) {
    const roll = rng();
    let item: Item;
    if (roll < 0.45) item = makePotion(rng, danger);
    else if (roll < 0.85) item = makeGear(rng, danger, false);
    else item = makeTrinket(TRINKET_IDS[Math.floor(rng() * TRINKET_IDS.length)]);
    item.id = `shop:${node.id}:${i}`;            // stable, addressable
    if (sold.has(item.id)) continue;             // already bought
    if (item.kind === 'trinket' && item.trinket && hasTrinket(state, item.trinket)) continue;
    out.push({ item, price: askPrice(item, node, craft) });
  }
  return out;
}

export interface BarterResult { state: RpgState; note: string; ok: boolean; }

// Buy one stocked good, paying with any mix of carried valuables (trade-in) and
// gold. Atomic + player-fair: never goes into debt, surplus trade-in is refunded
// as gold change, the good is delivered through the loot path (gear auto-equips,
// trinket joins the satchel) and the merchant remembers the sale.
export function barter(prev: RpgState, nodeId: string, buyId: string, offerItemIds: string[] = []): BarterResult {
  const node0 = prev.nodes[nodeId];
  if (!canBarter(node0)) return { state: prev, note: 'No trade post here.', ok: false };
  const entry = merchantStock(node0, prev).find(e => e.item.id === buyId);
  if (!entry) return { state: prev, note: 'That is no longer for sale.', ok: false };

  // Value the trade-in: only valuables in the satchel count; ignore unknown ids.
  const offers = offerItemIds
    .map(id => (prev.inventory || []).find(i => i.id === id && i.kind === 'valuable'))
    .filter((i): i is Item => !!i);
  const prize = prizedBy(prev.seed, prev.peopleId);
  const credit = offers.reduce((s, it) => s + tradeInValue(it, node0!, prize), 0);

  const price = entry.price;
  const goldNeed = Math.max(0, price - credit);
  if (prev.gold < goldNeed) {
    return { state: prev, note: `${entry.item.name} costs ${price} gold; your offer falls ${goldNeed - prev.gold} short.`, ok: false };
  }

  const state = clone(prev);
  const here = state.nodes[nodeId];
  // Hand over the offered valuables, freeing their satchel bulk.
  const offerIds = new Set(offers.map(o => o.id));
  state.inventory = state.inventory.filter(i => !offerIds.has(i.id));
  // Pay the gold remainder; return any trade-in surplus as change (player-fair).
  state.gold -= goldNeed;
  if (credit > price) state.gold += credit - price;
  // The good leaves the merchant's shelf; a paying patron earns goodwill.
  here.shopSold = [...(here.shopSold ?? []), entry.item.id];
  addRep(here, REP_PATRON);
  // Deliver via the loot path (gear equips, trinket/potion ride the satchel).
  const got = applyLoot(state, { items: [{ ...entry.item }], gold: 0 });
  const paid = offers.length
    ? `${offers.length} valuable${offers.length > 1 ? 's' : ''}${goldNeed ? ` + ${goldNeed} gold` : ''}`
    : `${goldNeed} gold`;
  const note = `Bartered ${paid} for ${entry.item.name}. ${got}`;
  state.log.push(note);
  return { state, note, ok: true };
}

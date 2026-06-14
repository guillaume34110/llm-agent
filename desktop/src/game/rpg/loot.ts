import type { RpgState, Item, ItemRarity, StatKey } from './types';
import { uid } from './ids';
import { clone } from './clone';
import { STAT_KEYS, statProfile } from './character';
import { repDiscount } from './reputation';
import { AFFLICTIONS } from './afflictions';
import { adjustMorale, MORALE_MAX } from './morale';
import { TRADE_GOODS, TRADE_LABEL, prizedBy } from './peoples';
import type { TradeGood } from './peoples';

// A town that covets a trade good pays this much over the odds for it (on top of
// the standing premium). Player-favourable: only ever raises the sale, never cuts.
export const PRIZE_PREMIUM = 0.25;

// ── Loot (treasure rooms + boss kills) ───────────────────────────────────────
// Potions come in three magnitudes; the name is picked by how much it heals so
// the satchel reads honestly (a "Minor" never out-heals a "Greater"). Vitality
// tonics raise a member's max HP permanently instead of healing on use.
const POTION_NAMES = ['Healing Draught', 'Vial of Mending', 'Elixir of Vigor', 'Restorative Tonic'];
const POTION_PREFIX: [number, string][] = [[14, 'Minor'], [22, ''], [Infinity, 'Greater']];
const VITALITY_NAMES = ['Tonic of Vitality', 'Heartwood Elixir', 'Draught of Endurance', 'Bloodroot Brew'];
// Remedies cure an affliction (a road-side alternative to a full camp rest), so
// the party can press on without bedding down. Roughly 1-in-5 restoratives.
const REMEDY_NAMES = ['Clearmind Draught', 'Sage Smelling-Salts', 'Lucid Tincture', 'Steadying Brew', 'Calming Poultice'];
const REMEDY_CHANCE = 0.2;
// Cordials lift the whole party's resolve (morale) instead of mending a body —
// a road-side answer to a fraying expedition. Another ~1-in-6 of restoratives.
const CORDIAL_NAMES = ['Spiced Cordial', 'Hearthfire Mead', 'Pilgrim’s Comfort', 'Bracing Bitters', 'Camphor Cordial'];
const CORDIAL_CHANCE = 0.18;

const GEAR_BY_STAT: Record<StatKey, string[]> = {
  might: ['Iron Pauldrons', 'Warblade', 'Bracers of Force', 'Oathkeeper Shield', 'Gauntlets of Wrath', 'Cleaver of Ruin', 'Bulwark Plate'],
  agility: ['Boots of Haste', 'Twin Daggers', 'Cloak of the Wind', 'Shadowstep Ring', 'Quickdraw Quiver', 'Feathered Greaves', 'Slipstream Sash'],
  wits: ['Scholar’s Circlet', 'Tome of Secrets', 'Ring of Insight', 'Lens of Truth', 'Runed Spellbook', 'Crown of Clarity', 'Astral Codex'],
  spirit: ['Blessed Amulet', 'Sage’s Stole', 'Charm of Grace', 'Sigil of Faith', 'Reliquary Pendant', 'Halo Band', 'Vestments of Dawn'],
};
// Vitality gear is stat-agnostic — any member can wear it for raw toughness.
const VITALITY_GEAR = ['Bear Pendant', 'Ironheart Talisman', 'Stoneblood Ring', 'Aegis Brooch', 'Lifebinder Charm'];

// Cosmetic quality woven into the name; also scales the bonus. Higher danger and
// boss kills bias toward the better tiers. All client-owned numbers.
const RARITY_PREFIX: Record<ItemRarity, string> = {
  common: '', fine: 'Fine', masterwork: 'Masterwork', fabled: 'Fabled',
};
const RARITY_MULT: Record<ItemRarity, number> = { common: 1, fine: 2, masterwork: 3, fabled: 4 };

export function rollRarity(rng: () => number, danger: number, big: boolean): ItemRarity {
  const r = rng() + (big ? 0.35 : 0) + danger * 0.1;
  if (r >= 1.05) return 'fabled';
  if (r >= 0.8) return 'masterwork';
  if (r >= 0.5) return 'fine';
  return 'common';
}

function withPrefix(prefix: string, name: string): string {
  return prefix ? `${prefix} ${name}` : name;
}

export function makePotion(rng: () => number, danger: number): Item {
  // A fraction of restoratives are remedies — they purge an affliction rather
  // than mend wounds (used from the satchel via usePotion, like any potion).
  if (rng() < REMEDY_CHANCE) {
    return {
      id: uid('item'), kind: 'potion', remedy: true,
      name: REMEDY_NAMES[Math.floor(rng() * REMEDY_NAMES.length)],
      desc: 'Clears one ally’s affliction.',
    };
  }
  // A cordial steadies the whole party's nerve (morale) rather than a wound.
  if (rng() < CORDIAL_CHANCE) {
    const morale = 14 + Math.floor(rng() * 11);   // +14..24 party morale
    return {
      id: uid('item'), kind: 'potion', morale,
      name: CORDIAL_NAMES[Math.floor(rng() * CORDIAL_NAMES.length)],
      desc: `Lifts the party's resolve (+${morale} morale).`,
    };
  }
  const heal = 8 + danger * 2 + Math.floor(rng() * 6);
  const prefix = POTION_PREFIX.find(([cap]) => heal <= cap)![1];
  const base = POTION_NAMES[Math.floor(rng() * POTION_NAMES.length)];
  return {
    id: uid('item'), kind: 'potion',
    name: withPrefix(prefix, base),
    desc: `Heals the most wounded ally (+${heal} HP).`,
    heal,
  };
}

export function makeGear(rng: () => number, danger: number, big: boolean): Item {
  const rarity = rollRarity(rng, danger, big);
  const mult = RARITY_MULT[rarity];
  // 1-in-4 drops are vitality gear (max-HP) rather than a stat boon.
  if (rng() < 0.25) {
    const hp = 3 * mult + Math.floor(rng() * 3);
    const base = VITALITY_GEAR[Math.floor(rng() * VITALITY_GEAR.length)];
    return {
      id: uid('item'), kind: 'gear', rarity,
      name: withPrefix(RARITY_PREFIX[rarity], base),
      desc: `+${hp} max HP`,
      hp,
    };
  }
  const stat = STAT_KEYS[Math.floor(rng() * STAT_KEYS.length)];
  const bonus = mult;
  const base = GEAR_BY_STAT[stat][Math.floor(rng() * GEAR_BY_STAT[stat].length)];
  return {
    id: uid('item'), kind: 'gear', rarity,
    name: withPrefix(RARITY_PREFIX[rarity], base),
    desc: `+${bonus} ${stat}`,
    stat, bonus,
  };
}

// ── Valuables (the haul to carry home — CE2's bring-back-treasure pressure) ───
// Pure treasure: no combat use, just worth. Each carries a `value` (gold-equiv)
// and a `bulk` (satchel weight). Hauling valuables home is what drives campaign
// fame and refills the purse when sold at a settlement. Deadlier sites and boss
// kills yield richer, heavier prizes. All numbers client-owned (the LLM never
// authors a worth) — this is the score you race rivals to amass.
const VALUABLE_NAMES: Record<ItemRarity, string[]> = {
  common: ['Tarnished Locket', 'Brass Idol', 'Coin Hoard', 'Carved Trinket', 'Bundle of Pelts', 'Clay Votive'],
  fine: ['Silver Chalice', 'Jade Figurine', 'Amber Pendant', 'Engraved Goblet', 'Ivory Comb', 'Bronze Ewer'],
  masterwork: ['Gilded Reliquary', 'Ruby Diadem', 'Lacquered Music Box', 'Ceremonial Mask', 'Brass Astrolabe', 'Pearl Censer'],
  fabled: ['Crown of a Lost King', 'Star-Sapphire Orb', 'Throne-Room Tapestry', 'Codex of the Ancients', 'Sceptre of the Deep', 'Aurelian Sun-Disc'],
};
const VALUABLE_VALUE: Record<ItemRarity, number> = { common: 25, fine: 60, masterwork: 140, fabled: 320 };
const VALUABLE_BULK: Record<ItemRarity, number> = { common: 1, fine: 2, masterwork: 3, fabled: 4 };

export function makeValuable(rng: () => number, danger: number, big: boolean): Item {
  const rarity = rollRarity(rng, danger, big);
  const base = VALUABLE_VALUE[rarity];
  const value = base + Math.floor(rng() * base * 0.5) + danger * 8; // jitter + a danger premium
  const names = VALUABLE_NAMES[rarity];
  const trade: TradeGood = TRADE_GOODS[Math.floor(rng() * TRADE_GOODS.length)];
  return {
    id: uid('item'), kind: 'valuable', rarity,
    name: withPrefix(RARITY_PREFIX[rarity], names[Math.floor(rng() * names.length)]),
    desc: `A prize worth ~${value}g. Haul it home for renown, or sell it dearest where ${TRADE_LABEL[trade]} is prized.`,
    value, bulk: VALUABLE_BULK[rarity], trade,
  };
}

export interface Loot { items: Item[]; gold: number; }

export function rollLoot(rng: () => number, danger: number, big: boolean): Loot {
  const items: Item[] = [makePotion(rng, danger)];
  if (big || rng() < 0.4 + danger * 0.12) items.push(makeGear(rng, danger, big));
  // The haul: every cache holds at least one valuable; deadlier sites and bosses
  // pile on more. This is the bring-it-home treasure that drives campaign fame.
  const extra = rng() < 0.3 + danger * 0.15 ? 1 : 0;
  const valuables = (big ? 2 : 1) + extra;
  for (let i = 0; i < valuables; i++) items.push(makeValuable(rng, danger, big));
  // Bosses occasionally drop a vitality tonic on top (a lasting reward).
  if (big && rng() < 0.5) {
    const hp = 4 + danger + Math.floor(rng() * 4);
    items.push({
      id: uid('item'), kind: 'gear',
      name: VITALITY_NAMES[Math.floor(rng() * VITALITY_NAMES.length)],
      desc: `+${hp} max HP`,
      hp,
    });
  }
  const gold = (big ? 40 : 12) + danger * 6 + Math.floor(rng() * (10 + danger * 8));
  return { items, gold };
}

// Apply loot to the running state: gold to the purse, potions to the satchel,
// gear permanently boons the member it best suits. Returns a one-line summary.
export function applyLoot(state: RpgState, loot: Loot): string {
  state.gold += loot.gold;
  const parts: string[] = [`${loot.gold} gold`];
  for (const it of loot.items) {
    if (it.kind === 'gear' && it.hp) {
      // Vitality gear: stat-agnostic toughness → the member with the lowest cap.
      const owner = [...state.party].filter(c => c.alive).sort((a, b) => a.maxHp - b.maxHp)[0]
        || state.party[0];
      owner.maxHp += it.hp;
      owner.hp = Math.min(owner.maxHp, owner.hp + it.hp);
      it.ownerId = owner.id;
      parts.push(`${it.name} (+${it.hp} max HP for ${owner.name})`);
    } else if (it.kind === 'gear' && it.stat && it.bonus) {
      const owner = state.party.find(c => c.alive && statProfile(c.className).key === it.stat)
        || state.party.find(c => c.alive) || state.party[0];
      owner.stats[it.stat] += it.bonus;
      it.ownerId = owner.id;
      parts.push(`${it.name} (+${it.bonus} ${it.stat} for ${owner.name})`);
    } else if (it.kind === 'valuable') {
      // Carry-cap tension: a full satchel forces a choice. A richer prize bumps the
      // least valuable one already carried; a poorer prize is left in the dark.
      const cap = satchelCap(state);
      const bulk = it.bulk ?? 1;
      if (satchelBulk(state) + bulk > cap) {
        const worst = state.inventory.filter(x => x.kind === 'valuable')
          .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];
        if (worst && (worst.value ?? 0) < (it.value ?? 0)) {
          state.inventory = state.inventory.filter(x => x.id !== worst.id);
          state.inventory.push(it);
          parts.push(`${it.name} (worth ${it.value}g — dropped ${worst.name} to make room)`);
        } else {
          parts.push(`${it.name} (worth ${it.value}g — left behind, the satchel is full)`);
        }
      } else {
        state.inventory.push(it);
        parts.push(`${it.name} (worth ${it.value}g)`);
      }
      continue;
    } else {
      parts.push(it.name);
    }
    state.inventory.push(it);
  }
  return `You recover ${parts.join(', ')}.`;
}

// ── Satchel capacity + selling (CE2 inventory management) ─────────────────────
// Only valuables carry bulk; potions, gear-boons and trinkets ride free. Capacity
// grows with the band — more hands haul more home. When full, a richer find bumps
// a lesser one (see applyLoot); poorer finds are left behind. Selling a valuable
// at a settlement frees its bulk and turns its worth into gold. Client-owned.
export const SATCHEL_BASE_CAP = 6;
export const SATCHEL_CAP_PER_MEMBER = 3;
export function satchelCap(state: RpgState): number {
  const hands = Math.max(1, state.party.filter(c => c.alive).length);
  return SATCHEL_BASE_CAP + hands * SATCHEL_CAP_PER_MEMBER;
}
export function satchelBulk(state: RpgState): number {
  return (state.inventory || []).reduce((s, i) => s + (i.kind === 'valuable' ? (i.bulk ?? 1) : 0), 0);
}
// Total worth of the valuables carried right now — the haul that drives fame.
export function satchelValue(state: RpgState): number {
  return (state.inventory || []).reduce((s, i) => s + (i.kind === 'valuable' ? (i.value ?? 0) : 0), 0);
}

// Sell a valuable at a settlement: its worth becomes gold (a town that likes you
// pays a premium — the rep curve raises the sale price up to +30%). Frees its bulk.
export function sellValuable(prev: RpgState, itemId: string, nodeId: string): { state: RpgState; note: string } {
  const idx = (prev.inventory || []).findIndex(i => i.id === itemId && i.kind === 'valuable');
  if (idx < 0) return { state: prev, note: '' };
  const state = clone(prev);
  const node = state.nodes[nodeId];
  const it = state.inventory[idx];
  const premium = node ? repDiscount(node) : 0;   // reuse the standing curve as a sale bonus
  // The locals covet a particular trade good; sell its kind here and they pay over
  // the odds (settlements only — a wild node has no market to bid it up).
  const isSettlement = node && (node.kind === 'town' || node.kind === 'village');
  const prized = isSettlement && it.trade && it.trade === prizedBy(state.seed, state.peopleId);
  const bonus = prized ? PRIZE_PREMIUM : 0;
  const paid = Math.max(1, Math.floor((it.value ?? 0) * (1 + premium + bonus)));
  state.gold += paid;
  state.inventory.splice(idx, 1);
  const note = prized
    ? `Sold ${it.name} for ${paid} gold — the locals prize ${TRADE_LABEL[it.trade as TradeGood]}.`
    : `Sold ${it.name} for ${paid} gold.`;
  state.log.push(note);
  return { state, note };
}

// Use a potion from the satchel: a remedy purges an afflicted ally's malady; a
// plain restorative heals the most-wounded living ally.
export function usePotion(prev: RpgState, itemId: string): { state: RpgState; note: string } {
  const idx = (prev.inventory || []).findIndex(i => i.id === itemId && i.kind === 'potion');
  if (idx < 0) return { state: prev, note: '' };
  const state = clone(prev);
  const pot = state.inventory[idx];
  if (pot.remedy) {
    // Cure the first afflicted ally; if none is ailing, don't waste the dose.
    const sick = state.party.find(c => c.alive && c.affliction);
    if (!sick) return { state: prev, note: 'No one is afflicted — best saved.' };
    const label = AFFLICTIONS[sick.affliction!].label;
    sick.affliction = undefined;
    state.inventory.splice(idx, 1);
    const note = `${sick.name} takes ${pot.name}, shaking off ${label}.`;
    state.log.push(note);
    return { state, note };
  }
  if (pot.morale) {
    // Lift party resolve; if it's already brimming, save the cordial for later.
    if (state.morale >= MORALE_MAX) return { state: prev, note: 'Spirits are already high — best saved.' };
    const gained = adjustMorale(state, pot.morale);
    state.inventory.splice(idx, 1);
    const note = `The party shares ${pot.name} (+${gained} morale).`;
    state.log.push(note);
    return { state, note };
  }
  const target = state.party.filter(c => c.alive)
    .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
  if (!target) return { state: prev, note: '' };
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + (pot.heal ?? 10));
  state.inventory.splice(idx, 1);
  const note = `${target.name} drinks ${pot.name} (+${target.hp - before} HP).`;
  state.log.push(note);
  return { state, note };
}

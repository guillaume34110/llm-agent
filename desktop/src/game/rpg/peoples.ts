import { makeRng, seedFrom } from './dice';

// ── Peoples / native cultures (CE2's regional population diversity) ──────────
// One expedition = one people. The world's seed picks a single native culture
// that frames every settlement: the manner locals show outsiders, what they
// prize, how a stranger is first met. Pure thematic flavour — the code owns the
// deterministic pick from a closed set; the LLM authors the actual lines from
// the persona it's handed. No numbers here (client-owns-numbers stays intact).

// The closed set of trade goods a culture can covet. A valuable carries one of
// these tags; sell it where the locals prize that good and it fetches a premium
// (CE2's regional economy — the player learns to carry the right haul to the
// right buyer). The code owns the categories + the bonus; the LLM never sees them.
export type TradeGood = 'relics' | 'gems' | 'craftwork' | 'furs' | 'curios';
export const TRADE_GOODS: TradeGood[] = ['relics', 'gems', 'craftwork', 'furs', 'curios'];
// Player-facing label for a trade tag (kept terse for the satchel line).
export const TRADE_LABEL: Record<TradeGood, string> = {
  relics: 'relics', gems: 'gemwork', craftwork: 'fine craft', furs: 'furs & hides', curios: 'curios',
};

// The shop good-kinds a settlement can specialise in. A people CRAFTS one kind —
// the buy-side complement to `prize` (what they pay a premium FOR): the goods a
// region makes itself sell cheaper there (CE2's regional economy — abundant where
// produced, dear where scarce). The code owns the kinds + the discount.
export type ShopKind = 'potion' | 'gear' | 'trinket';

export interface People {
  id: string;
  name: string;      // what they call themselves (feeds the NPC persona)
  manner: string;    // how they carry themselves toward outsiders
  prizes: string;    // what they value (colours trade talk + dilemmas)
  greeting: string;  // the stock first move the NPC's manner builds on
  // Starting standing the party enjoys at this people's settlements (CE2's "good
  // reputation raises starting standing"). Stays inside the reputation band; a
  // negative start only forfeits the head-start discount (repDiscount floors at
  // 0), never a surcharge — so this can only help the player or be neutral.
  standing: number;
  // The trade good these locals covet — valuables of this tag sell for a premium
  // at their settlements (the mechanical hook behind the `prizes` flavour line).
  prize: TradeGood;
  // The shop good-kind these locals make themselves — items of this kind cost less
  // on their shelves (the buy-side of the regional economy; see ShopKind).
  craft: ShopKind;
}

// A closed, hand-authored set — worlds are free-text, so these cultures are
// evocative-but-generic enough to drape over any conjured land.
export const PEOPLES: People[] = [
  { id: 'highland', name: 'the Highland clans', manner: 'proud and blunt, slow to trust an outsider', prizes: 'iron, kept oaths, and a guest well-housed', greeting: 'sizes you up in silence before a word is spent', standing: -4, prize: 'craftwork', craft: 'gear' },
  { id: 'rivers', name: 'the River folk', manner: 'easy and talkative, quick to barter', prizes: 'fair trade, news from downstream, and salt', greeting: 'hails you with an open hand and a price already in mind', standing: 10, prize: 'furs', craft: 'trinket' },
  { id: 'dunes', name: 'the Dune nomads', manner: 'courteous and watchful, bound by the law of water', prizes: 'water shared, safe passage, and an honest map', greeting: 'offers the cup before any question', standing: 4, prize: 'gems', craft: 'potion' },
  { id: 'mire', name: 'the Mire dwellers', manner: 'wary and superstitious, fond of riddles', prizes: 'charms, kept secrets, and what the fog gives back', greeting: 'speaks around the matter, never straight at it', standing: -6, prize: 'curios', craft: 'trinket' },
  { id: 'forge', name: 'the Forge towns', manner: 'gruff and practical, respect earned by work', prizes: 'good steel, a fair contract, and no idlers', greeting: 'asks your trade before your name', standing: 2, prize: 'craftwork', craft: 'gear' },
  { id: 'pilgrims', name: 'the Pilgrim orders', manner: 'solemn and generous, suspicious of greed', prizes: 'alms, old relics, and a soul mended', greeting: 'blesses the road behind you, then weighs the one ahead', standing: 6, prize: 'relics', craft: 'potion' },
  { id: 'steppe', name: 'the Steppe riders', manner: 'frank and restless, loyal to the herd', prizes: 'fast horses, open sky, and a debt repaid', greeting: 'reads your mount and your gear in one glance', standing: 0, prize: 'furs', craft: 'gear' },
  { id: 'coast', name: 'the Coastal traders', manner: 'shrewd and worldly, every favour ledgered', prizes: 'foreign coin, rare goods, and a standing account', greeting: 'greets you warmly and counts you twice as carefully', standing: 12, prize: 'gems', craft: 'trinket' },
  { id: 'canopy', name: 'the Canopy weavers', manner: 'soft-spoken and unseen, at home in the high green', prizes: 'rare dyes, woven cloth, and a debt of silence', greeting: 'watches from the leaves before stepping into view', standing: 0, prize: 'curios', craft: 'trinket' },
  { id: 'frost', name: 'the Frosthold kin', manner: 'hardy and sparing of words, generous with the hearth', prizes: 'warm furs, kept fire, and a guest fed before asked', greeting: 'waves you in from the cold before any bargain', standing: 8, prize: 'furs', craft: 'gear' },
  { id: 'ash', name: 'the Ashland wardens', manner: 'grim and exacting, schooled by the burning ground', prizes: 'unearthed relics, fireglass, and a promise kept', greeting: 'names the dead before they name a price', standing: -5, prize: 'relics', craft: 'potion' },
  { id: 'veld', name: 'the Veld drummers', manner: 'loud and welcoming, every deal sealed with a feast', prizes: 'bright gems, song, and a stranger made kin', greeting: 'drums you in and pours before the talk', standing: 9, prize: 'gems', craft: 'potion' },
  { id: 'delvers', name: 'the Underearth delvers', manner: 'terse and shrewd, blinking in the open sun', prizes: 'raw ore, cut stone, and an honest weight', greeting: 'tests your lamp-oil before your coin', standing: 2, prize: 'gems', craft: 'gear' },
  { id: 'orchard', name: 'the Orchard holds', manner: 'warm and unhurried, rich in season, poor in haste', prizes: 'fine craft, cider, and news worth the telling', greeting: 'sets a place at the table before the haggling', standing: 7, prize: 'craftwork', craft: 'potion' },
];

// The world's people, fixed for the whole expedition (deterministic per seed).
export function peopleOf(seed: number): People {
  const rng = makeRng(seedFrom('people:' + seed));
  return PEOPLES[Math.floor(rng() * PEOPLES.length)];
}

// Look a people up by its id — the way a destination that fixed its locals (CE2
// regional economy: the player picks a run by who buys there) names them. Unknown
// id → undefined, so callers fall back to the seed roll.
export function peopleById(id: string): People | undefined {
  return PEOPLES.find(p => p.id === id);
}

// The authoritative resolver for "who lives in this world". A forced peopleId (a
// destination pinned its locals, then state.peopleId carried it) wins; absent or
// unknown it degrades to the per-seed roll — so omitting the argument reproduces
// exactly what peopleOf(seed) returned before this feature (forward-compat).
export function peopleFor(seed: number, peopleId?: string): People {
  return (peopleId ? peopleById(peopleId) : undefined) || peopleOf(seed);
}

// The starting reputation a fresh expedition carries at this world's settlements.
export function peopleStanding(seed: number, peopleId?: string): number {
  return peopleFor(seed, peopleId).standing;
}

// The trade good this world's locals covet — valuables of this tag sell dearer here.
export function prizedBy(seed: number, peopleId?: string): TradeGood {
  return peopleFor(seed, peopleId).prize;
}

// The shop good-kind this world's locals make themselves — that kind sells cheaper
// on their shelves (the buy-side regional discount).
export function localCraft(seed: number, peopleId?: string): ShopKind {
  return peopleFor(seed, peopleId).craft;
}

// One compact line for the dialogue context the NPC reasons from — gives the
// model a culture to inhabit without ever touching a game number.
export function peopleFlavor(seed: number, peopleId?: string): string {
  const p = peopleFor(seed, peopleId);
  return `Locals here are ${p.name}: ${p.manner}; they prize ${p.prizes}. A stranger ${p.greeting}.`;
}

import type { RpgSetupResult, RpgSetupHero } from '../../api';
import {
  RpgState, MapNode, NodeKind, MapSize, Difficulty, Character, StatKey, ActionTag, SceneChoice,
  Enemy, CombatState, CombatAction, DialogueEffect, DialogueTurn,
  DungeonRoom, RoomKind, Item, ItemRarity, VeteranRecord, RoundRoll,
  TravelState, TravelEvent, DilemmaState, DilemmaOption, DilemmaDelta,
  DicePoolState, PoolDie, DiceCheckKind,
  TraitId, CompanionTrait, AfflictionId, Affliction, StatusId, StatusEffect,
  TrinketId, Trinket, Discovery,
  QuestObjective, Rival, RivalDisposition, RivalEncounterState, RivalOption,
  SponsorId,
} from './types';
import { makeRng, seedFrom, skillCheck, roll, poolBonus, rollPoolDie, pickRng } from './dice';
import {
  rollCombatPool, rollEnemyPool, assignDie, rerollUnassigned, resolveCombat,
  COMBAT_REROLL_BASE, COMBAT_REROLL_STEP, COMBAT_MAX_REROLLS,
} from './combat-dice';
export * from './combat-dice';
// Leaf modules extracted from this file. They hold the pure, client-owned number
// logic (no cross-section deps) and are unit-tested in isolation. We import the
// symbols this file still calls internally, and re-export each module below so the
// public surface (everything RpgConsole imports from './state') stays unchanged.
import { uid } from './ids';
import { clone } from './clone';
export * from './clone';
import { DIFFICULTY, diffOf, type DiffParams } from './difficulty';
import { MORALE_MAX, clampMorale, adjustMorale, moraleBand, type MoraleBand } from './morale';
import { PROV_MAX, PROV_COST, clampProv, legProvisionCost } from './provisions';
import { xpForLevel } from './progression';
export * from './ids';
export * from './difficulty';
export * from './morale';
export * from './provisions';
export * from './progression';
import { TRAITS, TRAIT_IDS, TOUGH_HP, partyHasTrait, HAGGLER_PRICE_MUL, braveOffenseBonus } from './traits';
import { TRINKETS, TRINKET_IDS, CHARM_AFFLICT_MUL, TALISMAN_WARD, hasTrinket, makeTrinket, lanternDrainMul, snareRationCut, bannerCampMorale, lodestarGoldMul } from './trinkets';
export * from './traits';
export * from './trinkets';
import { NAMES, STAT_KEYS, statProfile, makeCharacter, recruitCost } from './character';
import {
  settlementRep, repDiscount, provPriceAt, recruitPriceAt, addRep,
  creditRegionForClear, gratitudeLine, REP_CLEAR, REP_PATRON, REP_HIRE, REP_MIN, REP_MAX,
} from './reputation';
import { partyBest, partyPower, partyDamagePerRound, partyAvgLevel } from './party-stats';
import { teamSynergy } from './synergy';
export * from './character';
export * from './reputation';
export * from './party-stats';
export * from './synergy';
import {
  AFFLICT_MORALE, FEVERISH_EXTRA, hasAffliction, tickAfflictions,
  ravenousRationExtra, cursedBoonMul,
} from './afflictions';
export * from './afflictions';
import { makePotion, rollLoot, applyLoot, satchelValue } from './loot';
export * from './barter';
export * from './loot';
export * from './persistence';
export * from './veterans';
import { computeFame, loadLogbook, saveLogbook, type Logbook } from './logbook';
export * from './logbook';
import { questSatisfied, OBJECTIVES, RELIC_NAMES, maybeWinQuest } from './quest';
export * from './quest';
import { loadHub, sponsorBoon, loyaltyBoon, unlockedRecruits, perkEffects, SPONSOR_IDS, SPONSORS, CAMPAIGN_RECRUIT_CAP, type Campaign } from './meta';
export * from './meta';
export * from './worlds';
import { currentNode, neighbors, partyAlive, legalTags, fallbackChoices } from './queries';
export * from './queries';
import { STATUS_META, addStatus, hasStatus, tickStatuses } from './status';
export * from './status';
import { spawnRivals, tickRivals, pressRivalsInPlace, maybeRivalEncounter, rivalNodeAt } from './rivals';
export * from './rivals';
import { maybeHallucinate } from './sanity';
export * from './sanity';
import { claimDiscovery, damageParty, grantXp, applyDilemmaDelta } from './mutations';
export * from './mutations';
import { rollDilemma } from './dilemmas';
export * from './dilemmas';
import { buildDicePool, poolHits, rerollMoraleCost, POOL_REROLL_BASE, POOL_REROLL_STEP } from './dice-pool';
export * from './dice-pool';
import { buildRooms, hasRoomsKind, ROOM_NAME, ROOM_BLURB } from './rooms';
export * from './rooms';
import { REQ_BY_SIZE, POI_PREFIX, POI_SUFFIX, POI_BLURB, FILL_KINDS, islandShape, scatter2D, d2, SIZE_TARGET, link } from './worldgen';
export * from './worldgen';
import { makeEnemies, makeBoss, nodeRoster } from './bestiary';
export * from './bestiary';
import { npcFor } from './npcs';
import { peopleFlavor, peopleFor } from './peoples';
import { rapportBonus } from './rapport';
export * from './npcs';
export * from './peoples';
export * from './exposition';
export * from './rapport';

// Flavour names for the landmarks that hold discoveries (seeded at world-build).
const LANDMARK_NAMES = [
  'a Sunken Shrine', 'a Forgotten Cairn', 'an Old Wayward Stone', 'a Hermit’s Grotto',
  'a Toppled Obelisk', 'a Mossy Reliquary', 'a Star-Marked Barrow', 'a Hollow Idol-Tree',
];

export function buildWorld(
  setup: RpgSetupResult, theme: string, heroIndex: number,
  size: MapSize = 'medium', difficulty: Difficulty = 'normal', veteran?: Character,
  sponsor?: { id: SponsorId; tier: number; name?: string; rank?: number },
  perks?: string[],
  forcedPeopleId?: string,
): RpgState {
  const seed = seedFrom(`${theme}|${setup.title}|${setup.intro}|${size}`);
  const rng = makeRng(seed);

  // 1. Spec list: the LLM-named anchors, then procedural POIs to fill a real map.
  type Spec = { name: string; kind: NodeKind; blurb: string };
  // Small worlds keep fewer anchors so the chosen scale actually holds.
  const anchorCap = size === 'small' ? 6 : 8;
  const anchors = setup.locations.slice(0, anchorCap);
  const specs: Spec[] = anchors.map(l => ({ name: l.name, kind: (l.kind as NodeKind) || 'wild', blurb: l.blurb }));
  const goalSpecIdx = Math.max(0, specs.length - 1);  // the LLM's last place = the deep goal
  const used = new Set(specs.map(s => s.name.toLowerCase()));
  const [lo, hi] = SIZE_TARGET[size];
  const target = Math.max(specs.length, lo + Math.floor(rng() * (hi - lo + 1)));
  while (specs.length < target) {
    const kind = pickRng(rng, FILL_KINDS);
    let name = '', tries = 0;
    do { name = `${pickRng(rng, POI_PREFIX)} ${pickRng(rng, POI_SUFFIX[kind])}`; tries++; }
    while (used.has(name.toLowerCase()) && tries < 8);
    used.add(name.toLowerCase());
    specs.push({ name, kind, blurb: pickRng(rng, POI_BLURB[kind]) });
  }

  // 2. Positions confined to the irregular island shape, then pick start
  //    (leftmost) + goal (farthest from start). The renderer draws the SAME shape
  //    as the coastline, so every place is on land and the island stays irregular.
  const pts = scatter2D(specs.length, rng, islandShape(seed));
  let startPt = 0;
  pts.forEach((p, i) => { if (p.x < pts[startPt].x) startPt = i; });
  let goalPt = 0;
  pts.forEach((p, i) => { if (d2(p, pts[startPt]) > d2(pts[goalPt], pts[startPt])) goalPt = i; });
  if (goalPt === startPt) goalPt = (startPt + 1) % pts.length;

  // 3. Bind specs → points: start spec → start point, goal spec → goal point.
  const order = specs.map(() => uid('node'));
  const specOf: number[] = new Array(pts.length);   // pointIdx → specIdx
  specOf[startPt] = 0;
  specOf[goalPt] = goalSpecIdx;
  let next = 0;
  for (let p = 0; p < pts.length; p++) {
    if (p === startPt || p === goalPt) continue;
    while (next === 0 || next === goalSpecIdx) next++;       // skip already-bound specs
    specOf[p] = next++;
  }

  const nodes: Record<string, MapNode> = {};
  const startNodeId = order[startPt];
  const goalNodeId = order[goalPt];
  // The world's people set the party's starting standing at every settlement
  // (CE2's "good reputation raises starting standing"). Floors at 0 below neutral
  // via repDiscount — a wary culture forfeits the head-start, never a surcharge.
  // The explorer's earned "Good Reputation" perks (Envoy/Diplomat) add a bounded
  // diplomacy bonus on top, clamped into the reputation band. Past deeds with
  // THIS world's people (persistent rapport) warm the welcome further — a culture
  // remembers your finest visit and grants a standing floor next time you return.
  const perkStanding = perks && perks.length ? perkEffects(perks).standing : 0;
  // Pin the world's people once: a destination may have fixed its locals (so its
  // economy board hint is authoritative); otherwise it's the per-seed roll. Every
  // downstream consumer reads state.peopleId so they all agree on one culture.
  const people = peopleFor(seed, forcedPeopleId);
  const rapport = rapportBonus(people.id);
  const startRep = Math.max(REP_MIN, Math.min(REP_MAX, people.standing + perkStanding + rapport));
  pts.forEach((pt, p) => {
    const spec = specs[specOf[p]];
    const isStart = p === startPt;
    const isGoal = p === goalPt;
    const isSettlement = spec.kind === 'town' || spec.kind === 'village';
    nodes[order[p]] = {
      id: order[p], name: spec.name, kind: spec.kind, blurb: spec.blurb,
      x: pt.x, y: pt.y, edges: [],
      danger: 0,  // set after the graph (BFS depth from start)
      discovered: isStart, scouted: isStart, visited: isStart, cleared: false,
      ...(isSettlement ? { reputation: startRep } : {}),
    };
    void isGoal;
  });

  // 4. Roads: connect each node to its 3 nearest, then a spanning tree so the
  //    whole world is reachable, then a few loops. A real, multi-route network.
  const K = 3;
  order.forEach((id, i) => {
    const near = order
      .map((jid, j) => ({ jid, d: i === j ? Infinity : d2(pts[i], pts[j]) }))
      .sort((a, b) => a.d - b.d);
    for (let k = 0; k < K && k < near.length; k++) link(nodes, id, near[k].jid);
  });
  const inTree = new Set<number>([startPt]);
  while (inTree.size < order.length) {
    let best: { i: number; j: number; d: number } | null = null;
    for (const i of inTree) {
      for (let j = 0; j < order.length; j++) {
        if (inTree.has(j)) continue;
        const d = d2(pts[i], pts[j]);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    if (!best) break;
    inTree.add(best.j);
    link(nodes, order[best.i], order[best.j]);
  }

  // 5. Danger from graph depth (hops from start), deeper kinds harder; goal capped at 3.
  const depth: Record<string, number> = { [startNodeId]: 0 };
  const q = [startNodeId];
  while (q.length) {
    const id = q.shift()!;
    for (const nb of nodes[id].edges) {
      if (depth[nb] === undefined) { depth[nb] = depth[id] + 1; q.push(nb); }
    }
  }
  const maxDepth = Math.max(1, ...Object.values(depth));
  for (const id of order) {
    const n = nodes[id];
    let d = Math.round((depth[id] ?? maxDepth) / maxDepth * 3);
    if (n.kind === 'dungeon' || n.kind === 'cave' || n.kind === 'ruin') d += 1;
    n.danger = id === startNodeId ? 0 : Math.min(3, Math.max(1, d));
  }
  nodes[goalNodeId].danger = 3;

  // The final boss carries a recommended level — the soft gate that makes the
  // farming zones matter: rush in under-levelled and the boss scales up against
  // you (see startCombat). Difficulty shifts the bar; NG+ adds at fight time.
  nodes[goalNodeId].reqLevel = Math.max(1, REQ_BY_SIZE[size] + DIFFICULTY[difficulty].reqDelta);
  nodes[goalNodeId].scouted = true;  // the quest finale is known from the outset (its marker + recommended level guide the run)
  // Open danger sites (not the goal, not a room-crawl) become farmable: once
  // cleared, the party can keep hunting them for XP + light loot to level up.
  for (const id of order) {
    const n = nodes[id];
    if (id !== goalNodeId && n.danger > 0 && !hasRoomsKind(n.kind)) n.farmable = true;
  }

  // 6. Carve a room-by-room crawl into every dungeon/cave/ruin (count scales with
  //    the chosen world size, capped at 15). The goal site always gets a crawl so
  //    the finale is a real descent to a boss.
  if (!hasRoomsKind(nodes[goalNodeId].kind)) {
    nodes[goalNodeId].kind = 'dungeon';  // the climax is always a crawl to a boss
  }
  for (const id of order) {
    const n = nodes[id];
    if (hasRoomsKind(n.kind)) {
      const rrng = makeRng(seedFrom(`rooms:${id}:${n.kind}:${size}`));
      n.rooms = buildRooms(n.kind, n.danger, size, rrng);
      n.roomIndex = 0;
    }
  }

  // 7. Seed map discoveries: a handful of landmarks scattered across the wild
  //    (never the start, the goal, or a settlement). Each yields one DISTINCT
  //    trinket, claimed when the party first arrives. Deterministic by world seed.
  {
    const drng = makeRng(seed ^ 0x5eed1a);
    const candidates = order.filter(id =>
      id !== startNodeId && id !== goalNodeId &&
      nodes[id].kind !== 'town' && nodes[id].kind !== 'village');
    // Fisher–Yates on a copy so the pick is stable yet spread across the map.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(drng() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = Math.min(TRINKET_IDS.length, candidates.length);
    for (let k = 0; k < count; k++) {
      const n = nodes[candidates[k]];
      const trinket = TRINKET_IDS[k];
      const place = LANDMARK_NAMES[Math.floor(drng() * LANDMARK_NAMES.length)];
      n.discovery = {
        id: uid('disc'), name: place, trinket,
        blurb: `${place} — and within, ${TRINKETS[trinket].name}.`,
        claimed: false,
      };
    }
  }

  // 8. Quest objective (client-owned, seeded): slay the boss, retrieve the relic,
  //    or both. For a retrieve/both run, flag the deepest treasure cache of the goal
  //    dungeon as relic-bearing (the boss room is never the relic — you may slip the
  //    relic out without facing the boss on a pure retrieve).
  const objective: QuestObjective = pickRng(makeRng(seed ^ 0x0b1ec7), OBJECTIVES);
  let relicName: string | undefined;
  if (objective !== 'slay') {
    const grooms = nodes[goalNodeId].rooms!;
    let ri = -1;
    for (let i = grooms.length - 1; i >= 0; i--) {
      if (grooms[i].kind === 'treasure') { ri = i; break; }
    }
    if (ri < 0) {
      // No cache carved — convert a middle room (never the entrance or the boss).
      ri = Math.min(grooms.length - 2, Math.max(1, Math.floor(grooms.length / 2)));
      const rng2 = makeRng(seedFrom(`relicroom:${goalNodeId}`));
      grooms[ri] = {
        ...grooms[ri], kind: 'treasure',
        name: ROOM_NAME.treasure[Math.floor(rng2() * ROOM_NAME.treasure.length)],
        blurb: ROOM_BLURB.treasure,
      };
    }
    grooms[ri].relic = true;
    relicName = pickRng(makeRng(seed ^ 0x9e71c0), RELIC_NAMES);
  }

  // 9. Rivals: one or two competing expeditions that race the party to the goal.
  //    Spawned away from both the start and the goal, each with a precomputed path
  //    and a difficulty-scaled pace. They only advance when the PARTY travels.
  // Fresh entropy for the outsider so identical worlds don't always field the same
  // rival; the spawned crew is persisted in state, so this stays replay-safe.
  const rivalEntropy = Math.floor(Math.random() * 0x7fffffff);
  const rivals = spawnRivals(nodes, order, startNodeId, goalNodeId, difficulty, seed, rivalEntropy);

  // Reveal the start's neighbours so the first roads out are visible.
  for (const nb of nodes[startNodeId].edges) nodes[nb].discovered = true;

  // Hero + companion pool: the chosen option becomes the hero, the other two
  // setup heroes become recruitable companions you may meet on the road.
  const idx = Math.max(0, Math.min(setup.heroes.length - 1, heroIndex));
  const heroName = NAMES[Math.floor(rng() * NAMES.length)];
  // A summoned veteran (won a prior run) becomes the hero, carrying their level
  // and stats forward, rested to full and with a fresh id; otherwise a level-1
  // hero is rolled from the chosen class.
  // A veteran keeps the trait they earned (or is assigned one if forged before
  // traits existed); their maxHp is already set, so a back-assigned `tough` grants
  // no retro HP — a deliberate edge for the rare legacy veteran.
  const hero = veteran
    ? { ...veteran, id: uid('hero'), isHero: true, hp: veteran.maxHp, xp: 0, alive: true, stats: { ...veteran.stats }, trait: veteran.trait ?? TRAITS[pickRng(rng, TRAIT_IDS)] }
    : makeCharacter(setup.heroes[idx], heroName, true, rng);
  // With a veteran leading, all three setup classes stay open as companions.
  const recruitPool: Character[] = (veteran ? setup.heroes : setup.heroes.filter((_, i) => i !== idx))
    .map(opt => makeCharacter(opt, NAMES[Math.floor(rng() * NAMES.length)], false, rng));
  // A backing club at rank opens its signature recruits into THIS world's hire
  // pool (CE2's rank-gated club stable). They lead the pool so the player meets
  // them first, but are still hired with gold or won in dialogue — access, not
  // free muscle. No sponsor / low rank → none added (non-regression).
  if (sponsor && SPONSOR_IDS.includes(sponsor.id) && sponsor.rank) {
    const stable = unlockedRecruits(sponsor.id, sponsor.rank)
      .map(rec => makeCharacter({ className: rec.className, blurb: rec.epithet }, NAMES[Math.floor(rng() * NAMES.length)], false, rng));
    recruitPool.unshift(...stable);
  }

  // Starting-kit bonuses: fold the backing club's outfitting (sponsorBoon) and the
  // explorer's earned perks (perkEffects) into one deterministic bonus. All numbers
  // are client-owned & bounded; the LLM contributes nothing here.
  let startGold = 0;
  const startInv: Item[] = [];
  let sponsorTag: { id: SponsorId; name: string } | undefined;
  let bonusGold = 0, bonusPotions = 0, bonusScout = 0, bonusHp = 0;
  if (sponsor && SPONSOR_IDS.includes(sponsor.id)) {
    const boon = sponsorBoon(sponsor.id, sponsor.tier);
    bonusGold += boon.gold;
    bonusPotions += boon.potions;
    bonusScout += boon.scout;
    // Earned-rank loyalty dividend, on the club's own axis (rank omitted → all zero,
    // so unsponsored/older callers and the NG+ ladder are unchanged).
    const loyal = loyaltyBoon(sponsor.id, sponsor.rank ?? 1);
    bonusGold += loyal.gold;
    bonusPotions += loyal.potions;
    bonusScout += loyal.scout;
    sponsorTag = { id: sponsor.id, name: (sponsor.name && sponsor.name.trim()) || SPONSORS[sponsor.id].name };
  }
  if (perks && perks.length) {
    const pe = perkEffects(perks);
    bonusGold += pe.gold;
    bonusPotions += pe.potions;
    bonusScout += pe.scout;
    bonusHp += pe.hp;
  }
  startGold = bonusGold;
  if (bonusPotions > 0) {
    const prng = makeRng(seed ^ 0x590b00);
    for (let i = 0; i < bonusPotions; i++) {
      const p = makePotion(prng, 1);
      startInv.push({ ...p, name: 'Warding Draught' });
    }
  }
  // Cartographer's survey: reveal the nearest still-unknown sites from the outset.
  if (bonusScout > 0) {
    const ranked = order
      .map((id, i) => ({ id, d: d2(pts[i], pts[startPt]) }))
      .filter(o => !nodes[o.id].discovered)
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < bonusScout && i < ranked.length; i++) {
      const n = nodes[ranked[i].id];
      n.discovered = true; n.scouted = true;
    }
  }
  // Perk toughness: a flat bump to the lead explorer's max HP (also healed to it).
  if (bonusHp > 0) {
    hero.maxHp += bonusHp;
    hero.hp = hero.maxHp;
  }

  return {
    version: 1,
    phase: 'world',
    difficulty,
    theme,
    title: setup.title,
    intro: setup.intro,
    seed,
    peopleId: people.id,
    step: 0,
    quest: {
      title: setup.quest.title,
      desc: setup.quest.desc,
      done: false,
      goalNodeId,
      objective,
      relicName,
      relicClaimed: objective === 'slay' ? undefined : false,
    },
    nodes,
    order,
    party: [hero],
    recruitPool,
    inventory: startInv,
    gold: startGold,
    sponsor: sponsorTag,
    ngPlus: 0,
    currentNodeId: startNodeId,
    log: [setup.intro],
    rumors: [],
    scene: null,
    dialogue: null,
    combat: null,
    travel: null,
    dilemma: null,
    rivals,
    rivalEncounter: null,
    dicePool: null,
    morale: MORALE_MAX,
    provisions: PROV_MAX,
  };
}

// ── Dungeon crawl (room-by-room screens) ─────────────────────────────────────

export function nodeRooms(node: MapNode): DungeonRoom[] | null {
  return node.rooms && node.rooms.length ? node.rooms : null;
}

// The room the party currently stands in (clamped to how deep they have descended).
export function currentRoom(node: MapNode): DungeonRoom | null {
  const rs = nodeRooms(node);
  if (!rs) return null;
  const i = Math.min(rs.length - 1, Math.max(0, node.roomIndex ?? 0));
  return rs[i];
}

// The SINGLE foe roster for one dungeon room — the same Enemy[] used to draw the
// room and to fight in it (display and combat can no longer disagree). Deterministic
// per room (stable ids), so the foe you click is the foe you fight; foes already
// felled (room.defeatedFoes) drop out, leaving the survivors standing on a re-entry.
export function roomRoster(node: MapNode, room: DungeonRoom, state: RpgState): Enemy[] {
  if (room.cleared) return [];
  const dead = new Set(room.defeatedFoes || []);
  if (room.kind === 'boss') {
    const all = makeBoss(node, makeRng(seedFrom(`rboss:${room.id}`)), state.ngPlus || 0, diffOf(state), state, `foe:${room.id}`);
    return all.filter(e => !dead.has(e.id));
  }
  if (room.kind !== 'combat') return [];
  const all = makeEnemies(node, makeRng(seedFrom(`rfoes:${room.id}`)), diffOf(state), state, `foe:${room.id}`);
  return all.filter(e => !dead.has(e.id));
}

// Compact situation a GM narrates a room from (kept tiny for a 3B model).
export function roomContext(state: RpgState, node: MapNode, room: DungeonRoom): string {
  const i = (node.roomIndex ?? 0) + 1;
  const total = node.rooms?.length ?? 1;
  const party = state.party.filter(c => c.alive).map(c => `${c.name}(${c.hp}/${c.maxHp})`).join(', ');
  return `Dungeon: ${node.name}. Room ${i}/${total}: ${room.name} (${room.kind}). ${room.blurb} Party: ${party}. Quest: ${state.quest.title}.`;
}

// Resolve a non-combat room (trap / treasure / puzzle / rest). Combat & boss
// rooms go through startCombat instead. Traps & puzzles never soft-lock: the room
// always clears, only the reward (or the harm) depends on the roll.
export function resolveRoom(prev: RpgState, nodeId: string): ActionResult {
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 2654435761);
  const node = state.nodes[nodeId];
  const room = currentRoom(node);
  let outcome = '';
  if (!room || room.cleared) {
    return { state: prev, outcome: '' };
  }
  const dc = 8 + node.danger * 3;
  switch (room.kind) {
    case 'treasure': {
      const loot = rollLoot(rng, node.danger, false);
      outcome = `You crack open the cache. ${applyLoot(state, loot)}` + grantXp(state, 3);
      // The goal dungeon's deepest cache holds the quest relic. Claiming it is the
      // retrieve objective — may complete the quest outright (no boss needed).
      if (room.relic && !state.quest.relicClaimed) {
        state.quest.relicClaimed = true;
        const relic = state.quest.relicName || 'the relic';
        state.inventory.push({ id: uid('relic'), name: relic, kind: 'relic', desc: 'The artifact your expedition was sent to recover.' });
        outcome += ` Beneath the hoard lies ${relic} — the prize itself. You take it.`;
        if (maybeWinQuest(state, true)) outcome += ' Your quest is fulfilled.';
      }
      room.cleared = true;
      break;
    }
    case 'rest': {
      for (const c of state.party) if (c.alive) { c.hp = c.maxHp; c.affliction = undefined; }
      outcome = 'You make a safe camp in the sanctuary; the party recovers to full health.';
      room.cleared = true;
      break;
    }
    case 'trap': {
      const chk = skillCheck(rng, partyBest(state, 'agility'), dc);
      if (chk.success) {
        outcome = `You spot and disarm the trap (rolled ${chk.roll}+${chk.modifier} vs DC ${dc}).` + grantXp(state, 3);
      } else {
        const hit = damageParty(state, chk.fumble ? 6 : 3);
        outcome = `The trap springs (rolled ${chk.roll}+${chk.modifier} vs DC ${dc})! ${hit || 'You scramble clear'}.`;
      }
      room.cleared = true;
      break;
    }
    case 'puzzle': {
      const chk = skillCheck(rng, partyBest(state, 'wits'), dc);
      if (chk.success) {
        const loot = rollLoot(rng, node.danger, false);
        outcome = `You decipher the mechanism (rolled ${chk.roll}+${chk.modifier} vs DC ${dc}). ${applyLoot(state, loot)}` + grantXp(state, 4);
      } else {
        outcome = `The mechanism resists you (rolled ${chk.roll}+${chk.modifier} vs DC ${dc}); the way grinds open anyway, its secret kept.`;
      }
      room.cleared = true;
      break;
    }
    default:
      return { state: prev, outcome: '' };
  }
  if (!partyAlive(state)) state.phase = 'gameover';
  state.log.push(outcome);
  return { state, outcome };
}

// Step from a cleared room into the next one deeper (the slide to a new screen).
export function advanceRoom(prev: RpgState, nodeId: string): RpgState {
  const node = prev.nodes[nodeId];
  const rs = nodeRooms(node);
  if (!rs) return prev;
  const i = node.roomIndex ?? 0;
  if (i >= rs.length - 1 || !rs[i].cleared) return prev;
  const state = clone(prev);
  state.nodes[nodeId].roomIndex = i + 1;
  // Pushing deeper takes time too — rivals on the surface keep racing (unless this
  // dungeon IS the goal, where the descent must stay winnable).
  const lostTo = pressRivalsInPlace(state);
  if (lostTo) state.log.push(`Word reaches you in the depths: ${lostTo} has claimed the prize. The expedition has failed.`);
  return state;
}

// ── Mechanics (the client resolves; the LLM only narrates the outcome) ───────

export interface ActionResult {
  state: RpgState;
  outcome: string;      // plain mechanical summary, fed to /game/rpg/resolve
}

// Apply a chosen action tag. Returns the new state and a one-line mechanical
// outcome string. step++ keeps the RNG stream deterministic and replayable.
export function applyAction(prev: RpgState, tag: ActionTag, node: MapNode): ActionResult {
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 2654435761);
  const here = state.nodes[node.id];
  const dc = 8 + here.danger * 3;
  let outcome = '';

  switch (tag) {
    case 'look': {
      // Scout the surroundings; free, always succeeds. Surfaces unseen roads AND
      // identifies the nature (kind + danger) of any adjacent place not yet scouted.
      const found: string[] = [];   // newly seen on the map
      const named: string[] = [];   // already seen, now identified
      for (const nb of here.edges) {
        const m = state.nodes[nb];
        if (!m.discovered) { m.discovered = true; m.scouted = true; found.push(m.name); }
        else if (!m.scouted) { m.scouted = true; named.push(m.name); }
      }
      const parts: string[] = [];
      if (found.length) parts.push(`spot the way to ${found.join(', ')}`);
      if (named.length) parts.push(`make out what lies at ${named.join(', ')}`);
      outcome = parts.length
        ? `You scan the surroundings and ${parts.join(', and ')}.`
        : 'You take in the surroundings; nothing new.';
      break;
    }
    case 'search': {
      const chk = skillCheck(rng, partyBest(state, 'wits'), dc);
      if (chk.success) {
        const heal = 3 + (chk.crit ? 4 : 0);
        for (const c of state.party) if (c.alive) c.hp = Math.min(c.maxHp, c.hp + heal);
        outcome = `Search succeeds (rolled ${chk.roll}+${chk.modifier} vs DC ${dc}). The party recovers ${heal} HP.` + grantXp(state, 4);
      } else {
        const dmg = chk.fumble ? 5 : 2;
        const hit = damageParty(state, dmg);
        outcome = `Search fails (rolled ${chk.roll}+${chk.modifier} vs DC ${dc}). A hazard strikes: ${hit || 'no harm'}.`;
      }
      break;
    }
    case 'talk': {
      const chk = skillCheck(rng, partyBest(state, 'spirit'), dc - 2);
      outcome = chk.success
        ? `The locals open up (rolled ${chk.roll} vs DC ${dc - 2}). You learn more about "${state.quest.title}".` + grantXp(state, 3)
        : `The locals are wary (rolled ${chk.roll} vs DC ${dc - 2}); little is learned.`;
      break;
    }
    case 'rest': {
      for (const c of state.party) if (c.alive) c.hp = c.maxHp;
      // A full rest also clears the mind — every affliction lifts (the sanity valve).
      const cured = state.party.filter(c => c.alive && c.affliction).length;
      for (const c of state.party) if (c.alive) c.affliction = undefined;
      // A Cheerful companion makes a better camp — +10 extra morale from rest. A
      // settlement that favours the party gives a warmer welcome (rep-scaled bonus).
      // A Rally Banner planted at camp lifts spirits further (+10).
      const welcome = (here.kind === 'town' || here.kind === 'village') ? Math.floor(settlementRep(here) / 10) : 0;
      const mg = adjustMorale(state, 25 + (partyHasTrait(state, 'cheerful') ? 10 : 0) + welcome + bannerCampMorale(state));
      outcome = `The party makes camp and rests. Everyone is back to full health${mg > 0 ? `, spirits lifted (+${mg} morale)` : ''}${cured > 0 ? ', minds eased' : ''}${welcome > 0 ? ' — the locals make you feel at home' : ''}.`;
      // A night in camp burns daylight — the competing expeditions creep closer.
      const lostTo = pressRivalsInPlace(state);
      if (lostTo) outcome += ` But while you slept, ${lostTo} reached the goal first — the prize is lost.`;
      break;
    }
    case 'recruit': {
      // Paid hire: a sellsword signs on for coin. Gold is debited here, never by
      // the LLM. If the purse is short the recruit stays in the pool, untouched.
      if (state.recruitPool.length > 0 && state.party.length < 4) {
        const ally = state.recruitPool[0];
        const cost = recruitPriceAt(here, ally, state.party.length);  // discounted by local standing
        if (state.gold >= cost) {
          state.gold -= cost;
          state.recruitPool.shift();
          state.party.push(ally);
          addRep(here, REP_HIRE);  // a paying patron earns goodwill
          outcome = `${ally.name} the ${ally.className} takes your coin (${cost} gold) and joins the party. ${state.gold} gold left.`;
        } else {
          outcome = `${ally.name} the ${ally.className} will sign on for ${cost} gold, but you carry only ${state.gold}. Earn more, or win them over with words.`;
        }
      } else {
        outcome = 'No one here is willing to join.';
      }
      break;
    }
    case 'provision': {
      // Restock rations with gold (price is client-owned). Buy as many as the purse
      // allows, up to a full satchel. No coin, no food — never goes into debt.
      const want = PROV_MAX - state.provisions;
      // Discounted by local standing, and again if a Haggler walks the band.
      const price = Math.max(1, Math.floor(provPriceAt(here) * (partyHasTrait(state, 'haggler') ? HAGGLER_PRICE_MUL : 1)));
      if (want <= 0) {
        outcome = 'The satchel is already full of rations.';
      } else {
        const afford = Math.floor(state.gold / price);
        const buy = Math.min(want, afford);
        if (buy <= 0) {
          outcome = `Rations cost ${price} gold each, but you carry only ${state.gold}. Earn more before you starve.`;
        } else {
          const spent = buy * price;
          state.gold -= spent;
          state.provisions = clampProv(state.provisions + buy);
          addRep(here, REP_PATRON);  // a returning customer earns goodwill
          outcome = `You buy ${buy} ration${buy > 1 ? 's' : ''} for ${spent} gold (${state.provisions}/${PROV_MAX} now, ${state.gold} gold left).`;
        }
      }
      break;
    }
    case 'fight': {
      if (here.cleared || here.danger === 0) {
        outcome = 'There is nothing left to fight here.';
        break;
      }
      const power = partyPower(state);
      const enemy = 6 + here.danger * 5;
      const chk = skillCheck(rng, Math.floor(power / 2), 10 + here.danger * 2);
      if (chk.success) {
        here.cleared = true;
        const thanked = creditRegionForClear(state, here.id);  // nearby settlements thank you for the safer road
        const dmg = Math.max(0, enemy - power) + (chk.crit ? 0 : 2);
        const hit = dmg > 0 ? damageParty(state, dmg) : 'no one is hurt';
        outcome = `Victory! (rolled ${chk.roll}+${chk.modifier} vs DC ${10 + here.danger * 2}). The enemy is defeated; ${hit}.` + grantXp(state, 6 + here.danger * 3) + gratitudeLine(thanked);
        maybeWinQuest(state, true);
      } else {
        const dmg = enemy - Math.floor(power / 2) + (chk.fumble ? 4 : 0);
        const hit = damageParty(state, Math.max(3, dmg));
        outcome = `The fight goes badly (rolled ${chk.roll}+${chk.modifier}). ${hit || 'The party holds'}.`;
      }
      break;
    }
    case 'quest': {
      outcome = state.quest.done
        ? `Quest complete: ${state.quest.title}.`
        : `Quest: ${state.quest.title} — ${state.quest.desc}`;
      break;
    }
    case 'leave': {
      outcome = 'You head back to the map.';
      break;
    }
  }

  if (!partyAlive(state)) state.phase = 'gameover';
  state.log.push(outcome);
  return { state, outcome };
}

// Move the party to an adjacent, discovered node and enter its scene.
// ── Travel (a journey now takes time and may spring an en-route event) ────────
// All odds + numbers are client-owned; the LLM names nothing here. A leg's
// length (the road distance) and the destination's danger drive the chance of an
// ambush (combat on arrival), a natural hazard (the party loses HP), or a lucky
// find (gold). The UI animates the party along the road for `durationMs`, then
// calls arriveTravel to apply the outcome.
const HAZARDS = [
  { kind: 'a sudden rockslide', verb: 'battered by falling stone' },
  { kind: 'a violent storm', verb: 'lashed by wind and rain' },
  { kind: 'a flash flood', verb: 'swept by rising water' },
  { kind: 'a biting cold snap', verb: 'numbed to the bone' },
  { kind: 'a choking ash-fall', verb: 'scorched by drifting embers' },
  { kind: 'a treacherous bog', verb: 'mired in sucking mud' },
];
const BOONS = [
  { kind: 'a hidden shortcut', desc: 'a faster path saves your strength' },
  { kind: 'an abandoned cache', desc: 'coins glint among the roots' },
  { kind: 'a fallen traveller’s purse', desc: 'left for whoever passes' },
  { kind: 'a roadside shrine', desc: 'an offering bowl heavy with coin' },
];

// ── Dice-pool checks (reducers; builders live in ./dice-pool) ────────────────
// Resolve a dilemma option. A stat-gated option OPENS a dice pool (the player
// then rolls/pushes/commits); a no-stat option is an instant, sure cost (auto
// `good`), resolved here as before. Idempotent once resolved / a pool is open.
export function resolveDilemma(prev: RpgState, optionIndex: number): RpgState {
  const d = prev.dilemma;
  if (!d || d.resolved || prev.dicePool) return prev;
  const opt = d.options[optionIndex];
  if (!opt) return prev;
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 30011);
  if (opt.stat && typeof opt.dc === 'number') {
    const diff01 = (opt.dc - 6) / 14;
    state.dicePool = buildDicePool(state, 'dilemma', opt.stat, opt.label, d.nodeId, Math.max(0, opt.dc - 8), diff01, rng, optionIndex);
    return state;
  }
  const dd = state.dilemma!;
  const mech = applyDilemmaDelta(state, opt.good);
  dd.resolved = true;
  dd.chosenIndex = optionIndex;
  dd.success = undefined;
  dd.resultText = `${opt.good.text}${mech}`;
  state.log.push(`Crossroads — ${opt.label}: ${dd.resultText}`);
  return state;
}

// Open a dice-pool search at the current node (replaces the old single-d20 search
// in applyAction). Wits-governed; difficulty scales with the node's danger.
export function startSearchCheck(prev: RpgState, node: MapNode): RpgState {
  if (prev.dicePool) return prev;
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 2654435761);
  const here = state.nodes[node.id];
  const danger = here.danger;
  const dc = 8 + danger * 3;
  const diff01 = (dc - 6) / 14;
  state.dicePool = buildDicePool(state, 'search', 'wits', 'Search the area', here.id, danger, diff01, rng);
  return state;
}

// Reroll the missed dice (push-your-luck). Costs morale that escalates each push;
// only misses are re-rolled (hits are kept). No-op if exhausted or unaffordable.
export function rerollDicePool(prev: RpgState): RpgState {
  const p = prev.dicePool;
  if (!p || p.resolved) return prev;
  if (p.rerollsUsed >= p.maxRerolls) return prev;
  if (!p.dice.some(die => !die.kept)) return prev;
  if (prev.morale < rerollMoraleCost(p, prev)) return prev;
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 60013);
  const pp = state.dicePool!;
  adjustMorale(state, -rerollMoraleCost(pp, state));
  for (const die of pp.dice) {
    if (die.kept) continue;
    const r = rollPoolDie(rng, die.bonus);
    die.face = r.face; die.hit = r.hit; die.kept = r.hit;
  }
  pp.rerollsUsed += 1;
  pp.rerollCost = POOL_REROLL_BASE + pp.rerollsUsed * POOL_REROLL_STEP;
  return state;
}

// Commit the pool: tally hits vs required, pick an outcome tier, apply the
// consequence for the kind, write the result. Stays set (resolved) so the UI
// shows the outcome; closeDicePool then clears it (and lands a dilemma's party).
export function commitDicePool(prev: RpgState): RpgState {
  const p = prev.dicePool;
  if (!p || p.resolved) return prev;
  const state = clone(prev);
  state.step += 1;
  const pp = state.dicePool!;
  const hits = poolHits(pp);
  const outcome: 'success' | 'partial' | 'fail' =
    hits >= pp.required ? 'success' : hits > 0 ? 'partial' : 'fail';
  pp.resolved = true;
  pp.outcome = outcome;
  const tally = `(${hits}/${pp.required} hits)`;
  if (pp.kind === 'dilemma') {
    // A near-miss still fails the approach: success → good, otherwise → bad.
    const dd = state.dilemma!;
    const opt = dd.options[pp.optionIndex!];
    const success = outcome === 'success';
    const delta = success ? opt.good : (opt.bad ?? opt.good);
    const mech = applyDilemmaDelta(state, delta);
    dd.resolved = true;
    dd.chosenIndex = pp.optionIndex;
    dd.success = success;
    dd.resultText = `${delta.text} ${tally}${mech}`;
    pp.resultText = dd.resultText;
    state.log.push(`Crossroads — ${opt.label}: ${dd.resultText}`);
  } else {
    // search: success = a good find + XP; partial = scraps; fail = a hazard bites.
    if (outcome === 'success') {
      const over = hits - pp.required;
      const heal = 4 + over * 2;
      for (const c of state.party) if (c.alive) c.hp = Math.min(c.maxHp, c.hp + heal);
      pp.resultText = `The search pays off ${tally}: +${heal} HP each.` + grantXp(state, 5 + over);
    } else if (outcome === 'partial') {
      const heal = 2;
      for (const c of state.party) if (c.alive) c.hp = Math.min(c.maxHp, c.hp + heal);
      pp.resultText = `A meagre find ${tally}: +${heal} HP each.` + grantXp(state, 2);
    } else {
      const dmg = 4 + pp.danger * 2;
      const hit = damageParty(state, dmg);
      pp.resultText = `The search turns up nothing ${tally} — a hazard strikes: ${hit || 'no harm'}.`;
    }
    state.log.push(`Search — ${pp.resultText}`);
  }
  return state;
}

// Dismiss a committed pool. For a dilemma, land the party + desertion check (as
// closeDilemma); for a search, just clear and stay in the scene.
export function closeDicePool(prev: RpgState): RpgState {
  const p = prev.dicePool;
  if (!p) return prev;
  const state = clone(prev);
  state.step += 1;
  if (p.kind === 'dilemma') {
    const rng = makeRng(state.seed + state.step * 40009);
    landAt(state, p.nodeId);
    afterLand(state, rng);
    state.dilemma = null;
  }
  state.dicePool = null;
  return state;
}

// Dismiss a resolved dilemma: land the party at the destination (opening its
// scene) and run the desertion check (a bad choice may have broken morale).
export function closeDilemma(prev: RpgState): RpgState {
  const d = prev.dilemma;
  if (!d) return prev;
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 40009);
  landAt(state, d.nodeId);
  afterLand(state, rng);
  state.dilemma = null;
  maybeRivalEncounter(state, d.nodeId);  // a rival waiting where the road let out
  return state;
}

// Resolve a rival meeting. Sabotage/parley roll a d20 vs a client-owned DC; race
// auto-resolves. The CLIENT applies every consequence — hinder the rival, trade for
// ground/intel, or lose a step. The rival is never killed (competition, not murder).
export function resolveRival(prev: RpgState, optionIndex: number): RpgState {
  const enc = prev.rivalEncounter;
  if (!enc || enc.resolved) return prev;
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 31013);
  const opt = enc.options[optionIndex];
  const rival = state.rivals.find(r => r.id === enc.rivalId);
  const e = state.rivalEncounter!;
  e.chosenIndex = optionIndex;
  if (!opt || !rival) { e.resolved = true; e.resultText = 'The moment passes.'; return state; }

  let text = '';
  if (opt.tactic === 'race') {
    // Press on: no roll, a small morale lift from the chase, a sliver of provisions burned.
    adjustMorale(state, 3);
    state.provisions = clampProv(state.provisions - 1);
    text = `You press on past ${rival.name}, the chase quickening the party's blood. [+3 morale, -1 ration]`;
  } else if (opt.tactic === 'trade') {
    // Genial crews swap charts: no roll. The two nearest unscouted places are
    // identified, but the friendly halt costs a sliver of the race.
    const here = state.nodes[enc.nodeId];
    const unscouted = Object.values(state.nodes)
      .filter(n => !n.scouted && n.id !== enc.nodeId)
      .sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y))
      .slice(0, 2);
    for (const n of unscouted) { n.discovered = true; n.scouted = true; }
    adjustMorale(state, 2);
    rival.progress = Math.min(1, rival.progress + 0.02);
    rival.nodeId = rivalNodeAt(rival);
    const names = unscouted.map(n => n.name).join(', ');
    text = unscouted.length
      ? `You share a fire with ${rival.name} and trade charts — ${names} now marked on your map. They break camp first. [+2 morale, rival gains a little ground]`
      : `You share a fire with ${rival.name}, but your maps already cover theirs. They break camp first. [+2 morale, rival gains a little ground]`;
  } else {
    const stat = opt.stat!;
    const chk = skillCheck(rng, partyBest(state, stat), opt.dc!);
    e.success = chk.success;
    e.roll = { value: chk.roll, total: chk.total, dc: chk.dc, success: chk.success, crit: chk.crit, fumble: chk.fumble, by: 'party', round: 0 };
    if (opt.tactic === 'sabotage') {
      if (chk.success) {
        rival.hindered += chk.crit ? 4 : 2;
        text = `You foul ${rival.name}'s gear in the night (rolled ${chk.roll}+${chk.modifier} vs DC ${opt.dc}). They lose ground. [rival slowed]`;
      } else {
        for (const c of state.party) if (c.alive) c.hp = Math.max(1, c.hp - (chk.fumble ? 5 : 3));
        adjustMorale(state, -4);
        text = `The sabotage goes wrong (rolled ${chk.roll}+${chk.modifier} vs DC ${opt.dc}) — a scuffle leaves bruises. [-HP, -4 morale]`;
      }
    } else if (opt.tactic === 'standoff') {
      // Face down a cutthroat crew (might). Win: they back off, badly shaken.
      // Lose: they shake the party down for coin and nerve.
      if (chk.success) {
        rival.hindered += 3;
        adjustMorale(state, 4);
        text = `You square up and ${rival.name} blinks first (rolled ${chk.roll}+${chk.modifier} vs DC ${opt.dc}). They withdraw to lick their pride. [rival slowed, +4 morale]`;
      } else {
        const lost = Math.min(state.gold, 15);
        state.gold -= lost;
        adjustMorale(state, -5);
        text = `${rival.name} calls the bluff (rolled ${chk.roll}+${chk.modifier} vs DC ${opt.dc}) and shakes you down for the road toll. [-${lost} gold, -5 morale]`;
      }
    } else if (opt.tactic === 'wager') {
      // A sporting sprint against a true rival (agility), gold on the line.
      // Win: they restart from the trailhead and pay up. Lose: they pocket the
      // stake and carry the momentum forward.
      if (chk.success) {
        rival.progress = 0;
        rival.nodeId = rivalNodeAt(rival);
        state.gold += 10;
        text = `You leave ${rival.name} in the dust (rolled ${chk.roll}+${chk.modifier} vs DC ${opt.dc}) — they pay the stake and must regroup at the trailhead. [+10 gold, rival set back]`;
      } else {
        const lost = Math.min(state.gold, 10);
        state.gold -= lost;
        rival.progress = Math.min(1, rival.progress + 0.04);
        rival.nodeId = rivalNodeAt(rival);
        text = `${rival.name} wins the sprint (rolled ${chk.roll}+${chk.modifier} vs DC ${opt.dc}) and pockets the stake, spirits high. [-${lost} gold, rival gains ground]`;
      }
    } else { // parley
      if (chk.success) {
        const gold = 10 + Math.floor(rng() * 16);
        state.gold += gold;
        adjustMorale(state, 4);
        state.rumors.push(`${rival.name} let slip a lead about the road ahead.`);
        text = `You strike terms with ${rival.name} (rolled ${chk.roll}+${chk.modifier} vs DC ${opt.dc}). Coin and a useful word change hands. [+${gold} gold, +4 morale]`;
      } else {
        rival.progress = Math.min(1, rival.progress + 0.06);
        rival.nodeId = rivalNodeAt(rival);
        text = `${rival.name} talks circles around you (rolled ${chk.roll}+${chk.modifier} vs DC ${opt.dc}) and slips ahead while you parley. [rival gains ground]`;
      }
    }
  }
  e.resolved = true;
  e.resultText = text;
  state.log.push(text);
  if (!partyAlive(state)) state.phase = 'gameover';
  return state;
}

// Dismiss a resolved rival meeting; drop back to the scene the party landed on.
export function closeRival(prev: RpgState): RpgState {
  const enc = prev.rivalEncounter;
  if (!enc) return prev;
  const state = clone(prev);
  state.rivalEncounter = null;
  if (state.phase === 'rival') state.phase = 'scene';
  return state;
}

// Begin a journey toward an adjacent node. Does NOT move the party yet — it sets
// the 'travel' phase with a rolled outcome the UI plays out, then arriveTravel
// commits it. Distance + destination danger weight the event roll.
export function beginTravel(prev: RpgState, nodeId: string): RpgState {
  const from = prev.nodes[prev.currentNodeId];
  const node = prev.nodes[nodeId];
  if (!node || !from || !from.edges.includes(nodeId)) return prev;
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 50021);
  const dist = Math.hypot(node.x - from.x, node.y - from.y);
  const danger = node.cleared ? 0 : node.danger;
  const durationMs = Math.round(Math.min(6000, Math.max(1600, 1400 + dist * 5200 + danger * 450)));

  // Low morale makes the road meaner: more ambushes/hazards, fewer lucky finds.
  // factor is 1.0 at full morale, up to 1.6 when broken.
  const lowMorale = 1 + (1 - prev.morale / MORALE_MAX) * 0.6;
  // A Pathfinder in the band reads the terrain — fewer ambushes spring (×0.7).
  const ambushMul = partyHasTrait(prev, 'pathfinder') ? 0.7 : 1;
  const ambushP = Math.min(0.65, (0.08 + danger * 0.11 + dist * 0.28) * lowMorale * ambushMul);
  const hazardP = Math.min(0.35, (0.05 + dist * 0.22) * lowMorale);
  const boonP = 0.1 / lowMorale;
  const dilemmaP = 0.18; // a neutral road choice — morale-independent
  const r = rng();
  let event: TravelEvent = 'none';
  if (r < ambushP) event = 'ambush';
  else if (r < ambushP + hazardP) event = 'hazard';
  else if (r < ambushP + hazardP + boonP) event = 'boon';
  else if (r < ambushP + hazardP + boonP + dilemmaP) event = 'dilemma';

  const travel: TravelState = {
    fromId: from.id, toId: nodeId, dist,
    durationMs, event, eventAt: 0.32 + rng() * 0.4,
    resolved: false, note: `Setting out for ${node.name}…`,
  };
  if (event === 'hazard') {
    const h = HAZARDS[Math.floor(rng() * HAZARDS.length)];
    travel.hazardKind = h.kind;
    travel.hazardHp = 3 + Math.floor(rng() * 4) + danger;     // client-owned damage
    travel.note = `On the road: ${h.kind}! The party is ${h.verb}.`;
  } else if (event === 'boon') {
    const b = BOONS[Math.floor(rng() * BOONS.length)];
    travel.boonKind = b.kind;
    travel.boonGold = 12 + Math.floor(rng() * 28);
    travel.note = `On the road you find ${b.kind} — ${b.desc}.`;
  } else if (event === 'dilemma') {
    travel.note = `A choice looms on the road to ${node.name}…`;
  } else if (event === 'ambush') {
    travel.note = `Ambush on the road to ${node.name}!`;
  }
  state.phase = 'travel';
  state.travel = travel;
  return state;
}

// Land the party at a node: the shared body of any arrival (discover it + its
// neighbours, open a scene). Mutates `state` in place.
function landAt(state: RpgState, nodeId: string): void {
  state.currentNodeId = nodeId;
  const here = state.nodes[nodeId];
  here.discovered = true;
  here.scouted = true;   // arriving teaches the party what this place is
  here.visited = true;
  for (const nb of here.edges) state.nodes[nb].discovered = true;  // roads onward appear, but their nature stays unknown until scouted
  claimDiscovery(state, here);  // a landmark here yields its trinket on first arrival
  // Reaching a safe settlement lifts the party's resolve (warm beds, hot food).
  const safeBump = here.kind === 'town' ? 12 : here.kind === 'village' ? 8 : 0;
  if (safeBump) adjustMorale(state, safeBump);
  state.phase = 'scene';
  state.scene = {
    nodeId,
    narration: here.blurb,
    log: [here.blurb],
    choices: fallbackChoices(legalTags(state, here)),
    busy: false,
    fallback: true,
  };
}

// Below ~15 morale a non-hero companion may quietly abandon the expedition (they
// LEAVE, never die — grand-public). Returns a log line if someone deserted. The
// hero never deserts; the party is never emptied. Pre-condition: low morale.
function maybeDesert(state: RpgState, rng: () => number): string | null {
  if (state.morale > 15) return null;
  const quitters = state.party.filter(c => c.alive && !c.isHero);
  if (quitters.length === 0) return null;
  const chance = Math.max(0, Math.min(0.6, (20 - state.morale) / 40));
  if (rng() >= chance) return null;
  // A mutinous member is first out the door — pick one if any, else any malcontent.
  const mutinous = quitters.filter(c => c.affliction === 'mutinous');
  const pool = mutinous.length ? mutinous : quitters;
  const who = pool[Math.floor(rng() * pool.length)];
  state.party = state.party.filter(c => c.id !== who.id);
  adjustMorale(state, 8); // the malcontent gone, the rest steady themselves
  return `Morale breaks: ${who.name} the ${who.className} abandons the expedition.`;
}

// The shared post-landing settle: a desertion roll, then the sanity cycle (catch at
// low morale, recover at high). Mutates `state` and logs any consequences.
function afterLand(state: RpgState, rng: () => number): void {
  const left = maybeDesert(state, rng);
  if (left) state.log.push(left);
  for (const line of tickAfflictions(state, rng)) state.log.push(line);
  const hallu = maybeHallucinate(state, rng);
  if (hallu) state.log.push(hallu);
}

// Commit the journey: move to the destination and apply the rolled event. An
// ambush drops the party straight into combat; a hazard costs HP (never lethal —
// floored at 1); a boon adds gold. Always lands at the node afterwards.
export function arriveTravel(prev: RpgState): RpgState {
  const t = prev.travel;
  if (!t) return prev;
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 60013);
  const here = state.nodes[t.toId];
  state.log.push(`You travel to ${here.name}.`);

  // Competing expeditions advance on every party leg — the crawl is the only safe
  // tempo. If a rival reaches the goal before the quest is satisfied, the prize is
  // lost and the run ends; preempt every other road event.
  const raceWon = tickRivals(state);
  if (raceWon.length && !questSatisfied(state)) {
    state.log.push(`${raceWon[0]} reaches the goal first — the prize is lost.`);
    state.phase = 'gameover';
    state.travel = null;
    return state;
  }

  // Every leg wears on the party's resolve, scaled by distance, the destination's
  // lingering danger and difficulty. The road's event then nudges it further.
  // A Stalwart in the band steadies the march — every leg's drain is softened (×0.8).
  // A Pathlight Lantern lights the road too, easing the resolve cost a touch further (×0.85).
  const drainMul = (partyHasTrait(state, 'stalwart') ? 0.8 : 1) * lanternDrainMul(state);
  const baseDrain = Math.round((2 + t.dist * 8 + (here.cleared ? 0 : here.danger) * 1.5) * diffOf(state).morale * drainMul);
  const eventMod = t.event === 'boon' ? 6 : t.event === 'hazard' ? -6 : t.event === 'ambush' ? -4 : 0;
  adjustMorale(state, -baseDrain + eventMod);

  // The leg eats rations. A Forager trims the march's appetite by one ration (≥1).
  // A Forager's Snare in the satchel trims one more (stacks; still floored at 1).
  // If the satchel runs dry mid-road the party goes hungry: each missing ration
  // costs every living member 2 HP (floored at 1) and 4 morale.
  // A ravenous member eats an extra ration on top of the march's base appetite.
  const need = Math.max(1, legProvisionCost(t.dist) - (partyHasTrait(state, 'forager') ? 1 : 0) - snareRationCut(state)) + ravenousRationExtra(state);
  const eaten = Math.min(state.provisions, need);
  state.provisions = clampProv(state.provisions - eaten);
  const short = need - eaten;
  if (short > 0) {
    const dmg = short * 2;
    // A feverish member weathers privation worse (+2); a talisman softens it (-1).
    const ward = hasTrinket(state, 'talisman') ? TALISMAN_WARD : 0;
    for (const c of state.party) if (c.alive) {
      const bite = Math.max(0, dmg + (hasAffliction(c, 'feverish') ? FEVERISH_EXTRA : 0) - ward);
      c.hp = Math.max(1, c.hp - bite);
    }
    adjustMorale(state, -short * 4);
    state.log.push(`Provisions run out — the party goes hungry (-${dmg} HP each, morale sinks).`);
  } else if (state.provisions <= 2) {
    state.log.push(`Rations run low (${state.provisions} left). Restock at a settlement.`);
  }

  if (t.event === 'hazard') {
    const dmg = t.hazardHp ?? 4;
    // A feverish member weathers the hazard worse (+2); a talisman softens it (-1).
    const ward = hasTrinket(state, 'talisman') ? TALISMAN_WARD : 0;
    for (const c of state.party) if (c.alive) {
      const bite = Math.max(0, dmg + (hasAffliction(c, 'feverish') ? FEVERISH_EXTRA : 0) - ward);
      c.hp = Math.max(1, c.hp - bite);
    }
    state.log.push(`${t.hazardKind} on the road — everyone loses ${dmg} HP.`);
  } else if (t.event === 'boon') {
    // A Lucky member sweetens roadside finds (×1.5, rounded); a Lucky Lodestar
    // in the satchel does the same (stacks multiplicatively).
    // A cursed member sours the party's luck — the find comes up thinner.
    const g = Math.round((t.boonGold ?? 20) * (partyHasTrait(state, 'lucky') ? 1.5 : 1) * lodestarGoldMul(state) * cursedBoonMul(state));
    state.gold += g;
    state.log.push(`You find ${t.boonKind} — +${g} gold.`);
  }

  if (t.event === 'ambush') {
    // Land first (so the node is discovered/visited), then spring the fight.
    // Desertion is deferred — the party has bigger problems right now.
    landAt(state, t.toId);
    state.log.push('Foes spring from the roadside!');
    state.travel = null;
    return startCombat(state, t.toId);
  }

  if (t.event === 'dilemma') {
    // Hand the player a road choice. Don't land yet — closeDilemma lands + runs
    // the desertion roll once the dilemma is resolved and dismissed.
    state.dilemma = rollDilemma(rng, t.toId, here.cleared ? 0 : here.danger);
    state.phase = 'dilemma';
    state.travel = null;
    return state;
  }

  // landAt applies any safe-settlement bump first, so a town can pull the party
  // back from the brink before the desertion roll.
  landAt(state, t.toId);
  afterLand(state, rng);
  state.travel = null;
  // A rival standing on the node just reached blocks the road for a meeting.
  maybeRivalEncounter(state, t.toId);
  return state;
}

// Build the compact situation string the GM narrates from (kept tiny for 3B).
export function sceneContext(state: RpgState, node: MapNode): string {
  const party = state.party
    .filter(c => c.alive)
    .map(c => `${c.name}(${c.className} L${c.level} ${c.hp}/${c.maxHp}hp)`)
    .join(', ');
  const status = node.cleared ? 'cleared' : node.danger > 0 ? `danger ${node.danger}` : 'safe';
  return `Place: ${node.name} (${node.kind}, ${status}). ${node.blurb} Party: ${party}. Quest: ${state.quest.title}.`;
}

// ── Dialogue (free-text talk; world may shift, the quest thread never does) ──
// The player types; the LLM voices one NPC and may propose ONE effect token.
// The client computes every consequence here and refuses anything that would
// touch quest.goalNodeId or the node order — only the surroundings evolve.

// The effects this node may legally produce — gated by the same rules as scene
// tags, so the LLM is only ever offered effects the client can actually apply.
export function legalEffects(state: RpgState, node: MapNode): DialogueEffect[] {
  const fx: DialogueEffect[] = ['none', 'rumor'];
  const hasHidden = node.edges.some(e => !state.nodes[e].discovered)
    || state.order.some(id => !state.nodes[id].discovered);
  if (hasHidden) fx.push('reveal');
  if (node.edges.some(e => state.nodes[e].danger > 0 && !state.nodes[e].cleared)) fx.push('warn');
  if (state.party.some(c => c.alive && c.hp < c.maxHp)) fx.push('heal');
  if (state.recruitPool.length > 0 && state.party.length < 4) fx.push('recruit');
  return fx;
}

// Enter a conversation at the current node. Seeds the NPC and an opening line.
export function startDialogue(prev: RpgState, nodeId: string): RpgState {
  const state = clone(prev);
  const node = state.nodes[nodeId];
  const { name, role } = npcFor(node);
  const opener = `You approach ${name}, a ${role} of ${node.name}, one of ${peopleFor(state.seed, state.peopleId).name}.`;
  state.phase = 'dialogue';
  state.dialogue = {
    nodeId,
    npcName: name,
    npcRole: role,
    history: [{ who: 'system', text: opener }],
    busy: false,
    over: false,
    fallback: false,
  };
  state.log.push(opener);
  return state;
}

// Append a turn to the live conversation (player line, NPC reply, or a note).
export function appendDialogue(prev: RpgState, turn: DialogueTurn): RpgState {
  if (!prev.dialogue) return prev;
  const state = clone(prev);
  state.dialogue!.history.push(turn);
  return state;
}

// Compact situation the NPC reasons from (kept tiny for a 3B model).
export function dialogueContext(state: RpgState): string {
  const node = state.nodes[state.dialogue!.nodeId];
  const party = state.party.filter(c => c.alive).map(c => c.className).join(', ');
  const rumors = state.rumors.length ? ` Known leads: ${state.rumors.slice(-2).join('; ')}.` : '';
  return `Place: ${node.name} (${node.kind}). Quest: ${state.quest.title} — ${state.quest.desc}. `
    + `${peopleFlavor(state.seed, state.peopleId)} Party: ${party}.${rumors}`;
}

// Apply a single NPC-proposed effect. The CLIENT owns every number; the LLM only
// chose the token. Returns the new state and a short note describing what changed
// (shown as a 'system' dialogue line). Effects that the world can't honor degrade
// to nothing — and none of them ever touch quest.goalNodeId / order (the trame).
export function applyDialogueEffect(prev: RpgState, effect: DialogueEffect, reply: string): { state: RpgState; note: string } {
  if (effect === 'none' || !prev.dialogue) return { state: prev, note: '' };
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 2654435761);
  const node = state.nodes[state.dialogue!.nodeId];
  let note = '';

  switch (effect) {
    case 'reveal': {
      // Surface an undiscovered place — neighbours first, else anywhere on the map.
      const hidden = node.edges.filter(e => !state.nodes[e].discovered);
      const pool = hidden.length ? hidden : state.order.filter(id => !state.nodes[id].discovered);
      if (pool.length) {
        const pick = pool[Math.floor(rng() * pool.length)];
        state.nodes[pick].discovered = true;
        state.nodes[pick].scouted = true;   // the NPC names the place, not just its road
        note = `${state.dialogue!.npcName} marks the way to ${state.nodes[pick].name} on your map.`;
      }
      break;
    }
    case 'rumor': {
      // A new side-lead branches off the trame without moving its goal.
      const lead = reply.replace(/\s+/g, ' ').trim().slice(0, 120) || 'a whispered rumor';
      state.rumors.push(lead);
      note = `New lead noted: "${lead}"`;
      break;
    }
    case 'heal': {
      const amount = 6 + Math.floor(rng() * 5); // client owns the magnitude
      let healed = false;
      for (const c of state.party) {
        if (c.alive && c.hp < c.maxHp) { c.hp = Math.min(c.maxHp, c.hp + amount); healed = true; }
      }
      if (healed) note = `${state.dialogue!.npcName} tends your wounds (+${amount} HP to the party).`;
      break;
    }
    case 'recruit': {
      // The "convinced for free" path: an NPC won over through conversation joins
      // at no cost — no gold is touched (contrast the paid hire in applyAction).
      if (state.recruitPool.length > 0 && state.party.length < 4) {
        const ally = state.recruitPool.shift()!;
        state.party.push(ally);
        note = `${ally.name} the ${ally.className}, won over by your words, joins your party — no coin asked.`;
      }
      break;
    }
    case 'warn': {
      // Intel makes one looming danger less deadly (clamped, never below 1) and
      // reveals it on the map. The encounter still happens — the trame holds.
      const risky = node.edges
        .map(e => state.nodes[e])
        .filter(n => n.danger > 1 && !n.cleared)
        .sort((a, b) => b.danger - a.danger)[0];
      if (risky) {
        risky.discovered = true;
        risky.scouted = true;   // a warning names the threat — you now know what waits there
        risky.danger = Math.max(1, risky.danger - 1);
        note = `${state.dialogue!.npcName}'s warning about ${risky.name} leaves you better prepared.`;
      }
      break;
    }
  }

  if (note) {
    state.dialogue!.history.push({ who: 'system', text: note });
    state.log.push(note);
  }
  return { state, note };
}

// Leave the conversation and return to the node scene. Talking once grants a
// little XP (curiosity rewarded), mirroring the old abstract 'talk' action.
export function endDialogue(prev: RpgState): RpgState {
  if (!prev.dialogue) return prev;
  const state = clone(prev);
  const spoke = state.dialogue!.history.some(t => t.who === 'player');
  if (spoke && !state.dialogue!.over) grantXp(state, 3);
  const node = state.nodes[state.dialogue!.nodeId];
  state.dialogue = null;
  state.phase = 'scene';
  if (!state.scene || state.scene.nodeId !== node.id) {
    state.scene = {
      nodeId: node.id,
      narration: node.blurb,
      log: [node.blurb],
      choices: fallbackChoices(legalTags(state, node)),
      busy: false,
      fallback: true,
    };
  }
  return state;
}

// ── Combat (dedicated battle view; client resolves, LLM narrates) ────────────

// The farming gate + GM rubber-band, applied the moment a boss fight begins.
// Rush the finale under-levelled and the boss scales up against you (you should
// have farmed); but if you are badly under-levelled OR limping in wounded, the
// GM throws a lifeline (heal to full + a potion). Steamroll it grossly over-
// levelled and the GM raises the stakes instead. All magnitudes are client-owned;
// returns the intervention token (for narration) and mutates boss + party.
function gmIntervene(state: RpgState, boss: Enemy, node: MapNode, rng: () => number): 'boon' | 'bane' | null {
  const living = state.party.filter(c => c.alive);
  if (!living.length) return null;
  const heroLevel = Math.max(1, ...living.map(c => c.level));
  const reqLevel = (node.reqLevel ?? REQ_BY_SIZE.medium) + (state.ngPlus || 0);
  const gap = Math.max(-3, Math.min(5, reqLevel - heroLevel));
  // Under-levelled → the boss is tougher (the gate): farming closes this gap.
  if (gap > 0) {
    boss.maxHp = Math.round(boss.maxHp * (1 + gap * 0.15));
    boss.hp = boss.maxHp;
    boss.atk += Math.ceil(gap / 2);
  }
  const avgRatio = living.reduce((a, c) => a + c.hp / c.maxHp, 0) / living.length;
  if (gap >= 2 || avgRatio < 0.5) {
    for (const c of living) c.hp = c.maxHp;
    state.inventory.push(makePotion(rng, node.danger));
    return 'boon';
  }
  if (gap <= -2) {
    boss.maxHp = Math.round(boss.maxHp * 1.15);
    boss.hp = boss.maxHp;
    boss.atk += 1;
    return 'bane';
  }
  return null;
}

// Enter the battle view. `opts.roomId` ties the fight to one dungeon room (so a
// win clears that room, not the whole node); `opts.boss` spawns a phased boss.
export function startCombat(prev: RpgState, nodeId: string, opts?: { roomId?: string | null; boss?: boolean; farm?: boolean }): RpgState {
  const state = clone(prev);
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 40503);
  const node = state.nodes[nodeId];
  const diff = diffOf(state);
  const room = opts?.roomId ? (node.rooms || []).find(r => r.id === opts.roomId) : null;
  // Source the fighters from the SAME roster the scene draws, so clicking a monster
  // engages that exact band (group combat). A farm hunt is the lone exception — an
  // ephemeral pack, freshly rolled, that never persists to the node.
  let enemies: Enemy[];
  if (opts?.farm) {
    enemies = makeEnemies(node, rng, diff, state);
  } else if (room) {
    enemies = roomRoster(node, room, state);
  } else if (opts?.boss) {
    enemies = makeBoss(node, rng, state.ngPlus || 0, diff, state, `foe:${nodeId}`);
  } else {
    enemies = nodeRoster(node, state);
  }
  const isBoss = opts?.boss || room?.kind === 'boss';
  // The GM weighs the party against the boss and may grant a power-up or a nerf.
  const intervention = isBoss && enemies[0] ? gmIntervene(state, enemies[0], node, rng) : null;
  const open = isBoss && enemies[0]
    ? `${enemies[0].name} looms before you at ${node.name}!`
    : opts?.farm
      ? `You set out hunting around ${node.name}. ${enemies.length} foe(s) appear.`
      : `A fight breaks out at ${node.name}! ${enemies.length} foe(s) close in.`;
  const log = [open];
  if (intervention === 'boon') log.push('The unseen GM steadies your band — wounds close and a draught appears in your satchel.');
  else if (intervention === 'bane') log.push('The unseen GM raises the stakes — the foe surges with fresh menace.');
  // No phase flip: combat is staged INLINE on the scene/dungeon screen the party is
  // already standing on (the diorama hosts the fight), so there is no jarring swap to
  // a separate battle screen. The phase stays whatever it was (scene).
  state.combat = {
    nodeId,
    enemies,
    round: 1,
    log,
    targetId: enemies[0]?.id || null,
    defending: false,
    specialCd: 0,
    busy: false,
    over: false,
    result: null,
    roomId: opts?.roomId ?? null,
    farm: !!opts?.farm,
    intervention,
  };
  // Roll the opening tactical round (symbol pool + telegraphed foe intents) so the
  // CE2 battle board is ready the instant the fight is staged.
  rollTacticalRound(state, state.combat);
  return state;
}

// Lethal check that respects boss phases: a multi-phase boss reels and rises
// (restored, angrier) until its final phase, only then truly dying.
function killOrPhase(e: Enemy, lines: string[]): void {
  if (e.hp > 0) return;
  if (e.bossMaxPhase && (e.bossPhase ?? 1) < e.bossMaxPhase) {
    e.bossPhase = (e.bossPhase ?? 1) + 1;
    e.maxHp = Math.round(e.maxHp * 0.6);
    e.hp = e.maxHp;
    e.atk += 1;
    lines.push(`${e.name} reels — then rises again, stronger! (phase ${e.bossPhase})`);
  } else {
    e.alive = false;
    lines.push(`${e.name} is slain.`);
  }
}

// Roll a fresh tactical round into the combat state: a symbol-dice pool (one die
// per living member) AND the foes' own rolled dice (the symmetric enemy board),
// then reset the push-your-luck counters. Seed-derived so the round replays
// deterministically. Mutates `c`.
function rollTacticalRound(state: RpgState, c: CombatState): void {
  const rng = makeRng(state.seed + state.step * 1013904223 + c.round * 1597334677);
  c.pool = rollCombatPool(state.party, rng);
  c.enemyPool = rollEnemyPool(c.enemies, rng);
  c.rerollsUsed = 0;
  c.rerollCost = COMBAT_REROLL_BASE;
  c.maxRerolls = COMBAT_MAX_REROLLS;
}

// Apply the wider-game consequences of a won fight (breather heal, farm XP/loot,
// room/node clear + region credit, quest progress). Extracted so BOTH the legacy
// d20 round and the tactical commit run the SAME win pipeline — non-regression.
// Pushes its narration onto `lines`. For a farm hunt it returns after the loot
// (no node flip, no quest progress), mirroring the original inlined behaviour.
function applyCombatVictory(state: RpgState, c: CombatState, lines: string[]): void {
  const node = state.nodes[c.nodeId];
  // Catch your breath after a victory: survivors bind wounds for a difficulty-
  // scaled slice of health, so a crawl is attrition the party can sustain.
  const breather = diffOf(state).breather;
  for (const m of state.party) {
    if (m.alive) m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * breather));
  }
  if (c.farm) {
    // A repeatable hunt: XP + light loot, but the site stays cleared (no quest
    // progress, no node flip). The grind that lets an under-levelled band catch
    // up before braving the finale.
    const xp = grantXp(state, 4 + node.danger * 2);
    const frng = makeRng(state.seed + state.step * 90007);
    const gold = Math.round((5 + node.danger * 4) * diffOf(state).loot);
    const items: Item[] = frng() < 0.4 ? [makePotion(frng, node.danger)] : [];
    lines.push(`The hunt pays off!${xp} ${applyLoot(state, { items, gold })}`);
    return;
  }
  const room = c.roomId ? (node.rooms || []).find(r => r.id === c.roomId) : null;
  if (room) {
    // A dungeon-crawl fight clears just this room, not the whole node.
    room.cleared = true;
    const isBoss = room.kind === 'boss';
    const xp = grantXp(state, isBoss ? 10 + node.danger * 3 : 5 + node.danger * 2);
    if (isBoss) {
      // Felling the boss clears the whole dungeon and drops the big hoard.
      node.cleared = true;
      const thanked = creditRegionForClear(state, node.id);  // the region breathes easier — settlements gain standing
      const lrng = makeRng(state.seed + state.step * 70001);
      lines.push(`The master of ${node.name} falls!${xp} ${applyLoot(state, rollLoot(lrng, node.danger, true))}${gratitudeLine(thanked)}`);
      // Defer the phase swap to endCombat (the player dismisses the result first).
      maybeWinQuest(state, false);
    } else {
      lines.push(`The room is cleared!${xp}`);
    }
  } else {
    // A whole-node fight (non-crawl place): clears the node outright.
    node.cleared = true;
    const thanked = creditRegionForClear(state, node.id);  // nearby settlements reward the cleared road
    const xp = grantXp(state, 6 + node.danger * 3);
    lines.push(`The battle is won!${xp}${gratitudeLine(thanked)}`);
    maybeWinQuest(state, false);
  }
}

// The hero's signature move, derived from their class archetype. Numbers are
// client-owned; the LLM only narrates the result. `cd` is rounds of cooldown.
export interface HeroSpecial { name: string; desc: string; key: StatKey; }

export function heroSpecial(state: RpgState): HeroSpecial {
  const hero = state.party.find(m => m.isHero) || state.party[0];
  const key = hero ? statProfile(hero.className).key : 'might';
  switch (key) {
    case 'agility': return { name: 'Aimed Shot', desc: 'Guaranteed critical on the target', key };
    case 'wits': return { name: 'Firebolt', desc: 'Heavy arcane burst on one foe', key };
    case 'spirit': return { name: 'Mend', desc: 'Heal the whole party', key };
    default: return { name: 'Cleave', desc: 'Strike every enemy at once', key };
  }
}

export function setCombatTarget(prev: RpgState, enemyId: string): RpgState {
  if (!prev.combat || prev.combat.over) return prev;
  const state = clone(prev);
  state.combat!.targetId = enemyId;
  return state;
}

function firstAliveEnemy(c: CombatState): Enemy | undefined {
  return c.enemies.find(e => e.alive);
}

export interface CombatTurnResult {
  state: RpgState;
  summary: string;      // mechanical round summary fed to /game/rpg/resolve
}

// The divine GM's voice on a fateful die — pushed even offline so the master of
// the game is always present at a critical moment (the LLM, when online, layers
// its own narration on top). Flavour only; the client already applied the dice.
const GM_CRIT_LINES = [
  'The god of the game leans close — that blow was written in the stars.',
  'A perfect strike. The master of the game proclaims it across the heavens.',
  'Fate itself bends; a divine hand guided that strike.',
  'The dice land true — the GM roars its approval.',
];
const GM_FUMBLE_LINES = [
  'The GM sighs from on high — the dice betray you.',
  'A fumble. The god of the game shakes its head in sorrow.',
  'Fortune turns her back; even the master of the game winces.',
  'The roll falls to ruin — the GM mourns the wasted breath.',
];
function gmFlourish(rng: () => number, crit: boolean): string {
  const t = crit ? GM_CRIT_LINES : GM_FUMBLE_LINES;
  return `» ${t[Math.floor(rng() * t.length)]}`;
}

// Resolve one full round: the party's chosen action, then the enemies' replies.
// Fully deterministic (seed + step). The LLM only narrates `summary` afterwards.
export function combatRound(prev: RpgState, action: CombatAction): CombatTurnResult {
  const state = clone(prev);
  const c = state.combat!;
  if (c.over) return { state, summary: '' };
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 2246822519);
  const lines: string[] = [];
  c.defending = false;
  // Headline d20 of the round — drives the on-screen dice throw + GM crit voice.
  let headline: RoundRoll | null = null;

  // Status conditions tick at the top of the round: foes burn/bleed out (lethal),
  // the party shrugs off poison short of death (floored at 1, like a hazard).
  for (const e of c.enemies) {
    if (!e.alive) continue;
    tickStatuses(e, lines, false);
    if (e.hp <= 0) killOrPhase(e, lines);
  }
  for (const m of state.party) {
    if (m.alive) tickStatuses(m, lines, true);
  }
  // A damage-over-time may finish the fight before the party can even act.
  if (!firstAliveEnemy(c)) { c.over = true; c.result = 'win'; }

  if (!c.over) {
  if (action === 'flee') {
    const chk = skillCheck(rng, partyBest(state, 'agility'), 11);
    headline = { value: chk.roll, total: chk.total, dc: chk.dc, success: chk.success, crit: chk.crit, fumble: chk.fumble, by: 'The party', round: c.round };
    c.lastRoll = headline;
    if (chk.success) {
      c.over = true;
      c.result = 'flee';
      lines.push(`The party flees the battle (rolled ${chk.roll} vs DC 11).`);
      c.log.push(...lines);
      return { state, summary: lines.join(' ') };
    }
    lines.push(`Escape fails (rolled ${chk.roll} vs DC 11)! The foes get a free strike.`);
  } else if (action === 'defend') {
    c.defending = true;
    lines.push('The party braces for impact, readying their signature move.');
  } else if (action === 'special') {
    const sp = heroSpecial(state);
    const hero = state.party.find(m => m.isHero) || state.party[0];
    const mod = hero ? hero.stats[sp.key] : 3;
    if (sp.name === 'Mend') {
      const heal = mod * 2 + roll(rng, 6).total;
      let cured = 0;
      for (const m of state.party) {
        if (!m.alive) continue;
        m.hp = Math.min(m.maxHp, m.hp + heal);
        if (hasStatus(m, 'poison')) { m.status = m.status!.filter(s => s.id !== 'poison'); cured++; }
      }
      lines.push(`${hero?.name || 'The hero'} channels Mend, restoring ${heal} HP to each ally${cured ? ' and purging their poison' : ''}.`);
    } else if (sp.name === 'Cleave') {
      // A might hero's sweep rends every foe and leaves the survivors bleeding.
      for (const e of c.enemies) {
        if (!e.alive) continue;
        const dmg = mod + roll(rng, 6).total;
        e.hp -= dmg;
        lines.push(`Cleave rends ${e.name} for ${dmg}.`);
        killOrPhase(e, lines);
        if (e.alive) addStatus(e, 'bleed', 2, 2);
      }
    } else {
      // Aimed Shot / Firebolt: a big single-target hit on the focused foe.
      const target = c.enemies.find(e => e.id === c.targetId && e.alive) || firstAliveEnemy(c);
      if (target) {
        const dmg = mod * (sp.name === 'Firebolt' ? 3 : 2) + roll(rng, 6).total + 4;
        target.hp -= dmg;
        lines.push(`${sp.name} blasts ${target.name} for ${dmg}!`);
        killOrPhase(target, lines);
        // Firebolt sets the foe alight; Aimed Shot cripples it (skips its next turn).
        if (target.alive) {
          if (sp.name === 'Firebolt') addStatus(target, 'burn', 2, Math.max(2, Math.floor(mod / 2)));
          else addStatus(target, 'stun', 1, 0);
        }
      }
    }
  } else {
    // Attack: every living member strikes the focused target (then the next). A
    // synergised band hits harder — the composition edge rides on every blow.
    const syn = teamSynergy(state).bonus;
    let target = c.enemies.find(e => e.id === c.targetId && e.alive) || firstAliveEnemy(c);
    let first = true;
    for (const m of state.party) {
      if (!m.alive) continue;
      if (!target || !target.alive) target = firstAliveEnemy(c);
      if (!target) break;
      // A fighter swings on might, a duelist on agility — each member attacks
      // with whichever martial stat is their best, so party comp matters. A
      // mutinous member fights distracted (−1 to that martial stat, ≥0).
      const off = Math.max(0, Math.max(m.stats.might, m.stats.agility) - (hasAffliction(m, 'mutinous') ? 1 : 0) + braveOffenseBonus(m));
      const chk = skillCheck(rng, off, 8);
      // The hero (first to swing) owns the visible die for the round.
      if (first) {
        headline = { value: chk.roll, total: chk.total, dc: chk.dc, success: chk.success, crit: chk.crit, fumble: chk.fumble, by: m.name, round: c.round };
        first = false;
      }
      if (chk.success) {
        const dmg = off + roll(rng, 6).total + (chk.crit ? 4 : 0) + syn;
        target.hp -= dmg;
        lines.push(`${m.name} hits ${target.name} for ${dmg}${chk.crit ? ' (CRITICAL HIT!)' : ''}.`);
        killOrPhase(target, lines);
        // A critical blow opens a bleeding wound on a surviving foe.
        if (chk.crit && target.alive) addStatus(target, 'bleed', 2, 2);
      } else {
        lines.push(`${m.name} ${chk.fumble ? 'fumbles, missing' : 'misses'} ${target.name}${chk.fumble ? ' (CRITICAL FAILURE!)' : ''}.`);
      }
    }
  }

  // The GM pronounces on a fateful die (crit or fumble) — present even offline.
  if (headline && (headline.crit || headline.fumble)) {
    lines.push(gmFlourish(rng, headline.crit));
  }
  c.lastRoll = headline;

  // Enemy turn (skipped only on a successful flee, handled above).
  const living = c.enemies.filter(e => e.alive);
  if (living.length === 0) {
    c.over = true;
    c.result = 'win';
  } else {
    for (const e of living) {
      // A stunned foe loses its turn (the round-start tick clears the stun next round).
      if (hasStatus(e, 'stun')) { lines.push(`${e.name} is stunned and cannot act.`); continue; }
      const targets = state.party.filter(m => m.alive);
      if (targets.length === 0) break;
      const victim = targets[Math.floor(rng() * targets.length)];
      let dmg = e.atk + roll(rng, 4).total;
      if (c.defending) dmg = Math.max(1, Math.floor(dmg / 3));
      victim.hp -= dmg;
      lines.push(`${e.name} strikes ${victim.name} for ${dmg}.`);
      if (victim.hp <= 0) { victim.alive = false; lines.push(`${victim.name} falls!`); }
      else {
        // Venomous foes (dangerous ground) leave a wound festering with poison.
        const danger = state.nodes[c.nodeId]?.danger ?? 0;
        if (danger >= 2 && rng() < 0.16 + danger * 0.04) {
          addStatus(victim, 'poison', 2, 1 + Math.floor(danger / 2));
          lines.push(`${victim.name} is poisoned!`);
        }
      }
    }
    if (!partyAlive(state)) { c.over = true; c.result = 'lose'; }
  }
  } // end if(!c.over) — skipped when a DoT already ended the fight

  // Special goes on cooldown when used; otherwise it recharges a step a round,
  // and a defended round recharges it faster (bracing = winding up the move).
  c.specialCd = action === 'special'
    ? 3
    : Math.max(0, (c.specialCd || 0) - (action === 'defend' ? 2 : 1));
  c.round += 1;
  c.log.push(...lines);

  // Apply win/lose consequences to the wider game state (shared with combatCommit).
  if (c.over && c.result === 'win') applyCombatVictory(state, c, lines);

  return { state, summary: lines.join(' ') };
}

// ── Tactical (CE2) round lifecycle ───────────────────────────────────────────
// The player drives a tactical round in three pure steps: assign each rolled die
// to a foe or to the party block (combatAssign), optionally push their luck to
// re-roll the leftovers for morale (combatPush), then commit to resolve the round
// (combatCommit). All seed-driven; the client owns every number, the LLM only
// narrates the committed outcome.

// Move one rolled die onto a target ('party' for the block wall, an enemy id to
// strike it, null to unassign). Illegal moves are no-ops (the engine guards it).
export function combatAssign(prev: RpgState, dieId: string, target: string | null): RpgState {
  if (!prev.combat || prev.combat.over || !prev.combat.pool) return prev;
  const state = clone(prev);
  const c = state.combat!;
  const enemyIds = c.enemies.filter(e => e.alive).map(e => e.id);
  c.pool = assignDie(c.pool!, dieId, target, enemyIds);
  return state;
}

// Push your luck: re-roll every UNASSIGNED die for an escalating morale cost.
// Committed dice are locked. No-op once the reroll budget is spent.
export function combatPush(prev: RpgState): RpgState {
  const c0 = prev.combat;
  if (!c0 || c0.over || !c0.pool) return prev;
  if ((c0.rerollsUsed ?? 0) >= (c0.maxRerolls ?? COMBAT_MAX_REROLLS)) return prev;
  const state = clone(prev);
  state.step += 1;
  const c = state.combat!;
  const rng = makeRng(state.seed + state.step * 374761393);
  adjustMorale(state, -(c.rerollCost ?? COMBAT_REROLL_BASE));
  c.pool = rerollUnassigned(c.pool!, state.party, rng);
  c.rerollsUsed = (c.rerollsUsed ?? 0) + 1;
  c.rerollCost = (c.rerollCost ?? COMBAT_REROLL_BASE) + COMBAT_REROLL_STEP;
  return state;
}

// Commit the assigned pool: resolve it against the foes' intents, apply the
// damage both ways, tick statuses, advance the round and roll the next one (or
// settle win/lose). Reuses the shared win pipeline (applyCombatVictory) so the
// tactical path stays behaviour-identical to the legacy round on a victory.
export function combatCommit(prev: RpgState): CombatTurnResult {
  const state = clone(prev);
  const c = state.combat!;
  if (c.over || !c.pool) return { state, summary: '' };
  state.step += 1;
  const rng = makeRng(state.seed + state.step * 2246822519);
  const lines: string[] = [];
  c.defending = false;

  // Status conditions tick at the top of the round (parity with the legacy round):
  // foes burn/bleed out (lethal), the party shrugs off poison short of death.
  for (const e of c.enemies) {
    if (!e.alive) continue;
    tickStatuses(e, lines, false);
    if (e.hp <= 0) killOrPhase(e, lines);
  }
  for (const m of state.party) {
    if (m.alive) tickStatuses(m, lines, true);
  }
  if (!firstAliveEnemy(c)) { c.over = true; c.result = 'win'; }

  if (!c.over) {
    const res = resolveCombat(c.pool, c.enemies, c.enemyPool || [], state.party, rng);
    c.lastResolution = res;
    if (res.partyBlock > 0) {
      lines.push(`The party raises a guard, soaking ${Math.min(res.partyBlock, res.incoming)} damage.`);
    }
    // The party's swords/stars land on the foes they were assigned to.
    for (const e of c.enemies) {
      if (!e.alive) continue;
      const dmg = res.enemyDamage[e.id] || 0;
      if (dmg <= 0) continue;
      e.hp -= dmg;
      lines.push(`The party strikes ${e.name} for ${dmg}.`);
      killOrPhase(e, lines);
    }
    // The foes' sword dice, what the block wall didn't soak, land on members.
    for (const md of res.memberDamage) {
      const m = state.party.find(p => p.id === md.memberId);
      if (!m || !m.alive) continue;
      m.hp -= md.amount;
      lines.push(`A foe breaks through and hits ${m.name} for ${md.amount}.`);
      if (m.hp <= 0) { m.alive = false; lines.push(`${m.name} falls!`); }
    }
    if (!firstAliveEnemy(c)) { c.over = true; c.result = 'win'; }
    else if (!partyAlive(state)) { c.over = true; c.result = 'lose'; }
  }

  c.specialCd = Math.max(0, (c.specialCd || 0) - 1);
  c.round += 1;
  c.log.push(...lines);

  if (c.over && c.result === 'win') {
    applyCombatVictory(state, c, lines);
    return { state, summary: lines.join(' ') };
  }
  // Fight continues: telegraph the next round's pool + intents.
  if (!c.over) rollTacticalRound(state, c);
  return { state, summary: lines.join(' ') };
}

// Apply the end-of-combat transition once the player dismisses the result.
export function endCombat(prev: RpgState): RpgState {
  const state = clone(prev);
  const c = state.combat;
  if (!c) return state;
  const node = state.nodes[c.nodeId];
  // A victory emboldens the party; a botched escape shakes them.
  if (partyAlive(state)) adjustMorale(state, c.result === 'win' ? 8 : c.result === 'flee' ? -6 : 0);
  // Status conditions are combat-scoped: poison/bleed/burn don't follow the party
  // out of a fight. Left in place they'd freeze (invisible, never ticking) and
  // re-ignite next combat — so clear them on exit.
  for (const m of state.party) if (m.status && m.status.length) m.status = [];
  // Persist which foes fell, keyed to the room (crawl) or the node (open site): a
  // win records the whole band, a flee records only the ones already cut down. The
  // roster redraws from this set, so survivors stay put and the slain stay gone —
  // no more "fight one, both vanish". Farm packs are ephemeral, never recorded.
  if (!c.farm) {
    const room = c.roomId ? (node.rooms || []).find(r => r.id === c.roomId) : null;
    const target: { defeatedFoes?: string[] } = room || node;
    const dead = new Set(target.defeatedFoes || []);
    for (const e of c.enemies) if (!e.alive) dead.add(e.id);
    target.defeatedFoes = Array.from(dead);
  }
  if (c.result === 'win' && questSatisfied(state)) {
    state.quest.done = true;
    state.phase = 'victory';
  } else if (!partyAlive(state)) {
    state.phase = 'gameover';
  } else {
    // Back to the screen the party was already on. A crawl keeps its room narration
    // (DungeonScene owns it); an open site refreshes its scene so cleared choices drop.
    state.phase = 'scene';
    if (!nodeRooms(node)) {
      state.scene = {
        nodeId: node.id,
        narration: node.blurb,
        choices: fallbackChoices(legalTags(state, node)),
        busy: false,
        fallback: true,
      };
    }
  }
  state.combat = null;
  return state;
}

// Compact battle situation for the GM narrator.
export function combatContext(state: RpgState): string {
  const c = state.combat!;
  const node = state.nodes[c.nodeId];
  const tags = (h: { status?: StatusEffect[] }) => {
    const a = (h.status || []).filter(s => s.rounds > 0).map(s => STATUS_META[s.id].label.toLowerCase());
    return a.length ? ` [${a.join(',')}]` : '';
  };
  // A short English cue per foe so the narrator can voice how it FIGHTS (its
  // tactics archetype) — the LLM "plays" the foe in prose, with zero combat
  // latency since the cue is just appended to the already-built context.
  const TACTICS_CUE: Record<string, string> = {
    aggressor: 'hunts the weakest', defender: 'guards and counters',
    skirmisher: 'knifes the frail then fades', brute: 'crashes the toughest',
    trickster: 'strikes unpredictably',
  };
  const cueOf = (e: { tactics?: string }) => TACTICS_CUE[e.tactics || 'trickster'] || '';
  const foes = c.enemies.map(e => `${e.name}(${e.alive ? `${e.hp}/${e.maxHp}hp` : 'dead'})${e.alive ? `${tags(e)} {${cueOf(e)}}` : ''}`).join(', ');
  const party = state.party.map(m => `${m.name}(${m.alive ? `${m.hp}/${m.maxHp}hp` : 'down'})${m.alive ? tags(m) : ''}`).join(', ');
  return `Battle at ${node.name}, round ${c.round}. Foes: ${foes}. Party: ${party}.`;
}




// Forge the next expedition's world for a campaign: LARGE only, difficulty from
// the campaign, and the persistent band (if any) transplanted in — rested, with
// their satchel and gold. The chapter count escalates danger a notch (like NG+)
// so the saga ramps. The lead is built from the chosen archetype on chapter 1.
export function buildCampaignWorld(
  setup: RpgSetupResult, theme: string, heroIndex: number, campaign: Campaign,
  sponsor?: { id: SponsorId; tier: number; name?: string; rank?: number }, perks?: string[],
  peopleId?: string,
): RpgState {
  const world = buildWorld(setup, theme, heroIndex, 'large', campaign.difficulty, undefined, sponsor, perks, peopleId);
  const chap = Math.max(0, campaign.chapter - 1);   // 0 on the first expedition
  if (campaign.party && campaign.party.length) {
    // Carry the seasoned band, fully rested for the new descent.
    world.party = campaign.party.map(ch => ({ ...ch, stats: { ...ch.stats }, hp: ch.maxHp, alive: true, status: undefined, affliction: undefined }));
    world.inventory = (campaign.inventory || []).map(i => ({ ...i }));
    world.gold = Math.max(0, Math.floor(campaign.gold || 0));
  }
  // Keep the enrollable pool tight (CE2 small crews; see CAMPAIGN_RECRUIT_CAP).
  // A full band leaves no room to recruit at all.
  const slots = Math.max(0, 4 - world.party.length);
  world.recruitPool = world.recruitPool.slice(0, Math.min(CAMPAIGN_RECRUIT_CAP, slots));
  world.ngPlus = chap;
  // Ramp the world a notch per chapter (capped), mirroring the NG+ escalation.
  if (chap > 0) {
    const bump = Math.min(2, chap);
    for (const id of world.order) {
      const nn = world.nodes[id];
      if (nn.id !== world.currentNodeId && nn.danger > 0) nn.danger = Math.min(3, nn.danger + bump);
    }
  }
  world.log = [chap > 0 ? `Chapter ${campaign.chapter}: ${setup.intro}` : setup.intro];
  return world;
}



// New Game+: forge a fresh world from a new setup, then transplant the veteran
// party (levels, stats, gear-boosted) into it, carrying their satchel and gold.
// The world is tougher (every danger node +1, clamped to 3) and the tier climbs.
// The trame is brand new — only the heroes (and their loot) cross over.
export function newGamePlus(prev: RpgState, setup: RpgSetupResult, theme: string, heroIndex: number, size: MapSize = 'medium'): RpgState {
  const fresh = buildWorld(setup, theme, heroIndex, size, prev.difficulty || 'normal');
  // Carry the seasoned party, fully rested for the new descent.
  fresh.party = prev.party.map(c => ({ ...c, stats: { ...c.stats }, hp: c.maxHp, alive: true }));
  // The haul is banked between runs (counted into the prior run's fame) — valuables
  // don't carry on, only the working kit does. Otherwise they'd be re-counted.
  fresh.inventory = (prev.inventory || []).filter(i => i.kind !== 'valuable').map(i => ({ ...i }));
  fresh.gold = prev.gold || 0;
  fresh.sponsor = prev.sponsor; // same backing club across the NG+ ladder (boon not re-granted)
  fresh.ngPlus = (prev.ngPlus || 0) + 1;
  // Crank the whole world a notch harder for the returning veterans.
  for (const id of fresh.order) {
    const n = fresh.nodes[id];
    if (n.id !== fresh.currentNodeId && n.danger > 0) n.danger = Math.min(3, n.danger + 1);
  }
  fresh.log = [`New Game+ ${fresh.ngPlus}: ${setup.intro}`];
  return fresh;
}

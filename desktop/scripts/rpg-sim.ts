// Headless finishability + balance harness for Monkey Quest.
// Auto-plays generated worlds with no LLM (mechanics are fully client-owned),
// walking start -> goal, clearing dungeons room by room and felling the final
// boss. Now sweeps the 3 difficulties, contrasts a SMART vs a NAIVE combat
// policy (so we can prove skill/choices matter), and exercises the farming
// zones (so an under-levelled band can grind up before the finale). Reports
// survival, attrition and finishability so we can judge balance per difficulty.
import {
  buildWorld, travelTo, startCombat, combatRound, endCombat,
  nodeRooms, currentRoom, advanceRoom, resolveRoom, usePotion,
} from '../src/game/rpg/state';
import type { RpgState, MapSize, Difficulty, CombatAction } from '../src/game/rpg/types';
import type { RpgSetupResult } from '../src/api';

const SETUP: RpgSetupResult = {
  title: 'The Sunken Crown',
  intro: 'A drowned kingdom calls for a hero to reclaim its crown.',
  locations: [
    { name: 'Hearthvale', kind: 'village', blurb: 'A quiet hamlet of fishers.' },
    { name: 'Greymarket', kind: 'town', blurb: 'A bustling river town.' },
    { name: 'Mistwood', kind: 'forest', blurb: 'Fog clings to the old pines.' },
    { name: 'Hollow Camp', kind: 'camp', blurb: 'Bandit fires flicker here.' },
    { name: 'Whispering Cave', kind: 'cave', blurb: 'Wet stone and echoes.' },
    { name: 'Broken Spire', kind: 'ruin', blurb: 'A toppled wizard tower.' },
    { name: 'The Drowned Wilds', kind: 'wild', blurb: 'Flooded marshland.' },
    { name: 'Crypt of the Crown', kind: 'dungeon', blurb: 'The throne lies deep below.' },
  ],
  heroes: [
    { className: 'Knight', blurb: 'Stalwart and brave.' },
    { className: 'Ranger', blurb: 'Keen-eyed wanderer.' },
    { className: 'Mage', blurb: 'Wielder of firebolts.' },
  ],
  quest: { title: 'Reclaim the Sunken Crown', desc: 'Descend the crypt and take the crown.' },
  fallback: true,
};

function bfsPath(state: RpgState, start: string, goal: string): string[] {
  const prev: Record<string, string | null> = { [start]: null };
  const q = [start];
  while (q.length) {
    const id = q.shift()!;
    if (id === goal) break;
    for (const nb of state.nodes[id].edges) {
      if (!(nb in prev)) { prev[nb] = id; q.push(nb); }
    }
  }
  const path: string[] = [];
  let cur: string | null = goal;
  while (cur) { path.unshift(cur); cur = prev[cur] ?? null; }
  return path;
}

interface Policy { potions: boolean; special: boolean; defend: boolean; }
const SMART: Policy = { potions: true, special: true, defend: true };
const NAIVE: Policy = { potions: false, special: false, defend: false };

// A wounded ally quaffs a potion when below 40% — exactly what the satchel UI
// lets a player do mid-fight (the party overlay is reachable in any phase).
function maybePotion(s: RpgState): RpgState {
  const hurt = s.party.find(c => c.alive && c.hp / c.maxHp < 0.4);
  const pot = (s.inventory || []).find(i => i.kind === 'potion');
  return hurt && pot ? usePotion(s, pot.id).state : s;
}

function partyRatio(s: RpgState): number {
  const live = s.party.filter(c => c.alive);
  if (!live.length) return 0;
  return live.reduce((a, c) => a + c.hp / c.maxHp, 0) / live.length;
}

function fight(state: RpgState, nodeId: string, pol: Policy, opts?: { roomId?: string | null; boss?: boolean; farm?: boolean }): RpgState {
  let s = startCombat(state, nodeId, opts);
  let guard = 0;
  while (s.combat && !s.combat.over && guard++ < 400) {
    if (pol.potions) s = maybePotion(s);
    const ready = (s.combat!.specialCd || 0) === 0;
    let action: CombatAction = 'attack';
    if (pol.special && ready) action = 'special';
    else if (pol.defend && partyRatio(s) < 0.3) action = 'defend';
    s = combatRound(s, action).state;
  }
  return endCombat(s);
}

function playDungeon(state: RpgState, nodeId: string, pol: Policy): RpgState {
  let s = state;
  let guard = 0;
  while (!s.nodes[nodeId].cleared && s.phase !== 'gameover' && guard++ < 200) {
    const node = s.nodes[nodeId];
    const room = currentRoom(node);
    if (!room) break;
    if (room.cleared) {
      const before = node.roomIndex;
      s = advanceRoom(s, nodeId);
      if (s.nodes[nodeId].roomIndex === before) break; // can't descend further
      continue;
    }
    if (room.kind === 'boss') s = fight(s, nodeId, pol, { roomId: room.id, boss: true });
    else if (room.kind === 'combat') s = fight(s, nodeId, pol, { roomId: room.id });
    else s = resolveRoom(s, nodeId).state;
  }
  return s;
}

function heroOf(s: RpgState) { return s.party.find(c => c.isHero) || s.party[0]; }

// Grind the farmable zones until the hero reaches the goal's recommended level.
// Hunts the highest-danger cleared farmable site directly (the satchel/scene
// "Hunt for XP" action), resting between hunts. Returns how many hunts it ran.
function farmToReqLevel(state: RpgState, pol: Policy, cap = 30): { state: RpgState; hunts: number } {
  let s = state;
  const goal = s.quest.goalNodeId;
  const req = s.nodes[goal].reqLevel ?? 4;
  let hunts = 0;
  while (heroOf(s).level < req && hunts < cap && s.phase !== 'gameover') {
    const farm = s.order
      .map(id => s.nodes[id])
      .filter(n => n.farmable && n.cleared && n.danger > 0)
      .sort((a, b) => b.danger - a.danger)[0];
    if (!farm) break;
    // Rest up between hunts (a real player would camp): full heal before the next.
    s = { ...s, party: s.party.map(c => ({ ...c, hp: c.alive ? c.maxHp : c.hp })) };
    s = fight(s, farm.id, pol, { farm: true });
    hunts++;
    if (s.phase !== 'victory' && s.phase !== 'gameover') s = { ...s, phase: 'world' };
  }
  return { state: s, hunts };
}

interface Run {
  victory: boolean; gameover: boolean; heroLevel: number; reqLevel: number;
  survivors: number; partySize: number; hunts: number;
}

interface Opts { recruit?: boolean; difficulty?: Difficulty; policy?: Policy; farm?: boolean; }

function playOne(size: MapSize, salt: number, o: Opts = {}): Run {
  const pol = o.policy || SMART;
  let s = buildWorld({ ...SETUP, intro: `${SETUP.intro} #${salt}` }, 'fantasy', 0, size, o.difficulty || 'normal');
  if (o.recruit !== false) s = { ...s, party: [...s.party, ...s.recruitPool].slice(0, 4), recruitPool: [] };
  const start = s.currentNodeId;
  const goal = s.quest.goalNodeId;
  const reqLevel = s.nodes[goal].reqLevel ?? 4;
  const path = bfsPath(s, start, goal);
  let hunts = 0;
  // Clear everything up to (not including) the goal.
  for (let i = 1; i < path.length - 1; i++) {
    const id = path[i];
    s = travelTo(s, id);
    const n = s.nodes[id];
    if (nodeRooms(n)) s = playDungeon(s, id, pol);
    else if (n.danger > 0) s = fight(s, id, pol);
    if (s.phase === 'gameover') break;
    if (s.phase !== 'victory') s = { ...s, phase: 'world' };
  }
  // Optionally grind the farming zones before the finale.
  if (o.farm && s.phase !== 'gameover') {
    const r = farmToReqLevel(s, pol);
    s = r.state; hunts = r.hunts;
    if (s.phase !== 'victory' && s.phase !== 'gameover') s = { ...s, phase: 'world' };
  }
  // The finale.
  if (s.phase !== 'gameover' && path.length >= 2) {
    s = travelTo(s, goal);
    const n = s.nodes[goal];
    if (nodeRooms(n)) s = playDungeon(s, goal, pol);
    else if (n.danger > 0) s = fight(s, goal, pol);
  }
  const hero = heroOf(s);
  return {
    victory: s.phase === 'victory', gameover: s.phase === 'gameover',
    heroLevel: hero.level, reqLevel,
    survivors: s.party.filter(c => c.alive).length, partySize: s.party.length, hunts,
  };
}

const N = 40;
const sizes: MapSize[] = ['small', 'medium', 'large'];

function report(label: string, runs: Run[]) {
  const wins = runs.filter(r => r.victory).length;
  const overs = runs.filter(r => r.gameover).length;
  const stuck = runs.filter(r => !r.victory && !r.gameover).length;
  const n = runs.length;
  const avg = (f: (r: Run) => number) => (runs.reduce((a, r) => a + f(r), 0) / n).toFixed(1);
  const range = (f: (r: Run) => number) => `${Math.min(...runs.map(f))}-${Math.max(...runs.map(f))}`;
  console.log(`  ${label.padEnd(34)} win ${String(wins).padStart(2)}/${n} (${String(Math.round(wins / n * 100)).padStart(3)}%)  over ${String(overs).padStart(2)}  stuck ${stuck}  Lv ${range(r => r.heroLevel)}/req${runs[0].reqLevel}  surv ${avg(r => r.survivors)}/${avg(r => r.partySize)}  hunts ${avg(r => r.hunts)}`);
}

const diffs: Difficulty[] = ['easy', 'normal', 'hard'];

// 1) Difficulty sweep — built band, smart play, potions on. Finishability curve.
console.log('\n== built party · SMART · per difficulty/size ==');
for (const d of diffs) for (const size of sizes)
  report(`${d}·${size}`, Array.from({ length: N }, (_, i) => playOne(size, i + 1, { difficulty: d })));

// 2) Choices matter — solo hero (the tight envelope), SMART vs NAIVE.
//    A full party brute-forces anything; solo is where special/potion/defend bite.
console.log('\n== choices matter · solo+farm · medium · SMART vs NAIVE ==');
for (const d of diffs) {
  report(`${d} SMART`, Array.from({ length: N }, (_, i) => playOne('medium', i + 1, { recruit: false, farm: true, difficulty: d, policy: SMART })));
  report(`${d} NAIVE`, Array.from({ length: N }, (_, i) => playOne('medium', i + 1, { recruit: false, farm: true, difficulty: d, policy: NAIVE })));
}

// 3) Farming matters — solo hero, no-farm rush vs farm-first, per difficulty.
console.log('\n== farming matters · solo · medium · rush vs farmed ==');
for (const d of diffs) {
  report(`${d} rush  `, Array.from({ length: N }, (_, i) => playOne('medium', i + 1, { recruit: false, difficulty: d, farm: false })));
  report(`${d} farmed`, Array.from({ length: N }, (_, i) => playOne('medium', i + 1, { recruit: false, difficulty: d, farm: true })));
}

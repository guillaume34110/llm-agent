import type {
  RpgState, MapNode, Difficulty, Rival, RivalDisposition, RivalEncounterState, RivalOption,
} from './types';
import { makeRng } from './dice';
import { loadHub } from './meta';
import { questSatisfied } from './quest';
import { uid } from './ids';

// ── Rivals / challengers (competing expeditions; client-owned) ───────────────
const RIVAL_NAMES = [
  'Captain Voss', 'Mara Quill', 'the Ashford Expedition', 'Dr. Sable',
  'the Vane Company', 'Lord Crane', 'Salt & Thorn', 'the Greywind Party',
];
const RIVAL_GLYPHS = ['▲', '◆', '✦', '✚', '✸'];
const RIVAL_BLURBS = [
  'a seasoned crew chasing the same prize',
  'a ruthless band that brooks no second place',
  'a well-funded company with maps you would kill for',
  'an old acquaintance, all smiles and sharp elbows',
];
// Progress a rival gains per party leg. Tuned so a medium map is a real race but
// the player, moving with purpose, can win. NG+/difficulty lean it harder.
const RIVAL_PACE: Record<Difficulty, number> = { easy: 0.05, normal: 0.08, hard: 0.115 };

// Shortest path (node ids, inclusive) from `a` to `b` over the map graph. BFS on
// the undirected edges. Returns [a] if unreachable (defensive; the graph is connected).
function bfsPath(nodes: Record<string, MapNode>, a: string, b: string): string[] {
  if (a === b) return [a];
  const prev: Record<string, string> = {};
  const seen = new Set<string>([a]);
  const q = [a];
  while (q.length) {
    const id = q.shift()!;
    for (const nb of nodes[id].edges) {
      if (seen.has(nb)) continue;
      seen.add(nb); prev[nb] = id; q.push(nb);
      if (nb === b) { q.length = 0; break; }
    }
  }
  if (!prev[b] && a !== b && nodes[b].edges.indexOf(a) < 0 && !seen.has(b)) return [a];
  const path = [b];
  let cur = b;
  while (cur !== a && prev[cur]) { cur = prev[cur]; path.push(cur); }
  return path.reverse();
}

// The node a rival stands on for a given progress along its path.
export function rivalNodeAt(rival: Rival): string {
  if (rival.path.length === 0) return rival.nodeId;
  const i = Math.min(rival.path.length - 1, Math.max(0, Math.round(rival.progress * (rival.path.length - 1))));
  return rival.path[i];
}

// Seed the competing expeditions at world-build. Spawns one (small) or two rivals
// at nodes a few hops from the start, each with a precomputed route to the goal.
// `entropy` rolls the rival *identity* (who shows up, where, how hostile) off a
// fresh source rather than the content-derived world seed, so the same conjured
// world does not always field the exact same outsider. It is replay-safe: the
// rivals are persisted in `state.rivals`, never re-derived from the seed on load.
export function spawnRivals(
  nodes: Record<string, MapNode>, order: string[],
  startNodeId: string, goalNodeId: string, difficulty: Difficulty, seed: number,
  entropy: number,
): Rival[] {
  const rng = makeRng((seed ^ 0x21a1c0 ^ Math.floor(entropy)) >>> 0);
  // Candidate spawns: not the start, not the goal, with a real path to the goal.
  const cands = order.filter(id => {
    if (id === startNodeId || id === goalNodeId) return false;
    const p = bfsPath(nodes, id, goalNodeId);
    return p.length >= 2 && p[p.length - 1] === goalNodeId;
  });
  if (cands.length === 0) return [];
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  const count = Math.min(cands.length, order.length >= 10 ? 2 : 1);
  const dispositions: RivalDisposition[] = ['rival', 'cutthroat', 'genial'];
  const basePace = RIVAL_PACE[difficulty] || RIVAL_PACE.normal;
  // A standing grudge (a rival who beat you last run) returns as the lead rival —
  // same name/glyph, harder pace, openly hostile. loadHub is node-safe (catches the
  // localStorage ReferenceError in tests/SSR and returns an empty hub → no nemesis).
  const nemesis = loadHub().nemesis;
  const rivals: Rival[] = [];
  for (let k = 0; k < count; k++) {
    const spawn = cands[k];
    const path = bfsPath(nodes, spawn, goalNodeId);
    // Already underway: a competing expedition that set out ahead of you, scattered
    // along its route + pace jitter — so the race never opens with everyone bunched
    // at the start line (you trail at the gate; rivals are spread out in front).
    const progress = Math.max(0.06, Math.min(0.34, 0.1 + rng() * 0.22));
    const pace = basePace * (0.85 + rng() * 0.4);
    const isNemesis = k === 0 && !!nemesis;
    rivals.push({
      id: uid('rival'),
      name: isNemesis ? nemesis!.name : RIVAL_NAMES[Math.floor(rng() * RIVAL_NAMES.length)],
      glyph: isNemesis ? nemesis!.glyph : RIVAL_GLYPHS[k % RIVAL_GLYPHS.length],
      blurb: isNemesis
        ? `an old enemy returned${nemesis!.wins > 1 ? ` — they have bested you ${nemesis!.wins} times` : ''}, out for the prize again`
        : RIVAL_BLURBS[Math.floor(rng() * RIVAL_BLURBS.length)],
      path, progress, pace: isNemesis ? pace * 1.1 : pace,
      nodeId: '', disposition: isNemesis ? 'cutthroat' : dispositions[Math.floor(rng() * dispositions.length)],
      met: false, hindered: 0, arrived: false,
      ...(isNemesis ? { nemesis: true } : {}),
    });
    rivals[k].nodeId = rivalNodeAt(rivals[k]);
  }
  return rivals;
}

// Advance every rival one party-leg of progress (slowed while hindered). `frac`
// scales the step: 1 for a full travel leg, 0.5 when the party merely lingers
// (camps, descends a dungeon) so time presses everywhere but the goal site. The
// hindered counter only burns down on a full leg. Returns the names of any rival
// that just reached the goal (won the race). Mutates state.
export function tickRivals(state: RpgState, frac = 1): string[] {
  const won: string[] = [];
  for (const r of state.rivals || []) {
    if (r.arrived) continue;
    const eff = (r.hindered > 0 ? r.pace * 0.4 : r.pace) * frac;
    if (r.hindered > 0 && frac >= 1) r.hindered -= 1;
    r.progress = Math.min(1, r.progress + eff);
    r.nodeId = rivalNodeAt(r);
    if (r.progress >= 1) { r.arrived = true; won.push(r.name); }
  }
  return won;
}

// Apply the half-leg pressure for an in-place action (rest, dungeon descent). The
// party doesn't advance, but rivals do — UNLESS the party already stands on the
// goal site, where the final crawl must stay winnable. Sets phase 'gameover' if a
// rival snatches the prize. Returns the winner's name when the run is lost (so the
// caller can fold it into its own outcome line), else null. Mutates state.
export function pressRivalsInPlace(state: RpgState): string | null {
  if (!(state.rivals && state.rivals.length)) return null;
  if (state.currentNodeId === state.quest.goalNodeId) return null;
  const raceWon = tickRivals(state, 0.5);
  if (raceWon.length && !questSatisfied(state)) {
    state.phase = 'gameover';
    return raceWon[0];
  }
  return null;
}

// Open a rival meeting if a (non-arrived) rival stands on the node just reached and
// the party hasn't already won. Sets phase 'rival'. Returns true if one fired.
export function maybeRivalEncounter(state: RpgState, nodeId: string): boolean {
  if (state.quest.done) return false;
  const r = (state.rivals || []).find(x => !x.arrived && x.nodeId === nodeId);
  if (!r) return false;
  r.met = true;
  state.rivalEncounter = rollRivalEncounter(state, r, nodeId);
  state.phase = 'rival';
  return true;
}

// Build the meeting's options. Sabotage (agility) slows the rival; parley (spirit)
// trades for ground/intel; race (no roll) just presses on. A fourth tactic is
// flavoured by the rival's disposition: a genial crew trades maps (no roll), a
// cutthroat one can be faced down (might), a true rival wagers a sprint (agility).
// DCs are client-owned.
function rollRivalEncounter(state: RpgState, r: Rival, nodeId: string): RivalEncounterState {
  const danger = state.nodes[nodeId]?.danger ?? 1;
  const dc = 11 + danger;
  const flavour = r.nemesis
    ? 'Old scores hang in the air — they remember beating you.'
    : r.disposition === 'genial' ? 'They hail you warmly, rivals but not enemies.'
    : r.disposition === 'cutthroat' ? 'Hands rest on hilts; they want you gone.'
    : 'They size you up, hungry for the same prize.';
  const prompt = `${r.name} — ${r.blurb} — blocks the road, racing you for the prize. ${flavour}`;
  const options: RivalOption[] = [
    { label: 'Press on past them', tactic: 'race' },
    { label: 'Sabotage their camp', tactic: 'sabotage', stat: 'agility', dc },
    { label: 'Parley for terms', tactic: 'parley', stat: 'spirit', dc: dc - 2 },
  ];
  if (r.disposition === 'genial') options.push({ label: 'Trade maps over a fire', tactic: 'trade' });
  else if (r.disposition === 'cutthroat') options.push({ label: 'Stand your ground', tactic: 'standoff', stat: 'might', dc: dc + 1 });
  else options.push({ label: 'Wager a race to the next ridge', tactic: 'wager', stat: 'agility', dc });
  return { rivalId: r.id, nodeId, prompt, options, resolved: false };
}

// The live race standings for the in-run ledger. The party's progress is its graph
// distance to the goal, normalised by the map's farthest reach toward that goal, so
// 0 = the deepest corner and 1 = standing on the prize. Each non-arrived rival
// reports its own path progress. All client-owned; nothing here is authored by the
// LLM. `leader` is whoever (party or a rival) is currently closest to the goal.
export function raceTracker(state: RpgState): {
  party: number;
  rivals: { name: string; glyph: string; pct: number; nemesis: boolean; arrived: boolean }[];
  leader: 'party' | 'rival';
} {
  const nodes = state.nodes;
  const goal = state.quest.goalNodeId;
  let party = 0;
  if (state.currentNodeId === goal) party = 1;
  else if (nodes[goal]) {
    // BFS depth from the goal over the whole graph → the denominator (farthest node).
    const depth: Record<string, number> = { [goal]: 0 };
    const q = [goal];
    let maxD = 0;
    while (q.length) {
      const id = q.shift()!;
      for (const nb of nodes[id].edges) {
        if (depth[nb] === undefined) { depth[nb] = depth[id] + 1; maxD = Math.max(maxD, depth[nb]); q.push(nb); }
      }
    }
    const dCur = depth[state.currentNodeId];
    party = maxD > 0 && dCur !== undefined ? Math.max(0, Math.min(1, 1 - dCur / maxD)) : 0;
  }
  const rivals = (state.rivals || []).map(r => ({
    name: r.name, glyph: r.glyph, pct: Math.max(0, Math.min(1, r.progress)), nemesis: !!r.nemesis, arrived: r.arrived,
  }));
  const topRival = rivals.reduce((m, r) => Math.max(m, r.pct), 0);
  return { party, rivals, leader: party >= topRival ? 'party' : 'rival' };
}

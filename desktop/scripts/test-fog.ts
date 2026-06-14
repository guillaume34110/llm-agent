// Fog-of-war / scouting regression — P2 of the Curious-Expedition fusion. Discovery
// now has two layers: `discovered` (a landmark shows on the map) and `scouted` (its
// nature — kind + danger — is known; until then it renders as "?"). Arriving scouts a
// place; `look` scouts the surroundings; an NPC's directions/warning scout what they
// name; the goal is scouted from the outset. Every flag is client-owned — the LLM
// authors nothing.
//
// Run: npx tsx scripts/test-fog.ts

// localStorage shim so saveState/loadState (the backfill test) work under node.
const _store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (_store.has(k) ? _store.get(k)! : null),
  setItem: (k: string, v: string) => { _store.set(k, v); },
  removeItem: (k: string) => { _store.delete(k); },
  clear: () => { _store.clear(); },
  key: () => null,
  length: 0,
} as Storage;

import {
  buildWorld, beginTravel, arriveTravel, applyAction, saveState, loadState,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState } from '../src/game/rpg/types';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

function fakeSetup(): RpgSetupResult {
  const loc = (i: number) => ({ name: `Place ${i}`, kind: ['village', 'town', 'wild', 'forest', 'ruin', 'cave'][i % 6], blurb: 'x' });
  return {
    title: 'World', intro: 'intro',
    locations: Array.from({ length: 8 }, (_, i) => loc(i)),
    heroes: [{ className: 'Knight', blurb: 'b' }, { className: 'Scout', blurb: 'b' }, { className: 'Sage', blurb: 'b' }],
    quest: { title: 'Q', desc: 'D' },
    fallback: false,
  };
}

// ── buildWorld: the start is scouted, its roads only discovered, the goal is scouted ─
console.log('buildWorld:');
{
  const s = buildWorld(fakeSetup(), 'fog', 0, 'medium');
  const start = s.nodes[s.currentNodeId];
  ok(start.discovered && start.scouted && start.visited, 'the start is discovered, scouted and visited');
  const nbs = start.edges.map(id => s.nodes[id]);
  ok(nbs.length > 0 && nbs.every(n => n.discovered), "the start's neighbours are discovered (roads visible)");
  ok(nbs.some(n => !n.scouted), 'at least one neighbour is NOT yet scouted (its nature is unknown)');
  const goal = s.nodes[s.quest.goalNodeId];
  ok(goal.scouted, 'the quest goal is scouted from the outset (its finale is known once found)');
  // Aside from the goal, scouted implies discovered (the map gates display on discovered).
  ok(s.order.every(id => { const n = s.nodes[id]; return id === s.quest.goalNodeId || n.discovered || !n.scouted; }),
    'no ordinary node is scouted while still undiscovered');
}

// ── look: scouts adjacent places (identifies discovered-but-unscouted neighbours) ──
console.log('\nlook scouts:');
{
  const s = buildWorld(fakeSetup(), 'look', 0, 'medium');
  const here = s.nodes[s.currentNodeId];
  const unscoutedBefore = here.edges.filter(id => !s.nodes[id].scouted);
  ok(unscoutedBefore.length > 0, 'some neighbours start unscouted');
  const r = applyAction(s, 'look', here);
  ok(here.edges.every(id => r.state.nodes[id].scouted), 'after look every neighbour is scouted');
  ok(/make out what lies at|spot the way|surroundings/.test(r.outcome), 'look reports what it scouted');
  // look does not reach beyond the immediate neighbours.
  const far = s.order.filter(id => !here.edges.includes(id) && id !== here.id);
  ok(far.some(id => !r.state.nodes[id].scouted), 'look does not scout non-adjacent places');
}

// ── arrival: travelling to a place scouts it; its onward roads stay unscouted ──────
console.log('\narrival scouts:');
{
  const s = buildWorld(fakeSetup(), 'travel', 0, 'medium');
  const here = s.nodes[s.currentNodeId];
  // pick a neighbour that is discovered but not yet scouted (the "?" we travel into)
  const dest = here.edges.find(id => !s.nodes[id].scouted) ?? here.edges[0];
  ok(!s.nodes[dest].scouted, 'the destination is unknown (unscouted) before we set out');
  const begun = beginTravel(s, dest);
  begun.travel!.event = 'none';   // isolate arrival from road events
  const after = arriveTravel(begun);
  ok(after.nodes[dest].scouted && after.nodes[dest].visited, 'arriving scouts and visits the destination');
  // The destination's own neighbours (other than where we came from) are discovered but unknown.
  const onward = after.nodes[dest].edges.filter(id => id !== here.id);
  ok(onward.every(id => after.nodes[id].discovered), 'onward roads from the destination are now visible');
  ok(onward.some(id => !after.nodes[id].scouted) || onward.length === 0,
    'onward places stay unscouted (the fog only lifts one step)');
}

// ── clone keeps the scouted flag (no aliasing / no loss across a turn) ─────────────
console.log('\nclone preserves scouted:');
{
  const s = buildWorld(fakeSetup(), 'clone', 0, 'medium');
  const here = s.nodes[s.currentNodeId];
  applyAction(s, 'look', here);                 // mutates a clone, not `s`
  ok(here.edges.some(id => !s.nodes[id].scouted), 'the source state is untouched by look (acts on a clone)');
  const r = applyAction(s, 'search', here);     // any action clones the nodes
  ok(r.state.nodes[s.currentNodeId].scouted, 'the start stays scouted through a clone');
}

// ── loadState backfill: a pre-scouting save keeps the old "discovered = shown" rule ─
console.log('\nlegacy backfill:');
{
  const s = buildWorld(fakeSetup(), 'legacy', 0, 'medium');
  // Pick one discovered and one undiscovered node, strip the new flag to mimic an old save.
  const disc = s.order.find(id => s.nodes[id].discovered)!;
  const hidden = s.order.find(id => !s.nodes[id].discovered)!;
  delete (s.nodes[disc] as { scouted?: boolean }).scouted;
  delete (s.nodes[hidden] as { scouted?: boolean }).scouted;
  saveState(s);
  const loaded = loadState() as RpgState;
  ok(loaded.nodes[disc].scouted === true, 'a discovered legacy node loads as scouted (old behaviour preserved)');
  ok(loaded.nodes[hidden].scouted === false, 'an undiscovered legacy node loads as unscouted');
}

if (failures) {
  console.error(`\nFOG: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nFOG: all good ✓');

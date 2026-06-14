// Objective + rivals regression — the ABC lot of the Curious-Expedition fusion.
//   A. A quest goal is one of: slay the master / retrieve the relic / both.
//   B. Rival expeditions race the party to the goal; reaching it first loses the run.
//   C. (covered elsewhere — low-morale hallucinations are pure narration.)
// Every win/loss decision is computed client-side (client-owns-numbers): the LLM
// never authors a victory. This asserts questSatisfied() is the single authority
// and that the three objective shapes never drift from it.
//
// Run: npx tsx scripts/test-objective.ts
import {
  buildWorld, questSatisfied, resolveRival, closeRival,
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

// Find a seed whose world rolls the wanted objective (the pick is seeded, so we
// just scan a few worlds until each shape appears).
function worldWithObjective(want: 'slay' | 'retrieve' | 'both'): RpgState | null {
  for (let seed = 0; seed < 200; seed++) {
    const s = buildWorld(fakeSetup(), `obj-${seed}`, 0, 'medium');
    if ((s.quest.objective || 'slay') === want) return s;
  }
  return null;
}

// ── all three objective shapes are reachable, each with the right invariants ──
console.log('objective shapes spawn:');
{
  const slay = worldWithObjective('slay');
  const retr = worldWithObjective('retrieve');
  const both = worldWithObjective('both');
  ok(!!slay, 'a slay objective is rolled within 200 seeds');
  ok(!!retr, 'a retrieve objective is rolled within 200 seeds');
  ok(!!both, 'a both objective is rolled within 200 seeds');

  if (slay) {
    ok(slay.quest.relicName === undefined, 'slay run has no relic name');
    ok(slay.quest.relicClaimed === undefined, 'slay run never tracks a relic');
  }
  for (const s of [retr, both]) if (s) {
    ok(!!s.quest.relicName, `${s.quest.objective} run names a relic`);
    ok(s.quest.relicClaimed === false, `${s.quest.objective} run starts with the relic unclaimed`);
    const goal = s.nodes[s.quest.goalNodeId];
    const relicRoom = (goal.rooms || []).find(r => r.relic);
    ok(!!relicRoom, `${s.quest.objective} run flags a relic-bearing room in the goal dungeon`);
    ok(relicRoom?.kind !== 'boss', 'the relic is never in the boss room (a pure retrieve may skip the boss)');
  }
}

// ── questSatisfied is the single source of truth for each shape ───────────────
console.log('\nquestSatisfied authority:');
{
  const s = worldWithObjective('both')!;
  const goal = s.nodes[s.quest.goalNodeId];
  // nothing done yet
  ok(!questSatisfied(s), 'both: not satisfied with neither boss nor relic');
  // only the relic
  s.quest.relicClaimed = true;
  ok(!questSatisfied(s), 'both: relic alone does not satisfy');
  // relic + boss
  goal.cleared = true;
  ok(questSatisfied(s), 'both: relic + slain master satisfies');

  const r = worldWithObjective('retrieve')!;
  const rg = r.nodes[r.quest.goalNodeId];
  rg.cleared = true;
  ok(!questSatisfied(r), 'retrieve: slaying the master alone does NOT win');
  r.quest.relicClaimed = true;
  ok(questSatisfied(r), 'retrieve: claiming the relic wins (boss optional)');

  const sl = worldWithObjective('slay')!;
  const sg = sl.nodes[sl.quest.goalNodeId];
  ok(!questSatisfied(sl), 'slay: not satisfied before the boss falls');
  sg.cleared = true;
  ok(questSatisfied(sl), 'slay: felling the master wins (no relic needed)');
}

// ── NON-REGRESSION: the classic slay flow still wins on a cleared goal node ───
console.log('\nnon-regression (slay parity):');
{
  const sl = worldWithObjective('slay')!;
  sl.nodes[sl.quest.goalNodeId].cleared = true;
  ok(questSatisfied(sl), 'a cleared goal node satisfies a slay quest (shipped behaviour preserved)');
}

// ── rivals spawn, advance, and a rival reaching the goal is a derivable loss ──
console.log('\nrivals race:');
{
  // Find a world that actually spawned a rival (small maps may spawn none).
  let withRival: RpgState | null = null;
  for (let seed = 0; seed < 200 && !withRival; seed++) {
    const s = buildWorld(fakeSetup(), `riv-${seed}`, 0, 'large');
    if (s.rivals.length > 0) withRival = s;
  }
  ok(!!withRival, 'a large world spawns at least one rival within 200 seeds');
  if (withRival) {
    const r = withRival.rivals[0];
    ok(r.progress >= 0 && r.progress < 1, 'a fresh rival starts short of the goal');
    ok(r.path.length >= 2 && r.path[r.path.length - 1] === withRival.quest.goalNodeId, 'a rival path ends at the goal');
    ok(r.pace > 0, 'a rival has a positive pace');
    ok(!r.arrived, 'a fresh rival has not arrived');
  }
}

// ── rival encounter: a parley/sabotage roll is client-owned, idempotent ───────
console.log('\nrival encounter resolution:');
{
  const s = worldWithObjective('slay')!;
  // Hand-stage an encounter so we can drive it deterministically.
  const rival = {
    id: 'rival_test', name: 'Captain Voss', glyph: '▲', blurb: 'a test rival',
    path: [s.currentNodeId, s.quest.goalNodeId], progress: 0.3, pace: 0.08,
    nodeId: s.currentNodeId, disposition: 'rival' as const, met: true, hindered: 0, arrived: false,
  };
  s.rivals = [rival];
  s.phase = 'rival';
  s.rivalEncounter = {
    rivalId: 'rival_test', nodeId: s.currentNodeId, prompt: 'They block the road.',
    options: [
      { label: 'Press on', tactic: 'race' },
      { label: 'Sabotage', tactic: 'sabotage', stat: 'agility', dc: 12 },
      { label: 'Parley', tactic: 'parley', stat: 'spirit', dc: 10 },
    ],
    resolved: false,
  };

  // Race: no roll, a sure morale lift, a ration burned.
  const m0 = s.morale, p0 = s.provisions;
  const raced = resolveRival(s, 0);
  ok(raced.rivalEncounter!.resolved, 'race resolves the encounter');
  ok(raced.rivalEncounter!.roll === undefined, 'race surfaces no die');
  ok(raced.morale === Math.min(100, m0 + 3), `race lifts morale (+3, ${m0} → ${raced.morale})`);
  ok(raced.provisions === Math.max(0, p0 - 1), 'race burns one ration');

  // Idempotence: resolving an already-resolved encounter is a no-op.
  const again = resolveRival(raced, 0);
  ok(again === raced, 'second resolve is a guarded no-op');

  // closeRival drops back to the scene.
  const closed = closeRival(raced);
  ok(closed.rivalEncounter === null, 'closeRival clears the encounter');
  ok(closed.phase === 'scene', 'closeRival returns to the scene');

  // Sabotage success slows the rival (hindered > 0); scan seeds for a success.
  let sawHinder = false;
  for (let seed = 1; seed < 400 && !sawHinder; seed++) {
    const t = worldWithObjective('slay')!;
    t.seed = seed;
    t.rivals = [{ ...rival, hindered: 0 }];
    t.phase = 'rival';
    t.rivalEncounter = {
      rivalId: 'rival_test', nodeId: t.currentNodeId, prompt: 'x',
      options: [{ label: 'Sabotage', tactic: 'sabotage', stat: 'agility', dc: 6 }],
      resolved: false,
    };
    const r = resolveRival(t, 0);
    if (r.rivalEncounter!.success === true) {
      sawHinder = true;
      ok(r.rivals[0].hindered > 0, 'a successful sabotage hinders the rival');
    }
  }
  ok(sawHinder, 'an easy sabotage can succeed within 400 seeds');
}

if (failures) {
  console.error(`\nOBJECTIVE: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nOBJECTIVE: all good ✓');

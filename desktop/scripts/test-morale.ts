// Morale regression — Step 1 of the Curious-Expedition fusion. Morale is a
// party-level resolve meter (0..100): it drains on the road, recovers at rest and
// in safe towns, tilts travel danger when low, and below ~15 a non-hero companion
// may desert (leave, never die). Every number is client-owned (state.ts).
//
// Run: npx tsx scripts/test-morale.ts
import {
  buildWorld, beginTravel, arriveTravel, applyAction,
  clampMorale, adjustMorale, moraleBand, MORALE_MAX,
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

// Walk the party to an adjacent node, fully playing the leg. Prefers a wild
// (non-settlement) destination so the safe-town morale bump doesn't mask drain.
function travelOnce(s: RpgState): RpgState {
  const here = s.nodes[s.currentNodeId];
  const wild = here.edges.find(e => {
    const k = s.nodes[e].kind; return k !== 'town' && k !== 'village';
  });
  return arriveTravel(beginTravel(s, wild ?? here.edges[0]));
}

// ── clamp + helpers ──────────────────────────────────────────────────────────
console.log('clamp / band:');
ok(clampMorale(150) === MORALE_MAX, 'clampMorale caps at MORALE_MAX');
ok(clampMorale(-20) === 0, 'clampMorale floors at 0');
ok(clampMorale(63.6) === 64, 'clampMorale rounds');
ok(moraleBand(100) === 'high' && moraleBand(70) === 'high', 'band high ≥70');
ok(moraleBand(40) === 'steady' && moraleBand(69) === 'steady', 'band steady 40..69');
ok(moraleBand(20) === 'low' && moraleBand(39) === 'low', 'band low 20..39');
ok(moraleBand(0) === 'breaking' && moraleBand(19) === 'breaking', 'band breaking <20');

// ── adjustMorale mutates in place + clamps + returns applied delta ───────────
console.log('\nadjustMorale:');
{
  const s = buildWorld(fakeSetup(), 'adj', 0, 'small');
  ok(s.morale === MORALE_MAX, 'fresh world starts at full morale');
  const d1 = adjustMorale(s, 5);
  ok(s.morale === MORALE_MAX && d1 === 0, 'cannot exceed max (delta clamped to 0)');
  const d2 = adjustMorale(s, -30);
  ok(s.morale === 70 && d2 === -30, 'drain applies and returns true delta');
  s.morale = 5; const d3 = adjustMorale(s, -40);
  ok(s.morale === 0 && d3 === -5, 'floor at 0, returns only the applied part');
}

// ── travel drains morale, stays clamped over a long march ────────────────────
console.log('\ntravel drain:');
{
  let s = buildWorld(fakeSetup(), 'drain', 0, 'medium');
  const before = s.morale;
  s = travelOnce(s);
  ok(s.morale < before, `one leg drains morale (${before} → ${s.morale})`);
  // March many legs; morale must never leave [0,100].
  let clamped = true;
  for (let i = 0; i < 40; i++) {
    s = s.phase === 'combat' ? s : travelOnce(s); // skip if a leg dropped us in a fight
    if (s.morale < 0 || s.morale > MORALE_MAX) clamped = false;
    if (s.phase === 'gameover' || s.phase === 'victory') break;
  }
  ok(clamped, 'morale stays within [0,100] across a long march');
}

// ── rest restores morale ─────────────────────────────────────────────────────
console.log('\nrest restore:');
{
  const s = buildWorld(fakeSetup(), 'rest', 0, 'small');
  s.morale = 40;
  const after = applyAction(s, 'rest', s.nodes[s.currentNodeId]).state;
  ok(after.morale > 40, `rest lifts morale (40 → ${after.morale})`);
  ok(after.morale <= MORALE_MAX, 'rest morale never exceeds max');
  // Rest at full morale must not break the clamp.
  const full = buildWorld(fakeSetup(), 'rest2', 0, 'small');
  const r2 = applyAction(full, 'rest', full.nodes[full.currentNodeId]).state;
  ok(r2.morale === MORALE_MAX, 'resting at full morale stays at max');
}

// ── low morale tilts the road darker (more ambush/hazard, fewer boons) ───────
console.log('\nlow-morale road tilt:');
{
  // Same world/seed, sample many legs at high vs low morale; count bad events.
  function badRate(startMorale: number): number {
    let bad = 0, n = 0;
    for (let seed = 0; seed < 200; seed++) {
      const s = buildWorld(fakeSetup(), `tilt-${seed}`, 0, 'medium');
      s.morale = startMorale;
      const dest = s.nodes[s.currentNodeId].edges[0];
      const ev = beginTravel(s, dest).travel?.event;
      if (ev === 'ambush' || ev === 'hazard') bad++;
      n++;
    }
    return bad / n;
  }
  const hi = badRate(100), lo = badRate(5);
  ok(lo > hi, `broken morale yields more bad events (${(lo * 100).toFixed(0)}% vs ${(hi * 100).toFixed(0)}%)`);
}

// ── desertion: below threshold a non-hero may leave; hero never does ─────────
console.log('\ndesertion:');
{
  // Search many seeds for a leg that triggers a desertion at rock-bottom morale.
  let sawDesert = false, heroEverLeft = false, emptied = false;
  for (let seed = 0; seed < 400 && !sawDesert; seed++) {
    const s = buildWorld(fakeSetup(), `desert-${seed}`, 0, 'medium');
    // Recruit the two companions so the party has someone to lose.
    s.party.push(s.recruitPool[0], s.recruitPool[1]);
    s.recruitPool = [];
    s.morale = 4;
    const dest = s.nodes[s.currentNodeId].edges.find(e => {
      const k = s.nodes[e].kind; return k !== 'town' && k !== 'village'; // avoid the safe-town bump
    });
    if (!dest) continue;
    const after = arriveTravel(beginTravel(s, dest));
    if (after.phase === 'combat') continue; // ambush defers desertion
    if (after.party.length < 3) {
      sawDesert = true;
      if (!after.party.some(c => c.isHero)) heroEverLeft = true;
      if (after.party.length === 0) emptied = true;
    }
  }
  ok(sawDesert, 'a companion can desert at rock-bottom morale');
  ok(!heroEverLeft, 'the hero never deserts');
  ok(!emptied, 'the party is never emptied by desertion');

  // High morale never triggers desertion.
  let desertAtHigh = false;
  for (let seed = 0; seed < 200; seed++) {
    const s = buildWorld(fakeSetup(), `nodesert-${seed}`, 0, 'medium');
    s.party.push(s.recruitPool[0]); s.recruitPool = [];
    const n0 = s.party.length;
    const dest = s.nodes[s.currentNodeId].edges[0];
    const after = arriveTravel(beginTravel(s, dest));
    if (after.phase !== 'combat' && after.party.length < n0) desertAtHigh = true;
  }
  ok(!desertAtHigh, 'no desertion while morale is healthy');
}

if (failures) {
  console.error(`\nMORALE: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nMORALE: all good ✓');

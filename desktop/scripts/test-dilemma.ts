// Dilemma regression — Step 2 of the Curious-Expedition fusion. The road throws a
// choice; the player picks an approach. A NO-STAT option is an instant, sure cost
// (auto `good`). A STAT-gated option opens a visible DICE POOL (one themed d6 per
// living member): the CLIENT rolls every face, the player may push their luck, and
// success = hits ≥ required (the DC only sets the difficulty). The LLM (or the
// fallback table) only authors strings — never a number. Every number asserted here
// is computed/clamped client-side (client-owns-numbers).
//
// Run: npx tsx scripts/test-dilemma.ts
import {
  buildWorld, beginTravel, arriveTravel,
  resolveDilemma, closeDilemma, commitDicePool, closeDicePool, MORALE_MAX,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState, DilemmaOption } from '../src/game/rpg/types';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

// Resolve a dilemma option to completion. A stat option opens a pool — commit it
// (no rerolls) so the consequence is applied. A no-stat option resolves at once.
function resolveStat(s: RpgState, idx: number): RpgState {
  const r = resolveDilemma(s, idx);
  return r.dicePool ? commitDicePool(r) : r;
}
// Dismiss a resolved dilemma (pool or instant) and land the party.
function close(s: RpgState): RpgState {
  return s.dicePool ? closeDicePool(s) : closeDilemma(s);
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

// Stage a hand-built dilemma on a fresh world (a neighbour of the start node is the
// landing target). Lets us drive resolveDilemma deterministically by seed.
function staged(seed: number, opt: DilemmaOption): RpgState {
  const s = buildWorld(fakeSetup(), `dil-${seed}`, 0, 'small');
  s.seed = seed;
  const dest = s.nodes[s.currentNodeId].edges[0];
  s.phase = 'dilemma';
  s.travel = null;
  s.dilemma = { nodeId: dest, prompt: 'A test crossroads.', options: [opt], resolved: false };
  return s;
}

// ── no-stat option auto-resolves to `good` (a sure trade, no die) ─────────────
console.log('no-roll option:');
{
  const s = staged(1, { label: 'Pay the toll', good: { gold: -18, morale: -3, text: 'You pay.' } });
  s.gold = 50;
  const goldBefore = s.gold;
  const r = resolveDilemma(s, 0);
  ok(r.dilemma!.resolved, 'resolved flag set');
  ok(r.dilemma!.success === undefined, 'no-roll option records no success/failure');
  ok(r.dilemma!.roll === undefined, 'no-roll option surfaces no die');
  ok(r.gold === goldBefore - 18, `good applied (gold ${goldBefore} → ${r.gold})`);
  ok(r.phase === 'dilemma', 'stays in dilemma phase until closed');
}

// ── gold spend clamps to what the party carries (never negative) ─────────────
console.log('\ngold clamp:');
{
  const s = staged(2, { label: 'Bribe', good: { gold: -18, text: 'You overpay.' } });
  s.gold = 5;
  const r = resolveDilemma(s, 0);
  ok(r.gold === 0, `gold floored at 0 (had 5, owed 18 → ${r.gold})`);
}

// ── a stat option opens a pool; HP damage on the bad branch never drops below 1 ─
console.log('\nstat option opens a pool + HP floor:');
{
  // A stat option opens a pool (no instant resolve); committing applies the branch.
  const probe = staged(3, { label: 'Risk it', stat: 'might', dc: 14, good: { text: 'safe' }, bad: { hp: -50, text: 'battered' } });
  const opened = resolveDilemma(probe, 0);
  ok(!!opened.dicePool && opened.dicePool.kind === 'dilemma', 'a stat option opens a dilemma pool');
  ok(opened.dilemma!.resolved === false, 'the dilemma is not resolved until the pool commits');

  // The bad branch (a fail outcome) deals lethal damage — assert the floor holds.
  let sawFail = false;
  for (let seed = 1; seed < 400 && !sawFail; seed++) {
    const s = staged(seed, { label: 'Risk it', stat: 'might', dc: 18, good: { text: 'safe' }, bad: { hp: -50, text: 'battered' } });
    for (const c of s.party) c.hp = 3;
    const r = commitDicePool(resolveDilemma(s, 0));
    if (r.dilemma!.success === false) {
      sawFail = true;
      ok(r.party.every(c => !c.alive || c.hp >= 1), 'a failed bad branch floors every living member at 1 HP');
    }
  }
  ok(sawFail, 'a hard pool check can fail within 400 seeds');
}

// ── success applies `good`, failure applies `bad`, deterministically by seed ──
console.log('\nsuccess / failure branches:');
{
  // An easy check (low DC ⇒ few hits required) succeeds on a lucky pool.
  let sawSuccess = false;
  for (let seed = 1; seed < 200 && !sawSuccess; seed++) {
    const s = staged(seed, { label: 'Try', stat: 'might', dc: 6, good: { gold: 40, text: 'won' }, bad: { gold: -40, text: 'lost' } });
    const g0 = s.gold;
    const r = commitDicePool(resolveDilemma(s, 0));
    if (r.dilemma!.success === true) {
      sawSuccess = true;
      ok(r.gold === g0 + 40, `success applies good (+40 gold, ${g0} → ${r.gold})`);
      ok(r.dicePool!.outcome === 'success', 'a success surfaces the success tier on the pool');
    }
  }
  ok(sawSuccess, 'an easy check (low DC) can succeed');

  // A brutal check (high DC ⇒ all dice must hit) fails on a poor pool.
  let sawFail = false;
  for (let seed = 1; seed < 400 && !sawFail; seed++) {
    const s = staged(seed, { label: 'Try', stat: 'might', dc: 18, good: { gold: 40, text: 'won' }, bad: { gold: -40, text: 'lost' } });
    s.gold = 100;
    const r = commitDicePool(resolveDilemma(s, 0));
    if (r.dilemma!.success === false) {
      sawFail = true;
      ok(r.gold === 60, `failure applies bad (-40 gold, 100 → ${r.gold})`);
    }
  }
  ok(sawFail, 'a brutal check (high DC) can fail');
}

// ── idempotent: resolving an already-resolved dilemma is a no-op ─────────────
console.log('\nidempotence:');
{
  const s = staged(7, { label: 'Pay', good: { gold: -10, text: 'paid' } });
  const r1 = resolveDilemma(s, 0);
  const goldAfterOne = r1.gold;
  const r2 = resolveDilemma(r1, 0);
  ok(r2.gold === goldAfterOne, 'second resolve does not re-apply the cost');
  ok(r2 === r1, 'second resolve returns the same state (guarded)');
}

// ── morale stays clamped through a dilemma swing ──────────────────────────────
console.log('\nmorale clamp:');
{
  const s = staged(8, { label: 'Rejoice', good: { morale: 50, text: 'spirits soar' } });
  s.morale = 80;
  const r = resolveDilemma(s, 0);
  ok(r.morale === MORALE_MAX, `morale caps at max (80 +50 → ${r.morale})`);
}

// ── closeDilemma lands the party at the destination and opens its scene ───────
console.log('\nclose → land:');
{
  const s = staged(9, { label: 'Pay', good: { gold: -5, text: 'paid' } });
  const dest = s.dilemma!.nodeId;
  const r = closeDilemma(resolveDilemma(s, 0));
  ok(r.phase === 'scene', 'phase becomes scene after closing');
  ok(r.currentNodeId === dest, 'party lands at the dilemma destination');
  ok(r.dilemma === null, 'dilemma cleared');
  ok(r.scene !== null && r.scene!.nodeId === dest, 'a scene opens at the destination');
  ok(r.nodes[dest].visited, 'destination marked visited');
}

// ── integration: travel can spring a dilemma; resolve+close returns to a scene ─
console.log('\nintegration (travel → dilemma → scene):');
{
  let sawDilemma = false;
  for (let seed = 0; seed < 400 && !sawDilemma; seed++) {
    let s = buildWorld(fakeSetup(), `int-${seed}`, 0, 'medium');
    const dest = s.nodes[s.currentNodeId].edges[0];
    s = arriveTravel(beginTravel(s, dest));
    if (s.phase === 'dilemma' && s.dilemma) {
      sawDilemma = true;
      ok(s.dilemma.options.length >= 2, 'a sprung dilemma offers ≥2 approaches');
      ok(s.dilemma.prompt.length > 0, 'the dilemma carries a prompt string');
      const after = close(resolveStat(s, 0));
      ok(after.phase === 'scene', 'after resolving+closing the party is back in a scene');
    }
  }
  ok(sawDilemma, 'travel springs a dilemma within 400 seeds');
}

if (failures) {
  console.error(`\nDILEMMA: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nDILEMMA: all good ✓');

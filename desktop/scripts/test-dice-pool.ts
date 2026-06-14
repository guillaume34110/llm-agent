// Dice-pool resolution — the Curious-Expedition signature. A search / stat-gated
// dilemma is resolved by rolling a POOL of d6 (one themed die per living member +
// item dice) instead of a hidden d20; the player tallies hits vs a required count
// and may push their luck (reroll the misses at an escalating morale cost). Every
// face is client-rolled; this asserts the hit math, the pool shape, the reroll
// cost/clamp, the outcome tiers, the consequences and determinism.
//
// Run: npx tsx scripts/test-dice-pool.ts
import {
  buildWorld, startSearchCheck, rerollDicePool, commitDicePool, closeDicePool,
  poolHits, resolveDilemma, MORALE_MAX,
} from '../src/game/rpg/state';
import { poolBonus, rollPoolDie, makeRng, POOL_HIT_TARGET } from '../src/game/rpg/dice';
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
    heroes: [{ className: 'Knight', blurb: 'b' }],
    quest: { title: 'Q', desc: 'D' },
    fallback: false,
  };
}

// Drive a node to a chosen danger, then open a search pool there.
function searchAt(seed: string, danger: number): RpgState {
  const s = buildWorld(fakeSetup(), seed, 0, 'medium');
  const node = s.nodes[s.currentNodeId];
  node.danger = danger;
  return startSearchCheck(s, node);
}

console.log('dice — hit math + bonus:');
{
  ok(poolBonus(2) === 1 && poolBonus(5) === 2 && poolBonus(7) === 3, 'poolBonus = floor(stat/2)');
  // A face that meets the target with the bonus is a hit; below it is a miss.
  const rng = makeRng(123);
  let hits = 0, n = 0, mismatch = false;
  for (let i = 0; i < 500; i++) {
    const r = rollPoolDie(rng, 0); n++;
    if (r.hit) hits++;
    if (r.hit !== (r.face + 0 >= POOL_HIT_TARGET)) mismatch = true;
  }
  ok(!mismatch, 'hit ⇔ face + bonus ≥ target, every roll');
  ok(hits > 0 && hits < n, 'a bonus-0 die both hits and misses across rolls');
  const rng2 = makeRng(7);
  let auto = true;
  for (let i = 0; i < 200; i++) { const r = rollPoolDie(rng2, 3); if (!r.hit) auto = false; }
  ok(auto, 'bonus +3 (a stat-7 veteran) auto-hits every face');
}

console.log('pool — shape: one die per living member, required ≤ size:');
{
  const p = searchAt('shape', 2).dicePool!;
  const s = buildWorld(fakeSetup(), 'shape', 0, 'medium');
  ok(p.dice.length === s.party.filter(c => c.alive).length, 'one die per living member (no gear)');
  ok(p.required >= 1 && p.required <= p.dice.length, 'required is within 1..poolSize');
  ok(p.stat === 'wits', 'search rolls WITS');
  ok(p.kind === 'search' && !p.resolved, 'pool is an unresolved search');
  ok(poolHits(p) === p.dice.filter(d => d.hit).length, 'poolHits counts the hit dice');
  // higher danger never makes required exceed the pool, but it does not get easier
  const easy = searchAt('shape', 0).dicePool!;
  const hard = searchAt('shape', 3).dicePool!;
  ok(hard.required >= easy.required, 'deeper danger needs at least as many hits');
}

console.log('reroll — push-your-luck: costs morale, escalates, clamps:');
{
  // Force a pool with at least one miss by scanning seeds.
  let st: RpgState | null = null;
  for (let i = 0; i < 200 && !st; i++) {
    const cand = searchAt(`rr-${i}`, 1);
    if (cand.dicePool!.dice.some(d => !d.kept)) st = cand;
  }
  ok(!!st, 'found a pool with a missed die to reroll');
  const before = st!.dicePool!;
  const cost0 = before.rerollCost;
  const m0 = st!.morale;
  const after = rerollDicePool(st!);
  ok(after.morale === m0 - cost0, `reroll deducts the morale cost (${cost0})`);
  ok(after.dicePool!.rerollsUsed === 1, 'rerollsUsed increments');
  ok(after.dicePool!.rerollCost > cost0, 'the next reroll costs more (escalates)');
  // kept (hit) dice are never re-rolled — their faces are stable across a reroll.
  const keptBefore = before.dice.filter(d => d.kept).map(d => `${d.id}:${d.face}`).sort().join(',');
  const keptAfter = after.dicePool!.dice.filter(d => before.dice.find(b => b.id === d.id && b.kept)).map(d => `${d.id}:${d.face}`).sort().join(',');
  ok(keptBefore === keptAfter, 'a hit die keeps its face through a reroll');

  // Reroll is a no-op once morale cannot pay it.
  const broke = { ...after, morale: 0 } as RpgState;
  ok(rerollDicePool(broke) === broke, 'reroll is a no-op when morale cannot pay');

  // Reroll caps at maxRerolls.
  let cur = st!;
  for (let i = 0; i < 10; i++) { cur = { ...cur, morale: MORALE_MAX }; const nx = rerollDicePool(cur); cur = nx; }
  ok(cur.dicePool!.rerollsUsed <= cur.dicePool!.maxRerolls, 'rerolls never exceed the cap');
}

console.log('commit — outcome tiers + consequences:');
{
  // Build a synthetic resolved-state by committing a real pool, then assert the
  // tier matches hits vs required and the consequence is applied + clamped.
  const st = searchAt('commit', 2);
  // hurt the party so a success can heal something visible
  for (const c of st.party) c.hp = Math.max(1, c.hp - 8);
  const hpBefore = st.party.reduce((a, c) => a + c.hp, 0);
  const hits = poolHits(st.dicePool!);
  const required = st.dicePool!.required;
  const done = commitDicePool(st);
  const p = done.dicePool!;
  ok(p.resolved, 'commit resolves the pool');
  const expected = hits >= required ? 'success' : hits > 0 ? 'partial' : 'fail';
  ok(p.outcome === expected, `outcome tier matches hits (${hits}/${required} → ${expected})`);
  const hpAfter = done.party.reduce((a, c) => a + c.hp, 0);
  if (p.outcome === 'fail') ok(hpAfter <= hpBefore, 'a failed search never heals');
  else ok(hpAfter >= hpBefore, 'a paying search heals (or holds)');
  ok(!!p.resultText && /hits\)/.test(p.resultText), 'result text carries the hit tally');
  // commit is idempotent
  ok(commitDicePool(done) === done, 'commit is a no-op once resolved');
  // close clears the pool, scene survives (search stays in the place)
  const closed = closeDicePool(done);
  ok(closed.dicePool === null, 'close clears the pool');
}

console.log('dilemma — stat option opens a pool; no-stat option stays instant:');
{
  // Reach a dilemma by scanning travel seeds is heavy; instead inject a dilemma.
  const base = buildWorld(fakeSetup(), 'dil', 0, 'medium');
  const here = base.nodes[base.currentNodeId];
  const dest = base.nodes[here.edges[0]];
  const withStat: RpgState = {
    ...base,
    phase: 'dilemma',
    dilemma: {
      nodeId: dest.id, prompt: 'A toll bridge.', resolved: false,
      options: [
        { label: 'Force across', stat: 'might', dc: 12, good: { text: 'You shove through.', xp: 5 }, bad: { text: 'You take a beating.', hp: -4 } },
        { label: 'Pay the toll', good: { text: 'You hand over coin.', gold: -10 } },
      ],
    },
  };
  // stat option → opens a pool, dilemma not yet resolved
  const opened = resolveDilemma(withStat, 0);
  ok(!!opened.dicePool && opened.dicePool.kind === 'dilemma', 'stat option opens a dilemma pool');
  ok(opened.dilemma!.resolved === false, 'the dilemma is not resolved until commit');
  ok(opened.dicePool!.optionIndex === 0, 'the pool remembers the chosen option');
  // while a pool is open, choosing again is a no-op
  ok(resolveDilemma(opened, 1) === opened, 'no second choice while a pool is open');
  // commit + close lands the party at the destination
  const committed = commitDicePool(opened);
  ok(committed.dilemma!.resolved === true, 'commit resolves the underlying dilemma');
  const landed = closeDicePool(committed);
  ok(landed.dicePool === null && landed.dilemma === null, 'close clears pool + dilemma');
  ok(landed.currentNodeId === dest.id, 'close lands the party at the destination');

  // no-stat option resolves instantly (no pool)
  const instant = resolveDilemma(withStat, 1);
  ok(instant.dicePool === null, 'a no-stat option does not open a pool');
  ok(instant.dilemma!.resolved === true, 'a no-stat option resolves instantly');
  ok(instant.gold === Math.max(0, base.gold - 10), 'the sure-thing cost is debited client-side');
}

console.log('determinism — same seed + same pushes ⇒ identical faces/hits:');
{
  // Entity ids carry a random suffix minted once at world creation, so compare the
  // rolled outcome (faces, hits, tier) — the part the RNG stream actually owns.
  const sig = (s: RpgState) => {
    const p = s.dicePool!;
    return JSON.stringify({
      faces: p.dice.map(d => `${d.face}:${d.hit ? 1 : 0}:${d.kept ? 1 : 0}`),
      required: p.required, outcome: p.outcome, rerollsUsed: p.rerollsUsed, morale: s.morale,
    });
  };
  const a = commitDicePool(rerollDicePool(searchAt('det', 2)));
  const b = commitDicePool(rerollDicePool(searchAt('det', 2)));
  ok(sig(a) === sig(b), 'identical seed + pushes give identical faces/hits/outcome');
}

console.log(failures === 0 ? '\nALL DICE-POOL TESTS PASSED' : `\n${failures} DICE-POOL TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

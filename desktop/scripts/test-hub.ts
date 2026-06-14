// Hub / meta-progression regression — the "step above adventure creation" (the
// CE2 Paris outer loop). Every run RETURNS to a persistent lodge that banks its
// spoils: gold → Funds, milestone Tickets, lifetime counters, and a Renown rank
// DERIVED from cumulative Fame (so it can never drift from it, never pay-to-win).
// All numbers are client-owned — this asserts the math, idempotency, and that
// Renown climbs forever (semi-endless).
//
// Run: npx tsx scripts/test-hub.ts
import { buildWorld, recordReturn, loadHub, clearHub, renownTier } from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState } from '../src/game/rpg/types';

// localStorage shim (node has none) — recordReturn/loadHub persist through it.
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
(globalThis as unknown as { localStorage: MemStore }).localStorage = new MemStore();

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
function run(seed: string, gold: number, ngPlus: number): RpgState {
  const s = buildWorld(fakeSetup(), seed, 0, 'medium');
  s.gold = gold;
  s.ngPlus = ngPlus;
  return s;
}

// ── Renown ladder: monotonic, named rungs at the right thresholds, then stars ──
console.log('renown ladder:');
{
  ok(renownTier(0).name === 'Novice' && renownTier(0).tier === 0, 'fame 0 → Novice (tier 0)');
  ok(renownTier(149).name === 'Novice', 'just under a rung stays put');
  ok(renownTier(150).name === 'Wayfarer', 'crossing a threshold ranks up');
  ok(renownTier(6500).name === 'Legend', 'top rung reached at 6500');
  ok(renownTier(0).next === 150, 'next threshold surfaced below the top');
  // monotonic tier across a sweep
  let prev = -1, mono = true;
  for (let f = 0; f <= 20000; f += 137) { const t = renownTier(f).tier; if (t < prev) mono = false; prev = t; }
  ok(mono, 'tier never decreases as fame rises');
  // semi-endless: past Legend, stars accrue and there is always a next star
  const a = renownTier(6500), b = renownTier(6500 + 3000), c = renownTier(6500 + 3000 * 4);
  ok(a.stars === 0 && b.stars === 1 && c.stars === 4, 'one star per 3000 fame past Legend');
  ok(a.next === 9500 && b.next === 12500, 'the star track always has a next threshold (never caps)');
}

// ── A defeat banks too; gold → funds, counters move, no victory/ticket ────────
console.log('\nbank a defeat:');
{
  clearHub();
  const h = recordReturn(run('d1', 30, 0), 'defeat');
  ok(h.funds === 30, 'defeat banks its gold into funds');
  ok(h.expeditions === 1 && h.victories === 0, 'expedition counted, not a victory');
  ok(h.tickets === 0, 'a plain defeat earns no ticket');
}

// ── Victory banks a ticket; gold accumulates across runs ──────────────────────
console.log('\nbank a victory + accumulation:');
{
  clearHub();
  recordReturn(run('v1', 40, 0), 'victory');
  const h = recordReturn(run('v2', 25, 0), 'victory');
  ok(h.funds === 65, 'funds accumulate across runs (40 + 25)');
  ok(h.victories === 2 && h.expeditions === 2, 'two wins, two expeditions');
  ok(h.tickets === 2, 'each victory awards one ticket');
}

// ── A new NG+ depth awards a bonus ticket exactly once per new high ───────────
console.log('\nNG+ depth bonus:');
{
  clearHub();
  const h1 = recordReturn(run('n0', 0, 0), 'victory');        // win at NG+0: +1 (win)
  ok(h1.tickets === 1 && h1.bestNgPlus === 0, 'first win, no depth bonus yet');
  const h2 = recordReturn(run('n1', 0, 1), 'victory');        // first NG+1: +1 win +1 depth
  ok(h2.tickets === 3 && h2.bestNgPlus === 1, 'reaching NG+1 adds a depth ticket on top of the win');
  const h3 = recordReturn(run('n1b', 0, 1), 'victory');       // NG+1 again: +1 win only
  ok(h3.tickets === 4 && h3.bestNgPlus === 1, 'a repeat of the same depth gives no extra depth ticket');
}

// ── Idempotency: the same finished run can't double-bank (remount safety) ──────
console.log('\nidempotency:');
{
  clearHub();
  const s = run('idem', 50, 2);
  const a = recordReturn(s, 'victory');
  const b = recordReturn(s, 'victory'); // identical id → no-op
  ok(a.funds === 50 && b.funds === 50, 'second return from the same run banks nothing');
  ok(b.expeditions === 1 && b.tickets === a.tickets, 'counters/tickets unchanged on re-bank');
  // a DIFFERENT outcome of the same seed/ngPlus is a distinct id (defeat vs win)
  const c = recordReturn(s, 'defeat');
  ok(c.expeditions === 2, 'a different outcome is a distinct, bankable event');
}

// ── loadHub round-trips and defaults cleanly ──────────────────────────────────
console.log('\npersistence:');
{
  clearHub();
  ok(loadHub().funds === 0 && loadHub().banked.length === 0, 'empty hub defaults to zeros');
  recordReturn(run('p1', 12, 0), 'victory');
  ok(loadHub().funds === 12, 'loadHub reads back the banked funds');
}

if (failures) {
  console.error(`\nHUB: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nHUB: all good ✓');

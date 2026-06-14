// Fame & logbook regression — Step 5 of the Curious-Expedition fusion. A light,
// client-owned cross-run meta-progression: every finished run is scored (Fame) and
// recorded in a persistent logbook. Fame is pure bragging — it never feeds back into
// gameplay — and every number is computed client-side (the LLM authors nothing).
//
// Run: npx tsx scripts/test-fame.ts

// Minimal localStorage shim so loadLogbook/recordRun (which persist) work under node.
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
  buildWorld, computeFame, recordRun, loadLogbook, clearLogbook,
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
    quest: { title: 'The Quest', desc: 'D' },
    fallback: false,
  };
}

// Mark `n` nodes cleared (and discovered) to simulate progress.
function clearNodes(s: RpgState, n: number) {
  let i = 0;
  for (const id of s.order) {
    if (i >= n) break;
    s.nodes[id].cleared = true;
    s.nodes[id].discovered = true;
    i++;
  }
}

// ── computeFame: victory beats defeat, never negative, monotone in deeds ───────
console.log('computeFame:');
{
  const base = buildWorld(fakeSetup(), 'fame', 0, 'medium');
  const win = computeFame(base, 'victory');
  const loss = computeFame(base, 'defeat');
  ok(win.fame > loss.fame, `victory outscores defeat (${win.fame} > ${loss.fame})`);
  ok(loss.fame >= 0, `defeat fame is never negative (${loss.fame})`);
  ok(win.highlights.length > 0 && loss.highlights.length > 0, 'both outcomes carry at least one highlight');
  ok(win.highlights.some(h => h.includes('The Quest')), 'a victory names the completed quest');

  // More cleared sites ⇒ more fame.
  const a = buildWorld(fakeSetup(), 'mono', 0, 'medium'); clearNodes(a, 2);
  const b = buildWorld(fakeSetup(), 'mono', 0, 'medium'); clearNodes(b, 6);
  ok(computeFame(b, 'victory').fame > computeFame(a, 'victory').fame, 'clearing more sites earns more fame');

  // NG+ tier adds fame.
  const ng0 = buildWorld(fakeSetup(), 'ng', 0, 'medium');
  const ng2 = buildWorld(fakeSetup(), 'ng', 0, 'medium'); ng2.ngPlus = 2;
  ok(computeFame(ng2, 'victory').fame > computeFame(ng0, 'victory').fame, 'a higher NG+ tier earns more fame');
}

// ── recordRun: persists, accumulates, idempotent per run ──────────────────────
console.log('\nrecordRun:');
{
  clearLogbook();
  ok(loadLogbook().entries.length === 0, 'a fresh logbook is empty');

  const s = buildWorld(fakeSetup(), 'rec-A', 0, 'medium'); clearNodes(s, 3);
  const after = recordRun(s, 'victory');
  ok(after.entries.length === 1, 'recording a run adds one entry');
  ok(after.fame === computeFame(s, 'victory').fame, 'total fame matches the run’s fame');
  ok(after.entries[0].outcome === 'victory', 'the entry carries the outcome');
  ok(after.entries[0].party.length === s.party.length, 'the entry lists the party');

  // Idempotent: re-recording the SAME run banks nothing extra (deterministic id).
  const dup = recordRun(s, 'victory');
  ok(dup.entries.length === 1, 'recording the same run again adds no entry');
  ok(dup.fame === after.fame, 'recording the same run again banks no extra fame');

  // A distinct run accumulates.
  const s2 = buildWorld(fakeSetup(), 'rec-B', 0, 'medium'); clearNodes(s2, 5);
  const two = recordRun(s2, 'defeat');
  ok(two.entries.length === 2, 'a distinct run adds a second entry');
  ok(two.fame === after.fame + computeFame(s2, 'defeat').fame, 'fame totals accumulate across runs');
  ok(two.entries[0].id !== two.entries[1].id, 'distinct runs get distinct ids');
}

// ── logbook is capped (newest kept) ───────────────────────────────────────────
console.log('\ncap:');
{
  clearLogbook();
  for (let i = 0; i < 40; i++) {
    const s = buildWorld(fakeSetup(), `cap-${i}`, 0, 'medium');
    recordRun(s, i % 2 === 0 ? 'victory' : 'defeat');
  }
  const book = loadLogbook();
  ok(book.entries.length === 30, `logbook caps at 30 entries (have ${book.entries.length})`);
  ok(book.fame > 0, 'cumulative fame survives the cap (counts all banked runs)');
}

// ── clearLogbook wipes everything ─────────────────────────────────────────────
console.log('\nclear:');
{
  clearLogbook();
  const book = loadLogbook();
  ok(book.entries.length === 0 && book.fame === 0, 'clearLogbook resets entries and total fame');
}

if (failures) {
  console.error(`\nFAME: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nFAME: all good ✓');

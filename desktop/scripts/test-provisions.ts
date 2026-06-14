// Provisions regression — Step 3 of the Curious-Expedition fusion. Provisions are
// rations carried (0..PROV_MAX): each travel leg eats some (scaled by distance),
// restocked with gold at villages/towns. Running out mid-leg starves the party —
// extra HP loss (floored at 1) + morale drain. Every number is client-owned.
//
// Run: npx tsx scripts/test-provisions.ts
import {
  buildWorld, beginTravel, arriveTravel, applyAction,
  clampProv, legProvisionCost, PROV_MAX, PROV_COST,
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

// Travel one leg to a wild (non-settlement) neighbour, fully played out.
function travelOnce(s: RpgState): RpgState {
  const here = s.nodes[s.currentNodeId];
  const wild = here.edges.find(e => { const k = s.nodes[e].kind; return k !== 'town' && k !== 'village'; });
  return arriveTravel(beginTravel(s, wild ?? here.edges[0]));
}
function townNeighbour(s: RpgState): string | undefined {
  return s.nodes[s.currentNodeId].edges.find(e => { const k = s.nodes[e].kind; return k === 'town' || k === 'village'; });
}

// ── clamp + leg cost ──────────────────────────────────────────────────────────
console.log('clamp / leg cost:');
ok(clampProv(99) === PROV_MAX, 'clampProv caps at PROV_MAX');
ok(clampProv(-5) === 0, 'clampProv floors at 0');
ok(legProvisionCost(0) >= 1, 'a leg always costs ≥1 ration');
ok(legProvisionCost(0.5) > legProvisionCost(0), 'a longer leg costs more rations');

// ── fresh world starts with a full satchel ───────────────────────────────────
console.log('\nfresh state:');
{
  const s = buildWorld(fakeSetup(), 'fresh', 0, 'small');
  ok(s.provisions === PROV_MAX, `starts at full provisions (${s.provisions})`);
}

// ── a travel leg eats rations, staying clamped ≥0 ────────────────────────────
console.log('\ntravel consumes:');
{
  let s = buildWorld(fakeSetup(), 'eat', 0, 'medium');
  const before = s.provisions;
  s = travelOnce(s);
  ok(s.provisions < before, `one leg eats rations (${before} → ${s.provisions})`);
  let clamped = true;
  for (let i = 0; i < 30; i++) {
    s = s.phase === 'combat' ? s : travelOnce(s);
    if (s.provisions < 0 || s.provisions > PROV_MAX) clamped = false;
    if (s.phase === 'gameover' || s.phase === 'victory') break;
  }
  ok(clamped, 'provisions stay within [0,PROV_MAX] across a long march');
}

// ── starving on the road: extra HP loss (floored at 1) + morale hit ──────────
console.log('\nstarvation:');
{
  // Search a seed for a plain (no-event) leg so the only damage is starvation.
  let tested = false;
  for (let seed = 0; seed < 200 && !tested; seed++) {
    const s = buildWorld(fakeSetup(), `starve-${seed}`, 0, 'medium');
    s.provisions = 0;            // empty satchel
    s.morale = 80;
    for (const c of s.party) c.hp = c.maxHp;
    const here = s.nodes[s.currentNodeId];
    const wild = here.edges.find(e => { const k = s.nodes[e].kind; return k !== 'town' && k !== 'village'; });
    if (!wild) continue;
    const begun = beginTravel(s, wild);
    if (begun.travel?.event !== 'none') continue; // isolate starvation from hazards/ambush
    const after = arriveTravel(begun);
    tested = true;
    ok(after.party.every(c => !c.alive || c.hp >= 1), 'starvation never drops a member below 1 HP');
    ok(after.party.some(c => c.hp < c.maxHp), 'an empty satchel costs the party HP on the road');
    ok(after.morale < 80, `starvation drains morale (80 → ${after.morale})`);
    ok(after.provisions === 0, 'provisions stay at 0 when already empty');
  }
  ok(tested, 'found a plain leg to isolate starvation');
}

// ── restock at a settlement: buy with gold, fill toward max, never go negative ─
console.log('\nrestock:');
{
  const s = buildWorld(fakeSetup(), 'shop', 0, 'medium');
  s.provisions = 2;
  s.gold = 100;
  const node = s.nodes[townNeighbour(s) ?? s.currentNodeId];
  // Force a settlement context: if the start node isn't a settlement, fabricate one.
  const settle = node.kind === 'town' || node.kind === 'village'
    ? node
    : (() => { const n = { ...s.nodes[s.currentNodeId], kind: 'town' as const }; s.nodes[n.id] = n; return n; })();
  const before = { prov: s.provisions, gold: s.gold };
  const r = applyAction(s, 'provision', settle).state;
  ok(r.provisions === PROV_MAX, `restock fills the satchel (${before.prov} → ${r.provisions})`);
  const expectSpent = (PROV_MAX - before.prov) * PROV_COST;
  ok(r.gold === before.gold - expectSpent, `gold debited correctly (-${expectSpent}, ${before.gold} → ${r.gold})`);
}

// ── restock is gold-gated: a thin purse buys only what it can afford, no debt ──
console.log('\nrestock gold-gate:');
{
  const s = buildWorld(fakeSetup(), 'broke', 0, 'medium');
  s.provisions = 0;
  s.gold = PROV_COST * 2 + 1; // can afford exactly 2 rations
  const n = { ...s.nodes[s.currentNodeId], kind: 'town' as const };
  s.nodes[n.id] = n;
  const r = applyAction(s, 'provision', n).state;
  ok(r.provisions === 2, `buys only what gold allows (2 rations → ${r.provisions})`);
  ok(r.gold === 1, `gold never goes negative (${r.gold} left)`);

  // Zero gold buys nothing.
  const poor = buildWorld(fakeSetup(), 'poor', 0, 'medium');
  poor.provisions = 0; poor.gold = 0;
  const pn = { ...poor.nodes[poor.currentNodeId], kind: 'town' as const };
  poor.nodes[pn.id] = pn;
  const pr = applyAction(poor, 'provision', pn).state;
  ok(pr.provisions === 0 && pr.gold === 0, 'no coin buys no food (no debt)');
}

if (failures) {
  console.error(`\nPROVISIONS: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nPROVISIONS: all good ✓');

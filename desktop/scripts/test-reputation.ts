// Settlement reputation regression — P2 of the Curious-Expedition fusion. Towns and
// villages remember the party: clearing nearby danger and trading there earn standing,
// and a welcomed party pays less for food and hires and rests easier. Reputation is a
// client-owned number, clamped to [REP_MIN, REP_MAX]; the LLM authors none of it.
//
// Run: npx tsx scripts/test-reputation.ts
import {
  buildWorld, applyAction, recruitCost, PROV_COST,
  settlementRep, repDiscount, repTier, provPriceAt, recruitPriceAt,
  REP_MIN, REP_MAX,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState, MapNode, Character } from '../src/game/rpg/types';

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

const isSettlement = (n: MapNode) => n.kind === 'town' || n.kind === 'village';

// Make the party overwhelming so a `fight` action is a guaranteed win (modifier ≫ DC).
function godParty(s: RpgState): RpgState {
  for (const c of s.party) { c.alive = true; c.level = 50; c.stats = { ...c.stats, might: 200, agility: 200 }; }
  return s;
}

// Find a danger node that borders a settlement (the region-clear reward scenario).
function dangerBesideSettlement(s: RpgState): { danger: MapNode; town: MapNode } | null {
  for (const id of s.order) {
    const n = s.nodes[id];
    if (isSettlement(n) || n.danger <= 0 || n.cleared) continue;
    const town = n.edges.map(e => s.nodes[e]).find(isSettlement);
    if (town) return { danger: n, town };
  }
  return null;
}

// ── helper math: standing, discount, tiers, prices ────────────────────────────
console.log('helpers:');
{
  const fresh = { kind: 'village', reputation: undefined } as unknown as MapNode;
  ok(settlementRep(fresh) === 0, 'a settlement with no record reads 0 standing');

  const at = (rep: number) => ({ kind: 'town', reputation: rep } as unknown as MapNode);
  ok(repDiscount(at(0)) === 0, 'neutral standing gives no discount');
  ok(Math.abs(repDiscount(at(30)) - 0.3) < 1e-9, '+30 standing gives the 30% cap');
  ok(repDiscount(at(100)) === 0.3, 'the discount caps at 30% (never more)');
  ok(repDiscount(at(-20)) === 0, 'below neutral there is no surcharge (floors at 0)');

  ok(repTier(-10) === 'reviled', 'deep negative reads reviled');
  ok(repTier(0) === 'stranger' && repTier(7) === 'stranger', 'around neutral reads stranger');
  ok(repTier(10) === 'known', 'mid standing reads known');
  ok(repTier(25) === 'welcomed', 'high standing reads welcomed');
  ok(repTier(40) === 'honored', 'max standing reads honored');

  ok(provPriceAt(at(0)) === PROV_COST, 'food costs full price at neutral standing');
  ok(provPriceAt(at(30)) < PROV_COST, 'food is cheaper for a welcomed party');
  ok(provPriceAt(at(30)) >= 1, 'food never drops below 1 gold');

  const ally = { className: 'Knight', level: 1, stats: { might: 4, agility: 4, wits: 4, spirit: 4 } } as unknown as Character;
  ok(recruitPriceAt(at(0), ally, 1) === recruitCost(ally, 1), 'a hire costs full price at neutral standing');
  ok(recruitPriceAt(at(30), ally, 1) < recruitCost(ally, 1), 'a hire is cheaper for a welcomed party');
}

// ── clearing a danger site earns goodwill from bordering settlements ───────────
console.log('\nclear earns standing:');
{
  const s = godParty(buildWorld(fakeSetup(), 'rep-clear', 0, 'medium'));
  const found = dangerBesideSettlement(s);
  ok(!!found, 'the world has a danger site bordering a settlement');
  if (found) {
    const before = settlementRep(found.town);
    const r = applyAction(s, 'fight', found.danger);
    const after = r.state.nodes[found.town.id];
    ok(r.state.nodes[found.danger.id].cleared, 'the god-party clears the danger site');
    ok(settlementRep(after) > before, `the bordering settlement gains standing (${before} → ${settlementRep(after)})`);
    ok(/grateful|goodwill/.test(r.outcome), 'the clear outcome tells the player a settlement is grateful');
    ok(r.outcome.includes(after.name), 'the grateful settlement is named in the outcome');
  }
}

// ── only settlements track reputation (a cleared wild neighbour gains nothing) ─
console.log('\nonly settlements track standing:');
{
  const s = godParty(buildWorld(fakeSetup(), 'rep-nonsettle', 0, 'medium'));
  const found = dangerBesideSettlement(s);
  if (found) {
    const wildNb = found.danger.edges.map(e => s.nodes[e]).find(n => !isSettlement(n));
    const r = applyAction(s, 'fight', found.danger);
    if (wildNb) ok(r.state.nodes[wildNb.id].reputation === undefined, 'a non-settlement neighbour never records standing');
    else ok(true, '(no non-settlement neighbour to check in this layout)');
  } else ok(false, 'setup precondition failed');
}

// ── patronage: buying food earns standing AND pays the discounted price ────────
console.log('\npatronage — food:');
{
  const s = buildWorld(fakeSetup(), 'rep-food', 0, 'medium');
  const town = s.order.map(id => s.nodes[id]).find(isSettlement)!;
  town.reputation = 30;                 // welcomed
  s.gold = 1000; s.provisions = 0;
  const goldBefore = s.gold;
  const r = applyAction(s, 'provision', town);
  const t2 = r.state.nodes[town.id];
  ok(settlementRep(t2) > 30, 'buying food nudges standing up');
  const spent = goldBefore - r.state.gold;
  const bought = r.state.provisions;
  ok(bought > 0 && spent === bought * provPriceAt(town), 'food is charged at the discounted price');
}

// ── patronage: hiring earns standing AND pays the discounted price ─────────────
console.log('\npatronage — hire:');
{
  const s = buildWorld(fakeSetup(), 'rep-hire', 0, 'medium');
  const town = s.order.map(id => s.nodes[id]).find(isSettlement)!;
  town.reputation = 30;
  s.gold = 100000;
  const ally = s.recruitPool[0];
  const expected = recruitPriceAt(town, ally, s.party.length);
  const goldBefore = s.gold;
  const r = applyAction(s, 'recruit', town);
  ok(r.state.party.some(c => c.id === ally.id), 'the recruit joins');
  ok(goldBefore - r.state.gold === expected, 'the hire is charged the discounted price');
  ok(settlementRep(r.state.nodes[town.id]) > 30, 'hiring nudges standing up');
}

// ── a welcomed settlement gives a warmer rest (more morale than a neutral one) ─
console.log('\nwelcome rest:');
{
  const run = (rep: number) => {
    const s = buildWorld(fakeSetup(), 'rep-rest', 0, 'medium');
    const town = s.order.map(id => s.nodes[id]).find(isSettlement)!;
    town.reputation = rep;
    s.morale = 40;
    return applyAction(s, 'rest', town).state.morale;
  };
  ok(run(40) > run(0), 'a welcomed party rests to more morale than a stranger');
}

// ── addRep clamps to the band (via patronage spam, can't exceed REP_MAX) ───────
console.log('\nclamp:');
{
  const s = buildWorld(fakeSetup(), 'rep-clamp', 0, 'medium');
  const town = s.order.map(id => s.nodes[id]).find(isSettlement)!;
  town.reputation = REP_MAX - 0;        // already at the ceiling
  s.gold = 100000; s.provisions = 0;
  let cur = s;
  for (let i = 0; i < 10; i++) { cur.provisions = 0; cur = applyAction(cur, 'provision', cur.nodes[town.id]).state; }
  ok(settlementRep(cur.nodes[town.id]) === REP_MAX, `standing never climbs past REP_MAX (${REP_MAX})`);
  ok(REP_MIN < 0, 'the band allows a negative floor');
}

if (failures) {
  console.error(`\nREPUTATION: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nREPUTATION: all good ✓');

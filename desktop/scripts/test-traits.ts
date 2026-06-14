// Companion traits regression — Step 4 of the Curious-Expedition fusion. Each member
// carries one client-owned quirk assigned at generation. Five are party-level perks
// (gated by partyHasTrait on LIVING members): Forager trims rations, Stalwart softens
// morale drain, Lucky sweetens boons, Cheerful boosts rest, Pathfinder dodges ambushes.
// Tough is individual — extra maxHp baked in at birth. Every effect is one client-owned
// number wired into existing mechanics; the LLM never authors one.
//
// Run: npx tsx scripts/test-traits.ts
import {
  buildWorld, beginTravel, arriveTravel, applyAction,
  TRAITS, TOUGH_HP, partyHasTrait, MORALE_MAX,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState, TraitId, CompanionTrait } from '../src/game/rpg/types';

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

// Force the WHOLE party onto a single trait (or clear it) so a perk's presence is the
// only thing changing between two otherwise-identical runs.
function withTrait(s: RpgState, t: CompanionTrait | undefined): RpgState {
  for (const c of s.party) c.trait = t;
  return s;
}

// ── table integrity ───────────────────────────────────────────────────────────
console.log('table:');
{
  const ids: TraitId[] = ['forager', 'stalwart', 'lucky', 'cheerful', 'tough', 'pathfinder'];
  ok(ids.every(id => TRAITS[id] && TRAITS[id].id === id), 'every TraitId has a matching entry');
  ok(ids.every(id => TRAITS[id].label.length > 0 && TRAITS[id].blurb.length > 0), 'every trait carries a label + blurb');
}

// ── partyHasTrait gates on LIVING members only ────────────────────────────────
console.log('\npresence gate:');
{
  const s = buildWorld(fakeSetup(), 'gate', 0, 'small');
  withTrait(s, TRAITS.forager);
  ok(partyHasTrait(s, 'forager'), 'a living member with the trait reads true');
  ok(!partyHasTrait(s, 'lucky'), 'an absent trait reads false');
  for (const c of s.party) c.alive = false;
  ok(!partyHasTrait(s, 'forager'), 'a downed member no longer counts');
}

// ── generation assigns a trait, deterministically by seed ─────────────────────
console.log('\ngeneration:');
{
  const a = buildWorld(fakeSetup(), 'gen', 0, 'small');
  const b = buildWorld(fakeSetup(), 'gen', 0, 'small');
  ok(a.party.every(c => !!c.trait), 'the hero is born with a trait');
  ok(a.recruitPool.every(c => !!c.trait), 'every recruit is born with a trait');
  ok(a.party[0].trait!.id === b.party[0].trait!.id, 'same seed → same hero trait');
  ok(a.recruitPool.map(c => c.trait!.id).join() === b.recruitPool.map(c => c.trait!.id).join(),
    'same seed → same recruit-pool traits');
}

// ── Forager: a leg eats one less ration (floored at 1) ────────────────────────
console.log('\nforager:');
{
  const run = (t: CompanionTrait | undefined) => {
    const s = withTrait(buildWorld(fakeSetup(), 'forage', 0, 'medium'), t);
    const dest = s.nodes[s.currentNodeId].edges[0];
    const begun = beginTravel(s, dest);
    begun.travel!.event = 'none';     // isolate ration consumption from road events
    begun.travel!.dist = 0.4;         // legProvisionCost(0.4)=round(1+1.6)=3 rations
    return arriveTravel(begun).provisions;
  };
  const plain = run(undefined);
  const forager = run(TRAITS.forager);
  ok(forager === plain + 1, `forager eats one less ration (plain left ${plain}, forager left ${forager})`);
}

// ── Stalwart: every leg's morale drain is softened ────────────────────────────
console.log('\nstalwart:');
{
  const run = (t: CompanionTrait | undefined) => {
    const s = withTrait(buildWorld(fakeSetup(), 'morale', 0, 'medium'), t);
    s.morale = 80; s.provisions = 12;
    const dest = s.nodes[s.currentNodeId].edges[0];
    const begun = beginTravel(s, dest);
    begun.travel!.event = 'none';
    begun.travel!.dist = 0.4;
    return arriveTravel(begun).morale;
  };
  const plain = run(undefined);
  const stalwart = run(TRAITS.stalwart);
  ok(stalwart > plain, `stalwart loses less morale on the road (plain ${plain}, stalwart ${stalwart})`);
}

// ── Lucky: a roadside boon yields more gold (×1.5) ────────────────────────────
console.log('\nlucky:');
{
  const run = (t: CompanionTrait | undefined) => {
    const s = withTrait(buildWorld(fakeSetup(), 'luck', 0, 'medium'), t);
    s.gold = 0;
    const dest = s.nodes[s.currentNodeId].edges[0];
    const begun = beginTravel(s, dest);
    begun.travel!.event = 'boon';
    begun.travel!.boonKind = 'a cache';
    begun.travel!.boonGold = 20;
    return arriveTravel(begun).gold;
  };
  const plain = run(undefined);
  const lucky = run(TRAITS.lucky);
  ok(plain === 20, `a plain boon pays its face value (+${plain})`);
  ok(lucky === 30, `lucky multiplies the find ×1.5 (+${lucky})`);
}

// ── Cheerful: resting restores +10 extra morale ───────────────────────────────
console.log('\ncheerful:');
{
  const run = (t: CompanionTrait | undefined) => {
    const s = withTrait(buildWorld(fakeSetup(), 'rest', 0, 'medium'), t);
    s.morale = 40;
    return applyAction(s, 'rest', s.nodes[s.currentNodeId]).state.morale;
  };
  const plain = run(undefined);
  const cheerful = run(TRAITS.cheerful);
  ok(plain === 65, `a plain rest lifts +25 morale (40 → ${plain})`);
  ok(cheerful === 75, `cheerful lifts +35 morale (40 → ${cheerful})`);
}

// ── Tough: born with extra maxHp (the lone individual perk) ────────────────────
console.log('\ntough:');
{
  // Scan generated rosters for a Knight with and without `tough`; the tough one
  // must carry exactly TOUGH_HP more maxHp than its plain twin (same class baseline).
  let toughHp = 0, plainHp = 0;
  for (let seed = 0; seed < 200 && !(toughHp && plainHp); seed++) {
    const w = buildWorld(fakeSetup(), `tough-${seed}`, 0, 'medium');
    for (const c of [...w.party, ...w.recruitPool]) {
      if (c.className !== 'Knight') continue;
      if (c.trait?.id === 'tough' && !toughHp) toughHp = c.maxHp;
      else if (c.trait?.id !== 'tough' && !plainHp) plainHp = c.maxHp;
    }
  }
  ok(toughHp > 0 && plainHp > 0, 'found a tough Knight and a plain Knight to compare');
  ok(toughHp === plainHp + TOUGH_HP, `tough Knight carries +${TOUGH_HP} maxHp (plain ${plainHp}, tough ${toughHp})`);
}

// ── Pathfinder: the road springs fewer ambushes ───────────────────────────────
console.log('\npathfinder:');
{
  const count = (t: CompanionTrait | undefined) => {
    let ambushes = 0;
    for (let seed = 0; seed < 300; seed++) {
      const s = withTrait(buildWorld(fakeSetup(), `path-${seed}`, 0, 'medium'), t);
      const dest = s.nodes[s.currentNodeId].edges[0];
      const begun = beginTravel(s, dest);
      if (begun.travel?.event === 'ambush') ambushes++;
    }
    return ambushes;
  };
  const plain = count(undefined);
  const path = count(TRAITS.pathfinder);
  ok(path < plain, `pathfinder cuts ambushes across 300 seeds (plain ${plain}, pathfinder ${path})`);
}

// ── morale perks never break the clamp ────────────────────────────────────────
console.log('\nclamp safety:');
{
  const s = withTrait(buildWorld(fakeSetup(), 'clamp', 0, 'medium'), TRAITS.cheerful);
  s.morale = MORALE_MAX - 2;
  const r = applyAction(s, 'rest', s.nodes[s.currentNodeId]).state;
  ok(r.morale === MORALE_MAX, `cheerful rest still caps at max (${r.morale})`);
}

if (failures) {
  console.error(`\nTRAITS: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nTRAITS: all good ✓');

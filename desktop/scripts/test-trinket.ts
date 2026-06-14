// Trinkets & map discoveries — Step 4 of the Curious-Expedition fusion. Landmarks
// scattered across the wild each hold one curio; reaching a landmark CLAIMS its
// trinket into the satchel. A trinket is a permanent, presence-based party boon,
// each hooking a single mechanic: idol → an extra scene-pool die, charm → half the
// affliction catch chance, talisman → −1 HP off every road bite. Every number is
// client-owned; the LLM authors none of it.
//
// Run: npx tsx scripts/test-trinket.ts
import {
  buildWorld, beginTravel, arriveTravel, startSearchCheck, TRINKETS, MORALE_MAX,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState, Item, TrinketId } from '../src/game/rpg/types';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

function fakeSetup(): RpgSetupResult {
  const loc = (i: number) => ({ name: `Place ${i}`, kind: ['village', 'town', 'wild', 'forest', 'ruin', 'cave'][i % 6], blurb: 'x' });
  return {
    title: 'World', intro: 'intro',
    locations: Array.from({ length: 9 }, (_, i) => loc(i)),
    heroes: [{ className: 'Knight', blurb: 'b' }, { className: 'Scout', blurb: 'b' }],
    quest: { title: 'Q', desc: 'D' },
    fallback: false,
  };
}
const clone = (s: RpgState): RpgState => JSON.parse(JSON.stringify(s));
function trinketItem(id: TrinketId): Item {
  return { id: `t-${id}`, kind: 'trinket', name: TRINKETS[id].name, desc: TRINKETS[id].blurb, trinket: id };
}

console.log('catalog — three trinkets, each self-consistent:');
{
  const ids = Object.keys(TRINKETS) as TrinketId[];
  ok(ids.length === 3, 'three trinkets defined');
  ok(ids.every(id => TRINKETS[id].id === id), 'every entry id matches its key');
  ok(ids.every(id => TRINKETS[id].name.length > 0 && TRINKETS[id].blurb.length > 0), 'every entry has a name + blurb');
}

console.log('\ndiscoveries — landmarks seeded across the wild:');
{
  const s = buildWorld(fakeSetup(), 'disc-seed', 0, 'medium');
  const withDisc = Object.values(s.nodes).filter(n => n.discovery);
  ok(withDisc.length >= 1, `at least one discovery seeded (${withDisc.length})`);
  ok(withDisc.every(n => !n.discovery!.claimed), 'every seeded discovery starts unclaimed');
  ok(withDisc.every(n => n.id !== s.currentNodeId && n.id !== s.quest.goalNodeId), 'no discovery on the start or the goal');
  ok(withDisc.every(n => n.kind !== 'town' && n.kind !== 'village'), 'no discovery in a settlement');
  const trinkets = withDisc.map(n => n.discovery!.trinket);
  ok(new Set(trinkets).size === trinkets.length, 'seeded discoveries grant distinct trinkets');
}

console.log('\nclaim — arriving at a landmark pockets its trinket (once):');
{
  // A world seed that actually seeds a reachable discovery; drive a leg onto it.
  let proved = false;
  for (let i = 0; i < 60 && !proved; i++) {
    const s = buildWorld(fakeSetup(), `claim-${i}`, 0, 'medium');
    const dNode = Object.values(s.nodes).find(n => n.discovery && n.edges.length > 0);
    if (!dNode) continue;
    const from = dNode.edges[0];
    s.currentNodeId = from;
    s.nodes[from].discovered = true; s.nodes[from].visited = true;
    s.nodes[dNode.id].discovered = true;
    const want = dNode.discovery!.trinket;
    const before = s.inventory.filter(it => it.kind === 'trinket').length;
    const after = arriveTravel(beginTravel(s, dNode.id));
    if (after.currentNodeId !== dNode.id) continue;  // a sprung dilemma deferred the landing; try another seed
    proved = true;
    const got = after.inventory.filter(it => it.kind === 'trinket');
    ok(got.length === before + 1 && got.some(it => it.trinket === want), `claimed ${TRINKETS[want].name} into the satchel`);
    ok(after.nodes[dNode.id].discovery!.claimed, 'the landmark is marked claimed');
    // Idempotent: leaving and returning never re-grants it.
    const back = arriveTravel(beginTravel(after, from));
    const back2 = arriveTravel(beginTravel(back, dNode.id));
    ok(back2.inventory.filter(it => it.kind === 'trinket').length === got.length, 're-visiting a claimed landmark grants nothing more');
  }
  ok(proved, 'found a reachable discovery to claim');
}

console.log('\nidol — lends one extra die to every scene check:');
{
  const base = buildWorld(fakeSetup(), 'idol', 0, 'medium');
  const clean = startSearchCheck(base, base.nodes[base.currentNodeId]).dicePool!;
  const withIdol = clone(base); withIdol.inventory.push(trinketItem('idol'));
  const idolPool = startSearchCheck(withIdol, withIdol.nodes[withIdol.currentNodeId]).dicePool!;
  ok(idolPool.dice.length === clean.dice.length + 1, `idol adds exactly one die (${clean.dice.length} → ${idolPool.dice.length})`);
  ok(idolPool.dice.some(d => d.by === TRINKETS.idol.name && d.item), 'the extra die is the idol’s, flagged as an item die');
}

console.log('\ntalisman — softens a road bite by 1 HP:');
{
  let proved = false;
  for (let i = 0; i < 200 && !proved; i++) {
    const base = buildWorld(fakeSetup(), `tali-${i}`, 0, 'medium');
    base.morale = MORALE_MAX;          // high morale ⇒ no fresh affliction muddies the HP math
    base.provisions = 0;               // empty satchel ⇒ the leg starves the party
    const dest = base.nodes[base.currentNodeId].edges[0];
    base.nodes[dest].cleared = true; base.nodes[dest].danger = 0;
    const tr = beginTravel(base, dest);
    if (tr.travel!.event !== 'none') continue;   // isolate hunger from hazards
    const warded = clone(tr); warded.inventory.push(trinketItem('talisman'));
    const cleanHp = arriveTravel(tr).party[0].hp;
    const wardHp = arriveTravel(warded).party[0].hp;
    if (cleanHp < tr.party[0].maxHp) {  // hunger actually bit
      proved = true;
      ok(wardHp - cleanHp === 1, `talisman saves 1 HP off hunger (${cleanHp} → ${wardHp})`);
    }
  }
  ok(proved, 'found a no-event starving leg to measure');
}

console.log('\ncharm — the party cracks half as readily under strain:');
{
  // Same world seed + step for both clones ⇒ identical rng stream; the charm only
  // halves the catch threshold, so a charmed catch implies a clean catch.
  let cleanCatches = 0, charmCatches = 0;
  for (let i = 0; i < 160; i++) {
    const base = buildWorld(fakeSetup(), `charm-${i}`, 0, 'medium');
    base.morale = 2;                   // broken morale ⇒ the road preys on the mind
    base.provisions = 12;
    const dest = base.nodes[base.currentNodeId].edges[0];
    base.nodes[dest].cleared = true; base.nodes[dest].danger = 0;
    const charmed = clone(base); charmed.inventory.push(trinketItem('charm'));
    const a = arriveTravel(beginTravel(base, dest));
    const b = arriveTravel(beginTravel(charmed, dest));
    if (a.party.some(c => c.alive && c.affliction)) cleanCatches++;
    if (b.party.some(c => c.alive && c.affliction)) charmCatches++;
  }
  ok(charmCatches < cleanCatches, `charm yields fewer catches (${charmCatches} vs ${cleanCatches} clean)`);
  ok(cleanCatches > 0, 'the unwarded control caught afflictions (a fair comparison)');
}

console.log(failures === 0 ? '\nALL TRINKET TESTS PASSED' : `\n${failures} TRINKET TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

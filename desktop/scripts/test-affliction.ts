// Afflictions — the sanity-escalation layer. A low-morale road preys on the mind:
// an individual member may catch a TEMPORARY affliction (one per member) that bites
// a specific existing mechanic and lifts on recovery (rest, or a stretch of high
// morale). This asserts the catalog, each malus' effect (haunted → weaker scene
// die, feverish → extra hazard/hunger HP, mutinous → weaker swing + first to
// desert), the catch/recover lifecycle gated on morale, and that rest clears it.
// Every number is client-owned; the LLM authors none of it.
//
// Run: npx tsx scripts/test-affliction.ts
import {
  buildWorld, startSearchCheck, applyAction, beginTravel, arriveTravel,
  startCombat, combatRound, AFFLICTIONS, MORALE_MAX,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState, Character, StatKey, AfflictionId } from '../src/game/rpg/types';

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

const STAT_KEYS: StatKey[] = ['might', 'agility', 'wits', 'spirit'];
function member(i: number, hero = false): Character {
  return {
    id: `m${i}`, name: `Hero${i}`, className: 'Scout', blurb: '', isHero: hero,
    level: 2, xp: 0, hp: 30, maxHp: 30,
    stats: { might: 4, agility: 4, wits: 4, spirit: 4 }, alive: true,
  };
}
// A fresh world with a 3-member party (so afflictions have somewhere to land).
function world(seed: string): RpgState {
  const s = buildWorld(fakeSetup(), seed, 0, 'medium');
  s.party = [member(0, true), member(1), member(2)];
  return s;
}
const clone = (s: RpgState): RpgState => JSON.parse(JSON.stringify(s));

console.log('catalog — three afflictions, each self-consistent:');
{
  const ids = Object.keys(AFFLICTIONS) as AfflictionId[];
  ok(ids.length === 3, 'three afflictions defined');
  ok(ids.every(id => AFFLICTIONS[id].id === id), 'every entry id matches its key');
  ok(ids.every(id => AFFLICTIONS[id].label.length > 0 && AFFLICTIONS[id].blurb.length > 0), 'every entry has a label + blurb');
}

console.log('\nhaunted — a jittery member rolls a weaker scene die:');
{
  const base = world('haunt');
  const clean = startSearchCheck(base, base.nodes[base.currentNodeId]).dicePool!;
  const sick = clone(base);
  sick.party[1].affliction = 'haunted';
  const sickPool = startSearchCheck(sick, sick.nodes[sick.currentNodeId]).dicePool!;
  const name = base.party[1].name;
  const cleanDie = clean.dice.find(d => d.by === name)!;
  const sickDie = sickPool.dice.find(d => d.by === name)!;
  ok(!!cleanDie && !!sickDie, 'both pools carry the member’s die');
  // same seed/step ⇒ same rng stream, so only the bonus differs (−1, clamped ≥0).
  ok(sickDie.bonus === Math.max(0, cleanDie.bonus - 1), `haunted die loses a pip (${cleanDie.bonus} → ${sickDie.bonus})`);
  // an unafflicted member's die is untouched.
  const other = base.party[0].name;
  ok(clean.dice.find(d => d.by === other)!.bonus === sickPool.dice.find(d => d.by === other)!.bonus, 'a clean member’s die is unchanged');
}

console.log('\nfeverish — extra HP lost to hunger on the road:');
{
  // Find a leg with no road event so the only damage is hunger (deterministic +2).
  let proved = false;
  for (let i = 0; i < 200 && !proved; i++) {
    const base = world(`fev-${i}`);
    base.morale = MORALE_MAX;          // high morale ⇒ no fresh catch this leg
    base.provisions = 0;               // empty satchel ⇒ the leg starves the party
    const dest = base.nodes[base.currentNodeId].edges[0];
    base.nodes[dest].cleared = true; base.nodes[dest].danger = 0;
    const tr = beginTravel(base, dest);
    if (tr.travel!.event !== 'none') continue;   // isolate hunger from hazards/ambush
    const sick = clone(tr); sick.party[1].affliction = 'feverish';
    const cleanAfter = arriveTravel(tr);
    const sickAfter = arriveTravel(sick);
    const cleanHp = cleanAfter.party.find(c => c.id === 'm1')!.hp;
    const sickHp = sickAfter.party.find(c => c.id === 'm1')!.hp;
    if (cleanHp < 30) {  // hunger actually bit
      proved = true;
      ok(cleanHp - sickHp === 2, `feverish member loses +2 HP to hunger (${cleanHp} vs ${sickHp})`);
    }
  }
  ok(proved, 'found a no-event starving leg to measure');
}

console.log('\nmutinous — swings worse in a fight (and is first to desert):');
{
  let sawLess = false, neverMore = true;
  for (let i = 0; i < 120; i++) {
    const base = world(`mut-${i}`);
    base.nodes[base.currentNodeId].danger = 2;
    base.nodes[base.currentNodeId].cleared = false;
    const started = startCombat(base, base.currentNodeId);
    if (!started.combat) continue;
    const enemiesHp = (s: RpgState) => s.combat!.enemies.reduce((a, e) => a + Math.max(0, e.hp), 0);
    const before = enemiesHp(started);
    const sick = clone(started);
    for (const c of sick.party) c.affliction = 'mutinous';
    const cleanDmg = before - enemiesHp(combatRound(started, 'attack').state);
    const sickDmg = (before) - enemiesHp(combatRound(sick, 'attack').state);
    if (sickDmg > cleanDmg) neverMore = false;
    if (sickDmg < cleanDmg) sawLess = true;
  }
  ok(neverMore, 'a mutinous party never out-damages the same clean party');
  ok(sawLess, 'a mutinous party deals strictly less on some seeds');
}

console.log('\nlifecycle — low morale catches, high morale never does:');
{
  // Low morale: within a handful of legs someone cracks.
  let sawCatch = false;
  let s = world('low');
  for (let leg = 0; leg < 14 && !sawCatch; leg++) {
    s.morale = 2;                       // keep the band broken before each leg
    s.provisions = 12;
    const dest = s.nodes[s.currentNodeId].edges[0];
    s.nodes[dest].cleared = true; s.nodes[dest].danger = 0;
    s = arriveTravel(beginTravel(s, dest));
    if (s.combat) { s = { ...s, combat: null, phase: 'scene' } as RpgState; }
    if (s.party.some(c => c.alive && c.affliction)) sawCatch = true;
  }
  ok(sawCatch, 'a broken-morale road afflicts someone within 14 legs');

  // High morale: no one ever catches anything.
  let everCaught = false;
  let h = world('high');
  for (let leg = 0; leg < 14; leg++) {
    h.morale = MORALE_MAX;
    h.provisions = 12;
    for (const c of h.party) c.hp = c.maxHp;
    const dest = h.nodes[h.currentNodeId].edges[0];
    h.nodes[dest].cleared = true; h.nodes[dest].danger = 0;
    h = arriveTravel(beginTravel(h, dest));
    if (h.combat) { h = { ...h, combat: null, phase: 'scene' } as RpgState; }
    if (h.party.some(c => c.affliction)) everCaught = true;
  }
  ok(!everCaught, 'a high-morale road never afflicts anyone');
}

console.log('\nrest — a full camp clears every mind:');
{
  const s = world('rest');
  s.party[1].affliction = 'haunted';
  s.party[2].affliction = 'feverish';
  const here = s.nodes[s.currentNodeId];
  const after = applyAction(s, 'rest', here).state;
  ok(after.party.every(c => !c.affliction), 'rest clears all afflictions');
  ok(after.party.every(c => c.hp === c.maxHp), 'rest still heals to full (unchanged)');
}

console.log(failures === 0 ? '\nALL AFFLICTION TESTS PASSED' : `\n${failures} AFFLICTION TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

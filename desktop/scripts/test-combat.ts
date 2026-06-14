// Combat status effects regression — P2 of the Curious-Expedition fusion. Timed,
// client-owned conditions: burn/bleed/poison bleed HP each round (the first two
// lethal, party poison floored at 1 like a hazard), stun skips a foe's turn.
// Class specials and crits apply them; Mend cures poison. Every number is computed
// client-side — the LLM authors none of it.
//
// Run: npx tsx scripts/test-combat.ts
import {
  buildWorld, startCombat, combatRound, endCombat,
  STATUS_META, addStatus, hasStatus, tickStatuses,
} from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { RpgState, Enemy, Character } from '../src/game/rpg/types';

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

function foe(over: Partial<Enemy>): Enemy {
  return { id: 'foe1', name: 'Brute', glyph: 'B', hp: 50, maxHp: 50, atk: 4, alive: true, ...over };
}

// A combat at the current node with a hand-crafted enemy line-up + chosen target.
function combatWith(enemies: Enemy[], seed = 'cb'): RpgState {
  const s = buildWorld(fakeSetup(), seed, 0, 'medium');
  const cs = startCombat(s, s.currentNodeId);
  cs.combat!.enemies = enemies;
  cs.combat!.targetId = enemies[0].id;
  return cs;
}

// Reshape the hero so a specific class signature move fires (heroSpecial reads the
// class key). One full-HP member keeps the enemy turn deterministic to target.
function soloHero(s: RpgState, className: string, stats?: Partial<Character['stats']>): RpgState {
  const h = s.party.find(m => m.isHero) || s.party[0];
  h.className = className; h.alive = true; h.hp = h.maxHp;
  if (stats) h.stats = { ...h.stats, ...stats };
  s.party = [h];
  return s;
}

// ── table integrity ───────────────────────────────────────────────────────────
console.log('table:');
{
  const ids = ['burn', 'bleed', 'poison', 'stun'] as const;
  ok(ids.every(id => STATUS_META[id] && STATUS_META[id].label.length > 0), 'every status has metadata + a label');
  ok(STATUS_META.burn.dot && STATUS_META.bleed.dot && STATUS_META.poison.dot, 'burn/bleed/poison are DoTs');
  ok(!STATUS_META.stun.dot, 'stun is not a DoT');
  ok(STATUS_META.burn.lethal && STATUS_META.bleed.lethal && !STATUS_META.poison.lethal, 'foe DoTs are lethal, party poison is not');
}

// ── addStatus: adds, refreshes (max), keeps one entry per id ───────────────────
console.log('\naddStatus:');
{
  const h: { status?: import('../src/game/rpg/types').StatusEffect[] } = {};
  addStatus(h, 'burn', 2, 3);
  ok(h.status!.length === 1 && hasStatus(h, 'burn'), 'a fresh status is added');
  addStatus(h, 'burn', 1, 5);
  ok(h.status!.length === 1, 're-applying the same id keeps one entry');
  ok(h.status![0].rounds === 2 && h.status![0].power === 5, 'refresh keeps the longer duration and the stronger tick');
  addStatus(h, 'poison', 3, 1);
  ok(h.status!.length === 2 && hasStatus(h, 'poison'), 'a different id coexists');
}

// ── hasStatus: gated on rounds remaining ───────────────────────────────────────
console.log('\nhasStatus:');
{
  ok(hasStatus({ status: [{ id: 'stun', rounds: 1, power: 0 }] }, 'stun'), 'rounds>0 reads true');
  ok(!hasStatus({ status: [{ id: 'stun', rounds: 0, power: 0 }] }, 'stun'), 'a spent status reads false');
  ok(!hasStatus({}, 'burn'), 'no status reads false');
}

// ── tickStatuses: DoT bleeds HP, decrements, drops the spent, respects the floor ─
console.log('\ntickStatuses:');
{
  // Lethal DoT can take a holder to (or below) zero.
  const a = { hp: 4, name: 'Foe', status: [{ id: 'burn' as const, rounds: 2, power: 5 }] };
  const lostA = tickStatuses(a, [], false);
  ok(lostA === 5 && a.hp === -1, 'a lethal DoT can drop HP below zero');
  ok(a.status!.length === 1 && a.status![0].rounds === 1, 'the status loses a round');

  // floorAt1 keeps a non-lethal DoT from downing the holder.
  const b = { hp: 3, name: 'Ally', status: [{ id: 'poison' as const, rounds: 2, power: 10 }] };
  const lostB = tickStatuses(b, [], true);
  ok(b.hp === 1 && lostB === 2, 'a floored DoT stops at 1 HP');

  // A spent status is removed; a non-DoT (stun) only counts down, no damage.
  const c = { hp: 10, name: 'Foe', status: [{ id: 'bleed' as const, rounds: 1, power: 2 }, { id: 'stun' as const, rounds: 2, power: 0 }] };
  tickStatuses(c, [], false);
  ok(c.hp === 8, 'stun deals no damage while bleed ticks');
  ok(!c.status!.some(s => s.id === 'bleed') && c.status!.some(s => s.id === 'stun'), 'the expired status is dropped, the live one stays');
}

// ── round-start DoT: an enemy burns each round; a wipe ends the fight ──────────
console.log('\nround-start DoT:');
{
  // Survives: a 4-power burn shaves 4 HP and counts down.
  const s = combatWith([foe({ hp: 50, maxHp: 50, atk: 1, status: [{ id: 'burn', rounds: 2, power: 4 }] })]);
  const e0 = s.combat!.enemies[0];
  const r = combatRound(s, 'defend');
  const e1 = r.state.combat!.enemies.find(e => e.id === e0.id)!;
  ok(e1.hp === 46, `burn shaves the enemy's HP at round start (50 → ${e1.hp})`);
  ok(hasStatus(e1, 'burn') && e1.status!.find(x => x.id === 'burn')!.rounds === 1, 'the burn counts down by one round');

  // Wipe: a DoT that finishes the last foe ends the fight as a win before the party acts.
  const w = combatWith([foe({ hp: 3, maxHp: 20, atk: 1, status: [{ id: 'burn', rounds: 2, power: 5 }] })]);
  const rw = combatRound(w, 'defend');
  ok(rw.state.combat!.over && rw.state.combat!.result === 'win', 'a DoT can win the fight at round start');
}

// ── stun: Aimed Shot disables the foe for its turn ────────────────────────────
console.log('\nstun (Aimed Shot):');
{
  const s = soloHero(combatWith([foe({ hp: 400, maxHp: 400, atk: 8 })]), 'Ranger', { agility: 6 });
  const heroHp = s.party[0].maxHp;
  const r = combatRound(s, 'special');
  const e = r.state.combat!.enemies[0];
  ok(hasStatus(e, 'stun'), 'Aimed Shot stuns the focused foe');
  ok(r.state.party[0].hp === heroHp, 'the stunned foe deals no damage that round');

  // Baseline: without a stun the same foe lands a blow.
  const b = soloHero(combatWith([foe({ hp: 400, maxHp: 400, atk: 8 })]), 'Ranger', { agility: 6 });
  const rb = combatRound(b, 'defend');
  ok(rb.state.party[0].hp < rb.state.party[0].maxHp, 'a non-stunned foe still draws blood');
}

// ── Firebolt sets the foe alight (burn) ───────────────────────────────────────
console.log('\nburn (Firebolt):');
{
  const s = soloHero(combatWith([foe({ hp: 400, maxHp: 400, atk: 1 })]), 'Mage', { wits: 6 });
  const r = combatRound(s, 'special');
  ok(hasStatus(r.state.combat!.enemies[0], 'burn'), 'Firebolt leaves the foe burning');
}

// ── Cleave leaves survivors bleeding ──────────────────────────────────────────
console.log('\nbleed (Cleave):');
{
  const s = soloHero(combatWith([
    foe({ id: 'a', name: 'A', hp: 400, maxHp: 400, atk: 1 }),
    foe({ id: 'b', name: 'B', hp: 400, maxHp: 400, atk: 1 }),
  ]), 'Knight', { might: 6 });
  const r = combatRound(s, 'special');
  ok(r.state.combat!.enemies.every(e => hasStatus(e, 'bleed')), 'Cleave makes every surviving foe bleed');
}

// ── Mend heals and purges poison ──────────────────────────────────────────────
console.log('\nmend cures poison:');
{
  const s = soloHero(combatWith([foe({ hp: 400, maxHp: 400, atk: 1 })]), 'Cleric', { spirit: 6 });
  s.party[0].maxHp = 999; s.party[0].hp = 10;
  addStatus(s.party[0], 'poison', 2, 3);
  const r = combatRound(s, 'special');
  ok(!hasStatus(r.state.party[0], 'poison'), 'Mend purges the poison');
  ok(r.state.party[0].hp > 10, 'Mend restores HP on top');
}

// ── clone isolates status arrays (no aliasing between prev and next) ───────────
console.log('\nclone isolation:');
{
  const s = combatWith([foe({ hp: 50, maxHp: 50, atk: 1, status: [{ id: 'burn', rounds: 3, power: 2 }] })]);
  const before = s.combat!.enemies[0].status![0].rounds;
  combatRound(s, 'defend');
  ok(s.combat!.enemies[0].status![0].rounds === before, 'the prior state is untouched after a round');
}

// ── status is combat-scoped: it clears when the fight ends (no overworld leak) ──
console.log('\nstatus clears on combat end:');
{
  const s = combatWith([foe({ hp: 1, maxHp: 1, atk: 1 })], 'endclr');
  const m = s.party[0];
  addStatus(m, 'poison', 3, 2);                 // party member leaves the fight poisoned
  ok(hasStatus(m, 'poison'), 'a party member carries poison during the fight');
  s.combat!.over = true; s.combat!.result = 'flee';
  const after = endCombat(s);
  ok(!hasStatus(after.party[0], 'poison'), 'poison is gone once combat ends (no frozen, invisible leak)');
  ok((after.party[0].status || []).length === 0, 'the status list is emptied on exit');
}

if (failures) {
  console.error(`\nCOMBAT: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nCOMBAT: all good ✓');

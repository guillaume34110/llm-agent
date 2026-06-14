// RTS combat regression — the counter web resolves correctly (small arms shred
// infantry but bounce off heavy armour; AP kills tanks), HP never goes negative, and
// units actually kill each other in a live tick. Run: npx tsx scripts/test-rts-combat.ts

import { hitDamage, spec } from '../src/game/rts/data';
import { createGame, tick, entitiesOf } from '../src/game/rts/state';
import type { Entity, EntityKind, Owner } from '../src/game/rts/types';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

// ── Counter table ────────────────────────────────────────────────────────────
ok(hitDamage('smallArms', 100, 'none') === 100, 'small arms full vs unarmoured');
ok(hitDamage('smallArms', 100, 'heavy') === 15, 'small arms gutted vs heavy armour');
ok(hitDamage('ap', 100, 'heavy') === 100, 'AP full vs heavy armour');
ok(hitDamage('ap', 100, 'none') === 40, 'AP wasted on infantry');
ok(hitDamage('explosive', 100, 'building') === 90, 'explosive strong vs buildings');
ok(hitDamage('smallArms', 5, 'heavy') === 0, 'tiny hit floored to 0, never negative');
ok(hitDamage('energy', 100, 'building') === 100, 'energy even across the board');

// ── Live fight: rifleman vs rifleman, one must die, HP clamped ────────────────
// Build a tiny manual scenario by hand-placing two enemies next to each other.
const s = createGame(99, 'human', 'normal');

function inject(owner: Owner, role: EntityKind, x: number, y: number): Entity {
  const f = owner === 'player' ? s.player.faction : s.enemy.faction;
  const sp = spec(role, f);
  const e: Entity = {
    id: s.nextId++, owner, faction: f, role, isBuilding: false,
    x, y, hp: sp.hp, maxHp: sp.hp, order: { type: 'idle' },
    cooldownLeft: 0, buildLeft: 0,
  };
  s.entities[e.id] = e; s.order.push(e.id);
  return e;
}

// Clear bootstrapped harvesters so they don't wander into the test.
for (const e of entitiesOf(s, 'player').concat(entitiesOf(s, 'enemy'))) {
  if (e.role === 'harvester') { delete s.entities[e.id]; }
}
s.order = s.order.filter(id => s.entities[id]);

const mine = inject('player', 'infantry', 20, 20);
const foe = inject('enemy', 'infantry', 21.5, 20); // within range 3

let mineDead = false, foeDead = false;
for (let i = 0; i < 200; i++) {
  tick(s);
  if (!s.entities[mine.id]) mineDead = true;
  if (!s.entities[foe.id]) foeDead = true;
  if (mineDead || foeDead) break;
}
ok(mineDead || foeDead, 'two adjacent riflemen: at least one dies in a live fight');

// HP never negative across all entities at any point (sample final state).
const allNonNeg = Object.values(s.entities).every(e => e.hp >= 0);
ok(allNonNeg, 'no entity ever has negative HP');

// ── Armour matters: tank shrugs off infantry far longer than infantry survives ─
const s2 = createGame(123, 'human', 'normal');
for (const e of entitiesOf(s2, 'player').concat(entitiesOf(s2, 'enemy'))) {
  if (e.role === 'harvester') delete s2.entities[e.id];
}
s2.order = s2.order.filter(id => s2.entities[id]);
const tankSpec = spec('tank', s2.player.faction);
const infSpec = spec('infantry', s2.enemy.faction);
// infantry small-arms vs tank heavy → 15% ; tank AP vs infantry none → 40%.
const perShotVsTank = hitDamage('smallArms', infSpec.damage!, tankSpec.armor);
const perShotVsInf = hitDamage('ap', tankSpec.damage!, infSpec.armor);
const shotsToKillTank = Math.ceil(tankSpec.hp / Math.max(1, perShotVsTank));
const shotsToKillInf = Math.ceil(infSpec.hp / Math.max(1, perShotVsInf));
ok(shotsToKillTank > shotsToKillInf, `tank far tougher: ${shotsToKillTank} inf-shots to kill tank vs ${shotsToKillInf} tank-shots to kill inf`);

console.log(failures === 0 ? '\nCOMBAT OK' : `\nCOMBAT FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);

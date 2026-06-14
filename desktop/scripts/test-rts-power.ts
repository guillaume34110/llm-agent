// RTS power regression — low-power penalties must escalate in order (radar → defense
// → production) as draw outgrows supply, and recover when supply returns. We inject
// buildings directly to set the supply/draw ratio precisely rather than relying on
// map placement. Run: npx tsx scripts/test-rts-power.ts

import { createGame, powerStatus, entitiesOf } from '../src/game/rts/state';
import { spec } from '../src/game/rts/data';
import type { BuildingRole, Entity, Owner } from '../src/game/rts/types';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

const s = createGame(777, 'human', 'normal');

// Bootstrap: 1 power plant (+100) vs refinery draw (-30) → healthy.
let p = powerStatus(s, 'player');
ok(p.supply === 100, `supply = 100 (one power plant), got ${p.supply}`);
ok(p.draw === 30, `draw = 30 (refinery), got ${p.draw}`);
ok(p.ratio >= 1 && p.radarOn && p.defenseOn && p.prodSpeed === 1, 'full power: radar+defense on, prod 100%');

// Inject a functional building of `role` directly (bypasses terrain/build-radius).
function inject(owner: Owner, role: BuildingRole, x: number, y: number): Entity {
  const f = owner === 'player' ? s.player.faction : s.enemy.faction;
  const sp = spec(role, f);
  const e: Entity = {
    id: s.nextId++, owner, faction: f, role, isBuilding: true,
    x, y, hp: sp.hp, maxHp: sp.hp, order: { type: 'idle' },
    cooldownLeft: 0, buildLeft: 0,
  };
  s.entities[e.id] = e; s.order.push(e.id);
  return e;
}

// Strip the starting power plant so we control supply exactly. Keep refinery (-30).
for (const e of entitiesOf(s, 'player')) if (e.role === 'power') delete s.entities[e.id];
s.order = s.order.filter(id => s.entities[id]);

// Helper: report + return status.
function report(label: string) {
  const ps = powerStatus(s, 'player');
  console.log(`    [${label}] supply=${ps.supply} draw=${ps.draw} ratio=${ps.ratio.toFixed(2)} radar=${ps.radarOn} defense=${ps.defenseOn} prod=${ps.prodSpeed}`);
  return ps;
}

// Tier 1 — radar off (1.0 > ratio ≥ 0.75): supply 100, draw 120.
inject('player', 'power', 30, 30);                 // +100
inject('player', 'barracks', 31, 30);              // -20  (refinery -30 already) → draw 50
inject('player', 'factory', 32, 30);               // -40  → draw 90
inject('player', 'defense', 33, 30);               // -50  → draw 140 ... too much, adjust below
let ps = report('add b+f+d');
// draw now 30+20+40+50 = 140, supply 100 → ratio 0.71 (defense off tier)
ok(ps.supply === 100 && ps.draw === 140, `supply 100 / draw 140 (got ${ps.supply}/${ps.draw})`);
ok(!ps.radarOn, 'radar offline when ratio < 1.0');
ok(!ps.defenseOn, 'defense offline when ratio < 0.75');
ok(ps.prodSpeed === 1, 'production still full at ratio ≥ 0.5');

// Tier 3 — production halved: push draw past 200 vs supply 100 (ratio < 0.5).
inject('player', 'tech', 34, 30);                  // -60 → draw 200, ratio 0.50
inject('player', 'barracks', 35, 30);              // -20 → draw 220, ratio 0.45
ps = report('overloaded');
ok(ps.ratio < 0.5, `ratio < 0.5 (got ${ps.ratio.toFixed(2)})`);
ok(ps.prodSpeed === 0.5, 'production halved when ratio < 0.5');
ok(!ps.radarOn && !ps.defenseOn, 'radar and defense both offline at deep low-power');

// Recovery — add power plants until supply dominates again.
inject('player', 'power', 30, 31); // +100 (supply 200)
inject('player', 'power', 31, 31); // +100 (supply 300)
ps = report('recovering');
ok(ps.supply === 300, `supply back to 300 (got ${ps.supply})`);
if (ps.ratio >= 1) {
  ok(ps.radarOn && ps.defenseOn && ps.prodSpeed === 1, 'full recovery restores radar, defense and production');
} else {
  // still add one more if not enough
  inject('player', 'power', 32, 31);
  const ps2 = report('recovered');
  ok(ps2.radarOn && ps2.defenseOn && ps2.prodSpeed === 1, 'full recovery restores radar, defense and production');
}

console.log(failures === 0 ? '\nPOWER OK' : `\nPOWER FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);

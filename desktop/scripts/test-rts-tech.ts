// RTS tech-gating regression — a unit cannot be built without its prerequisite
// building; once the prerequisite exists, it unlocks. Costs are deducted up front
// and refunded on cancel. Run: npx tsx scripts/test-rts-tech.ts

import {
  createGame, canBuild, issueBuild, placeBuilding, cancelBuild, sideOf, entitiesOf, tick,
} from '../src/game/rts/state';
import { spec } from '../src/game/rts/data';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

const s = createGame(42, 'human', 'normal');
const side = sideOf(s, 'player');
side.credits = 100000; // affordability never the blocker in this test

// No barracks yet → infantry gated.
ok(!canBuild(s, 'player', 'infantry').ok, 'infantry gated without barracks');
ok(canBuild(s, 'player', 'infantry').reason === 'requires_barracks', 'reason = requires_barracks');
ok(!issueBuild(s, 'player', 'infantry'), 'issueBuild refused (no barracks)');

// Tank needs a factory which needs a barracks — deep gate.
ok(!canBuild(s, 'player', 'tank').ok, 'tank gated (no factory)');
ok(!canBuild(s, 'player', 'apex').ok, 'apex gated (no tech center)');

// Build the prerequisite chain. Place near HQ within build radius.
const hq = entitiesOf(s, 'player').find(e => e.role === 'hq')!;
function placeNear(role: 'barracks' | 'factory' | 'tech'): boolean {
  for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) {
    if (placeBuilding(s, 'player', role, Math.floor(hq.x) + dx, Math.floor(hq.y) + dy)) return true;
  }
  return false;
}
ok(placeNear('barracks'), 'placed barracks');
for (const e of entitiesOf(s, 'player')) e.buildLeft = 0; // make functional
ok(canBuild(s, 'player', 'infantry').ok, 'infantry unlocked once barracks functional');

// Cost deducted up front, refunded on cancel.
const before = side.credits;
ok(issueBuild(s, 'player', 'infantry'), 'queued infantry');
ok(side.credits === before - 100, `credits deducted up front (${before} → ${side.credits})`);
ok(cancelBuild(s, 'player', side.queue.length - 1), 'cancelled queued infantry');
ok(side.credits === before, `credits refunded on cancel (back to ${before})`);

// Climb the rest of the tree.
ok(placeNear('factory'), 'placed factory');
for (const e of entitiesOf(s, 'player')) e.buildLeft = 0;
ok(canBuild(s, 'player', 'tank').ok, 'tank unlocked once factory functional');
ok(placeNear('tech'), 'placed tech center');
for (const e of entitiesOf(s, 'player')) e.buildLeft = 0;
ok(canBuild(s, 'player', 'apex').ok, 'apex unlocked once tech center functional');

// ── Construction actually completes via tick() (regression: placed buildings used
//    to stay non-functional forever, blocking all training/dependents) ──────────
const c = createGame(99, 'human', 'normal');
const cside = sideOf(c, 'player');
cside.credits = 100000;
const chq = entitiesOf(c, 'player').find(e => e.role === 'hq')!;
let placed = false;
for (let dx = -4; dx <= 4 && !placed; dx++) for (let dy = -4; dy <= 4 && !placed; dy++) {
  if (placeBuilding(c, 'player', 'barracks', Math.floor(chq.x) + dx, Math.floor(chq.y) + dy)) placed = true;
}
ok(placed, 'placed a barracks for construction test');
ok(!canBuild(c, 'player', 'infantry').ok, 'infantry still gated while barracks under construction');
const ticks = spec('barracks', 'human').buildTicks + 2;
for (let i = 0; i < ticks; i++) tick(c);
const built = entitiesOf(c, 'player').find(e => e.role === 'barracks')!;
ok(built.buildLeft <= 0, `barracks finished constructing after ${ticks} ticks (buildLeft=${built.buildLeft})`);
ok(canBuild(c, 'player', 'infantry').ok, 'infantry trainable once barracks self-completes via tick()');

console.log(failures === 0 ? '\nTECH OK' : `\nTECH FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);

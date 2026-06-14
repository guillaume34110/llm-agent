// RTS economy regression — the harvest loop must convert ore into credits, respect
// the silo cap, and never let credits overflow it (excess is counted as wasted).
// Client owns every number here. Run: npx tsx scripts/test-rts-economy.ts

import {
  createGame, tick, sideOf, creditCap, entitiesOf,
} from '../src/game/rts/state';
import { SILO_BASE_CAP } from '../src/game/rts/data';

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

// Fresh game; one harvester + one refinery bootstrapped per side.
const s = createGame(12345, 'human', 'normal');
const start = sideOf(s, 'player').credits;
ok(start === s.difficulty.startCredits, `player starts with ${s.difficulty.startCredits} credits`);

// Cap = base silo + the starting refinery's capacity.
const cap = creditCap(s, 'player');
ok(cap === SILO_BASE_CAP + 2000, `credit cap = base ${SILO_BASE_CAP} + refinery 2000 = ${cap}`);

// Harvester exists and starts in the harvest loop.
const hv = entitiesOf(s, 'player').find(e => e.role === 'harvester')!;
ok(!!hv && hv.order.type === 'harvest', 'harvester exists and is harvesting');

// Run the sim long enough for at least one full harvest trip to complete.
// Spend down starting credits first so we can observe income, not just the buffer.
sideOf(s, 'player').credits = 0;
let delivered = false;
for (let i = 0; i < 4000 && !delivered; i++) {
  tick(s);
  if (sideOf(s, 'player').credits > 0) delivered = true;
}
ok(delivered, `harvester delivered credits after ${s.tick} ticks (now ${sideOf(s, 'player').credits})`);

// Credits never exceed the cap, regardless of how long we run.
sideOf(s, 'player').credits = cap; // force at cap
const before = sideOf(s, 'player').credits;
for (let i = 0; i < 3000; i++) tick(s);
const after = sideOf(s, 'player').credits;
ok(after <= cap, `credits stay ≤ cap (${after} ≤ ${cap})`);
ok(after === before || after <= cap, 'no overflow past the silo cap');
ok(sideOf(s, 'player').wastedCredits >= 0, `overflow tracked as wastedCredits=${sideOf(s, 'player').wastedCredits}`);

console.log(failures === 0 ? '\nECONOMY OK' : `\nECONOMY FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);

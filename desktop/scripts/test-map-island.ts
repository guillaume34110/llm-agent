// Map-island regression: every place must sit ON LAND. The coastline is shrink-
// wrapped around the nodes (state.islandOutline), so for each node its radius
// (normalised to the half-extent) must be inside the coast at the node's angle,
// with a comfortable shore margin — no medallion on water. We also check the
// coast is genuinely IRREGULAR (not a near-circle) so the island looks like an
// island, not a disc.
//
// Run: npx tsx scripts/test-map-island.ts
import { buildWorld, islandShape } from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { MapSize } from '../src/game/rpg/types';

function fakeSetup(seed: number): RpgSetupResult {
  const loc = (i: number) => ({ name: `Place ${seed}-${i}`, kind: ['village', 'town', 'wild', 'forest', 'ruin', 'cave'][i % 6], blurb: 'x' });
  return {
    title: `World ${seed}`,
    intro: `intro ${seed}`,
    locations: Array.from({ length: 8 }, (_, i) => loc(i)),
    heroes: [{ className: 'Knight', blurb: 'b' }],
    quest: { title: 'Q', desc: 'D' },
    fallback: false,
  };
}

let failures = 0;
const sizes: MapSize[] = ['small', 'medium', 'large'];

for (const size of sizes) {
  let worstSlack = Infinity;       // smallest (coast - nodeRadius), must stay > 0
  let maxIrregular = 0;            // max coast spread across angles
  for (let s = 0; s < 8; s++) {
    const state = buildWorld(fakeSetup(s * 131 + 7), `theme-${size}-${s}`, 0, size);
    const coast = islandShape(state.seed || 1);

    // 1. containment: every node inside the coast at its own angle.
    for (const id of state.order) {
      const n = state.nodes[id];
      const nx = (n.x - 0.5) * 2, ny = (n.y - 0.5) * 2;
      const r = Math.hypot(nx, ny);
      const a = Math.atan2(ny, nx);
      const slack = coast(a) - r;
      if (slack < worstSlack) worstSlack = slack;
      if (slack <= 0) {
        failures++;
        console.error(`  ✗ ${size} seed ${s}: place ${id} on water (r=${r.toFixed(3)} > coast ${coast(a).toFixed(3)})`);
      }
    }

    // 2. irregularity: sample the coast around the circle; spread must be sizeable.
    let lo = Infinity, hi = 0;
    for (let i = 0; i < 180; i++) {
      const rad = coast((i / 180) * Math.PI * 2);
      lo = Math.min(lo, rad); hi = Math.max(hi, rad);
    }
    maxIrregular = Math.max(maxIrregular, hi - lo);
  }
  console.log(`${size.padEnd(7)} shore slack min ${worstSlack.toFixed(3)}  coast spread max ${maxIrregular.toFixed(3)}`);
  if (worstSlack < 0.02) {
    failures++;
    console.error(`  ✗ ${size}: shore margin too thin (${worstSlack.toFixed(3)}) — places hug the waterline`);
  }
  if (maxIrregular < 0.12) {
    failures++;
    console.error(`  ✗ ${size}: coastline too round (spread ${maxIrregular.toFixed(3)}) — looks like a disc, not an island`);
  }
}

if (failures) {
  console.error(`\nMAP ISLAND: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nMAP ISLAND: all good ✓');

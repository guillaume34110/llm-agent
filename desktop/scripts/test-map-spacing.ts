// Map-spacing regression: the world must grow PHYSICALLY with its node count and
// keep the medallions well apart (no cramming when the world gets bigger).
//
// For each size we build several worlds and measure the minimum nearest-neighbour
// distance in *pixels* (normalized coords × mapDimensions). A medallion is ~38px
// across, so anything ≥ MIN_PX guarantees they never overlap. We also assert the
// canvas actually scales up with the node count (bigger world ⇒ more pixels).
//
// Run: npx tsx scripts/test-map-spacing.ts
import { buildWorld, mapDimensions } from '../src/game/rpg/state';
import type { RpgSetupResult } from '../src/api';
import type { MapSize } from '../src/game/rpg/types';

const MIN_PX = 44;          // medallion diameter ~38px + breathing room
const WORLDS_PER_SIZE = 8;

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

function minNeighbourPx(state: ReturnType<typeof buildWorld>): { min: number; n: number; W: number; H: number } {
  const { W, H } = mapDimensions(state.order.length);
  const pts = state.order.map(id => ({ x: state.nodes[id].x * W, y: state.nodes[id].y * H }));
  let min = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < min) min = d;
    }
  return { min, n: state.order.length, W, H };
}

let failures = 0;
const sizes: MapSize[] = ['small', 'medium', 'large'];
const avgArea: Record<string, number> = {};
const avgN: Record<string, number> = {};

for (const size of sizes) {
  let worstMin = Infinity, sumArea = 0, sumN = 0, sumMin = 0;
  for (let s = 0; s < WORLDS_PER_SIZE; s++) {
    const state = buildWorld(fakeSetup(s * 131 + 7), `theme-${size}-${s}`, 0, size);
    const { min, n, W, H } = minNeighbourPx(state);
    sumArea += W * H; sumN += n; sumMin += min;
    worstMin = Math.min(worstMin, min);
    if (min < MIN_PX) {
      failures++;
      console.error(`  ✗ ${size} seed ${s}: min spacing ${min.toFixed(1)}px (n=${n}, ${W}×${H}) < ${MIN_PX}`);
    }
  }
  avgArea[size] = sumArea / WORLDS_PER_SIZE;
  avgN[size] = sumN / WORLDS_PER_SIZE;
  console.log(`${size.padEnd(7)} n≈${(sumN / WORLDS_PER_SIZE).toFixed(0).padStart(3)}  canvas≈${Math.round(avgArea[size]).toLocaleString()}px²  minNN avg ${(sumMin / WORLDS_PER_SIZE).toFixed(1)}px  worst ${worstMin.toFixed(1)}px`);
}

// Physical growth: a larger world must use a bigger canvas than a smaller one.
if (!(avgArea.small < avgArea.medium && avgArea.medium < avgArea.large)) {
  failures++;
  console.error('  ✗ canvas area does not grow with world size (map not physically bigger)');
}
// Per-node area should stay ~flat (spacing constant, not cramming).
for (const size of sizes) {
  const perNode = avgArea[size] / avgN[size];
  if (perNode < 9000) {
    failures++;
    console.error(`  ✗ ${size}: only ${Math.round(perNode)}px² per node — too cramped`);
  }
}

if (failures) {
  console.error(`\nMAP SPACING: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nMAP SPACING: all good ✓');

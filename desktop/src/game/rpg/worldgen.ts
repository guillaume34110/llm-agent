import type { MapSize, NodeKind, MapNode } from './types';
import { makeRng, seedFrom } from './dice';

export const REQ_BY_SIZE: Record<MapSize, number> = { small: 3, medium: 4, large: 5 };

// ── World / graph generation (procedural topology from LLM content) ──────────

// Procedural place names so a world has far more destinations than the LLM
// bothered to name — every POI's full info (name, kind, blurb, danger, links)
// is generated here, at world creation, so the map is a real, finished place.

export const POI_PREFIX = [
  'Old', 'Grey', 'Far', 'Black', 'High', 'Low', 'Hidden', 'Lost', 'Silent', 'Broken',
  'Red', 'White', 'Thorn', 'Wolf', 'Raven', 'Stone', 'Iron', 'Mist', 'Frost', 'Sun',
  'Moon', 'Ash', 'Cold', 'Green', 'Salt', 'Elder', 'Wind', 'Deep',
];
export const POI_SUFFIX: Record<NodeKind, string[]> = {
  village: ['Hollow', 'Crossing', 'Ford', 'Hearth', 'Mill', 'Glen', 'Stead', 'End'],
  town: ['Market', 'Gate', 'Keep', 'Haven', 'Harbor', 'Hold', 'Bridge', 'Reach'],
  forest: ['Wood', 'Thicket', 'Grove', 'Wilds', 'Boughs', 'Pines', 'Glade'],
  wild: ['Road', 'Moor', 'Steppe', 'Flats', 'Heath', 'Trail', 'Pass'],
  camp: ['Camp', 'Outpost', 'Watch', 'Bivouac', 'Waystation'],
  ruin: ['Ruins', 'Remains', 'Wreck', 'Vestige', 'Fallen'],
  dungeon: ['Crypt', 'Vault', 'Maze', 'Catacomb', 'Deep'],
  cave: ['Cave', 'Den', 'Grotto', 'Cavern', 'Hollows'],
};
export const POI_BLURB: Record<NodeKind, string[]> = {
  village: ['A cluster of cottages around a muddy square.', 'Smoke curls from a handful of thatched roofs.', 'A quiet hamlet wary of strangers.'],
  town: ['Busy streets behind a watchful gatehouse.', 'Stalls, guards, and the clamor of trade.', 'A walled town that never quite sleeps.'],
  forest: ['Tall trunks crowd out the light.', 'Roots and brambles snare every step.', 'Birdsong, then a sudden silence.'],
  wild: ['Open ground stretches to the horizon.', 'A cracked road swallowed by tall grass.', 'Wind, dust, and little shelter.'],
  camp: ['A ring of tents around a low fire.', 'Travelers share the warmth of the coals.', 'A rough waystation off the road.'],
  ruin: ['Toppled stone, claimed by weeds.', 'The bones of an older age lie scattered.', 'Crumbled walls keep their secrets.'],
  dungeon: ['Cold stairs descend into the dark.', 'A reek of damp and old iron.', 'Something stirs below the threshold.'],
  cave: ['A black mouth breathes cold air.', 'Dripping echoes lead deeper in.', 'Damp tunnels twist out of sight.'],
};
export const FILL_KINDS: NodeKind[] = ['wild', 'forest', 'wild', 'forest', 'cave', 'ruin', 'camp', 'village', 'dungeon'];

// Scatter points across the unit square via a jittered, shuffled grid, then a
// few relaxation passes that gently push apart any pair sitting closer than the
// grid's comfort gap. The grid keeps the global spread even (an open 2D world,
// not a corridor); the relaxation guarantees no two medallions ever collide, so
// the places stay legible no matter the world size.
// The master island shape: an irregular radial boundary (fraction of the map
// half-extent) the scatter confines places to. Because the places fill THIS shape
// rather than a plain disc, the coastline wrapped around them is irregular too —
// the island reads as an island, not a circle. A few low harmonics with random
// phase make smooth bays/capes; the floor/ceiling keep it one plump landmass.
export function islandShape(seed: number): (theta: number) => number {
  const rng = makeRng(seedFrom('islandShape:' + seed));
  const harm = [2, 3, 4, 5].map(k => ({ k, amp: (0.07 + rng() * 0.11) / Math.sqrt(k), ph: rng() * Math.PI * 2 }));
  const base = 0.82;
  return (theta: number) => {
    let r = base;
    for (const h of harm) r += h.amp * Math.sin(h.k * theta + h.ph);
    return Math.min(0.93, Math.max(0.67, r));   // plump enough that bays never cram places
  };
}

// Is a pixel inside the island? Mirrors islandPath exactly: a point at (px,py)
// in the W×H map sits on land when its distance from the map centre (normalised by
// the per-angle half-extent) is within the island profile for that angle. The hex
// terrain layer uses this to keep tiles off the sea — same shape the places sit on.
export function insideIsland(px: number, py: number, seed: number, W: number, H: number): boolean {
  const profile = islandShape(seed);
  const cx = W / 2, cy = H / 2, rx = W * 0.5, ry = H * 0.5;
  if (rx === 0 || ry === 0) return false;
  const dx = (px - cx) / rx, dy = (py - cy) / ry;
  const rad = Math.hypot(dx, dy);
  return rad <= profile(Math.atan2(dy, dx));
}

export function scatter2D(
  n: number,
  rng: () => number,
  boundary: (theta: number) => number,
): Array<{ x: number; y: number }> {
  const cols = Math.max(2, Math.round(Math.sqrt(n * 1.5)));
  const rows = Math.max(2, Math.ceil(n / cols));
  const cells: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ r, c });
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // Pull a point back inside the irregular island shape (a shore margin under the
  // coast), with a hard box as a safety net.
  const confine = (p: { x: number; y: number }) => {
    const nx = (p.x - 0.5) * 2, ny = (p.y - 0.5) * 2;      // → [-1,1]
    const r = Math.hypot(nx, ny);
    const max = boundary(Math.atan2(ny, nx)) * 0.90;       // inside the coast, ~10% shore
    if (r > max) { const s = max / r; p.x = nx * s / 2 + 0.5; p.y = ny * s / 2 + 0.5; }
    p.x = clamp(p.x, 0.04, 0.96); p.y = clamp(p.y, 0.04, 0.96);
  };
  const pts = cells.slice(0, n).map(({ r, c }) => ({
    x: (c + 0.5 + (rng() - 0.5) * 0.6) / cols,
    y: (r + 0.5 + (rng() - 0.5) * 0.6) / rows,
  }));
  // Lloyd-ish separation: the comfort gap is a fraction of a grid cell so points
  // keep their slot but never overlap. Confinement runs inside the loop so the
  // relaxation re-spreads any points the disc pushed inward (spacing preserved).
  const minGap = 0.74 / Math.max(cols, rows);
  for (let pass = 0; pass < 11; pass++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-6 && d < minGap) {
          const push = (minGap - d) / 2;
          const ux = dx / d, uy = dy / d;
          pts[i].x -= ux * push; pts[i].y -= uy * push;
          pts[j].x += ux * push; pts[j].y += uy * push;
        }
      }
    }
    for (const p of pts) confine(p);
  }
  return pts;
}

// Physical map canvas size for a world of n places. The pixel area scales with
// the node count, so a bigger world becomes a physically larger, pannable map
// with constant spacing between places — NOT the same canvas with everything
// crammed closer together. ~16k px² per place → roughly 80px between neighbours
// at any size. The map view zooms + pans, so even the largest stays navigable.
export function mapDimensions(n: number): { W: number; H: number } {
  // Larger than the raw spacing target because places now live inside a disc
  // (the island), not the full rect — the extra area keeps neighbour spacing
  // constant once nodes are confined to the landmass.
  const AREA_PER_NODE = 48000;
  const ASPECT = 1.5;
  const area = Math.max(480 * 320, n * AREA_PER_NODE);
  const H = Math.round(Math.sqrt(area / ASPECT));
  const W = Math.round(H * ASPECT);
  return { W, H };
}

export const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy;
};

// Player-chosen world scale → how many places the map holds. Roughly 10× the
// old counts so every run is a sprawling, pannable world (the map view zooms +
// pans, so the density stays navigable). All numbers stay client-owned.
export const SIZE_TARGET: Record<MapSize, [number, number]> = {
  small: [70, 90],
  medium: [110, 140],
  large: [170, 220],
};
export function link(nodes: Record<string, MapNode>, a: string, b: string): void {
  if (a === b) return;
  if (!nodes[a].edges.includes(b)) nodes[a].edges.push(b);
  if (!nodes[b].edges.includes(a)) nodes[b].edges.push(a);
}

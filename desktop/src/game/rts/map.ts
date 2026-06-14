// RTS « Iron Marsh » — deterministic map generation. Reuses the RPG's tiny
// seedable RNG (makeRng/seedFrom in rpg/dice.ts) so a seed always yields the same
// battlefield. Each seed picks a random start placement and one of several terrain
// styles, so no two seeds look alike, while the two bases stay point-symmetric
// across the map centre — always far apart (never adjacent) and keeping the enemy
// AI's mirror-guess of the player base exact.

import { makeRng, seedFrom } from '../rpg/dice';
import type { Terrain } from './types';

export interface GeneratedMap {
  w: number;
  h: number;
  terrain: Terrain[];
  ore: number[];                 // ore amount per tile (0 where none)
  oreMax: number[];              // regen cap per ore tile (0 where none)
  playerStart: { x: number; y: number };
  enemyStart: { x: number; y: number };
  style: MapStyle;               // chosen terrain archetype (flavour / debug)
}

const ORE_PER_TILE = 2200;       // richer veins so fields last (was 800)

// Terrain archetypes. Each tunes obstacle density, rock/water mix and whether a
// crossable river splits the map — enough variety that the battlefield feels
// different every game without ever walling a base off.
export type MapStyle = 'rocky' | 'lakes' | 'river' | 'open' | 'maze';
const STYLES: MapStyle[] = ['rocky', 'lakes', 'river', 'open', 'maze'];

interface StyleParams {
  blobs: number;        // base obstacle-blob count
  blobJitter: number;   // extra random blobs on top
  waterChance: number;  // 0..1 chance a blob is water (else rock)
  maxRad: number;       // max blob radius
  river: boolean;       // carve a crossable diagonal river
}

function styleParams(style: MapStyle, rng: () => number): StyleParams {
  switch (style) {
    case 'rocky': return { blobs: 18, blobJitter: 12, waterChance: 0.18, maxRad: 3, river: false };
    case 'lakes': return { blobs: 6, blobJitter: 6, waterChance: 0.85, maxRad: 5, river: false };
    case 'river': return { blobs: 8, blobJitter: 8, waterChance: 0.4, maxRad: 3, river: true };
    case 'open': return { blobs: 4, blobJitter: 5, waterChance: 0.35, maxRad: 2, river: false };
    case 'maze': return { blobs: 26, blobJitter: 14, waterChance: 0.1, maxRad: 2, river: false };
    default: { void rng; return { blobs: 16, blobJitter: 12, waterChance: 0.35, maxRad: 3, river: false }; }
  }
}

export function generateMap(seed: number, w = 72, h = 72): GeneratedMap {
  const rng = makeRng(seedFrom('rts:map:' + seed));
  const terrain: Terrain[] = new Array(w * h).fill('ground');
  const ore: number[] = new Array(w * h).fill(0);
  const oreMax: number[] = new Array(w * h).fill(0);
  const at = (x: number, y: number) => y * w + x;
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

  const style = STYLES[Math.floor(rng() * STYLES.length)];
  const p = styleParams(style, rng);

  // ── Starts: random direction from centre, mirrored to the opposite side ──────
  // Picking a single offset and reflecting it through the map centre keeps the two
  // bases point-symmetric (mirror guess stays exact) and guarantees they are 2×r
  // apart — far enough that they can never spawn next to each other.
  const margin = 8;                         // keep the build apron inside the map
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const minR = Math.min(w, h) * 0.36;       // floor on half the base separation
  const maxR = Math.min(w, h) * 0.5 - margin;
  const ang = rng() * Math.PI * 2;
  const r = minR + rng() * Math.max(0, maxR - minR);
  const px = clamp(Math.round(cx + Math.cos(ang) * r), margin, w - 1 - margin);
  const py = clamp(Math.round(cy + Math.sin(ang) * r), margin, h - 1 - margin);
  const playerStart = { x: px, y: py };
  const enemyStart = { x: (w - 1) - px, y: (h - 1) - py };

  const APRON = 11;
  const nearStart = (x: number, y: number, rr: number) =>
    Math.hypot(x - playerStart.x, y - playerStart.y) < rr ||
    Math.hypot(x - enemyStart.x, y - enemyStart.y) < rr;

  // ── Scatter obstacle blobs (rock = impassable, water = chokepoint) ───────────
  const blobs = p.blobs + Math.floor(rng() * p.blobJitter);
  for (let b = 0; b < blobs; b++) {
    const bx = Math.floor(rng() * w), by = Math.floor(rng() * h);
    if (nearStart(bx, by, APRON)) continue;
    const kind: Terrain = rng() < p.waterChance ? 'water' : 'rock';
    const rad = 1 + Math.floor(rng() * p.maxRad);
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      const x = bx + dx, y = by + dy;
      if (!inB(x, y) || nearStart(x, y, APRON - 1)) continue;
      if (Math.hypot(dx, dy) <= rad + rng() * 0.6) terrain[at(x, y)] = kind;
    }
  }

  // ── Optional river: thin diagonal water band with guaranteed wide fords so it
  // never severs the map (units path around or through the gaps). ───────────────
  if (p.river) {
    const horiz = rng() < 0.5;
    const span = horiz ? w : h;
    const cross = horiz ? h : w;
    const base = Math.floor(cross * (0.4 + rng() * 0.2));   // river centreline
    const width = 1 + Math.floor(rng() * 2);
    const fordEvery = 16, fordWide = 5;
    const phase = Math.floor(rng() * fordEvery);
    for (let s = 0; s < span; s++) {
      if ((s + phase) % fordEvery < fordWide) continue;     // leave a ford
      const wobble = Math.round(Math.sin(s * 0.18) * 2);
      for (let d = -width; d <= width; d++) {
        const c = base + wobble + d;
        const x = horiz ? s : c, y = horiz ? c : s;
        if (!inB(x, y) || nearStart(x, y, APRON)) continue;
        if (terrain[at(x, y)] === 'ground') terrain[at(x, y)] = 'water';
      }
    }
  }

  // ── Ore fields ───────────────────────────────────────────────────────────────
  // A home vein beside each start (offset toward centre so harvesting pulls units
  // inward), a contested central field, plus a couple of point-symmetric expansion
  // fields jittered per seed so spreading out always pays off.
  const towardCenter = (s: { x: number; y: number }, d: number) => ({
    x: clamp(s.x + Math.sign(cx - s.x) * d, 3, w - 4),
    y: clamp(s.y + Math.sign(cy - s.y) * d, 3, h - 4),
  });
  const expAng = rng() * Math.PI * 2;
  const expR = Math.min(w, h) * (0.18 + rng() * 0.1);
  const expA = { x: clamp(Math.round(cx + Math.cos(expAng) * expR), 4, w - 5), y: clamp(Math.round(cy + Math.sin(expAng) * expR), 4, h - 5) };
  const expB = { x: (w - 1) - expA.x, y: (h - 1) - expA.y };
  const homeA = towardCenter(playerStart, 8);
  const homeB = towardCenter(enemyStart, 8);

  const fields = [
    { x: homeA.x, y: homeA.y, r: 7 },                        // player home vein
    { x: homeB.x, y: homeB.y, r: 7 },                        // enemy home vein
    { x: Math.round(cx), y: Math.round(cy), r: 8 },          // central contested
    { x: expA.x, y: expA.y, r: 6 },                          // expansion A
    { x: expB.x, y: expB.y, r: 6 },                          // expansion B (mirror)
  ];
  for (const f of fields) {
    for (let dy = -f.r; dy <= f.r; dy++) for (let dx = -f.r; dx <= f.r; dx++) {
      const x = f.x + dx, y = f.y + dy;
      if (!inB(x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d <= f.r && terrain[at(x, y)] === 'ground') {
        terrain[at(x, y)] = 'ore';
        const amount = Math.floor(ORE_PER_TILE * (1 - d / (f.r + 1)) + rng() * 200);
        ore[at(x, y)] = amount;
        oreMax[at(x, y)] = amount;
      }
    }
  }

  return { w, h, terrain, ore, oreMax, playerStart, enemyStart, style };
}

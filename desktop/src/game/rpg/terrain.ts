import type { NodeKind } from './types';
import type { Hex } from './hexmap';

// ── Tile terrain (pure leaf — Curious-Expedition-style climatic ground) ───────
// A hex tile is no longer just "the colour of the nearest place". It has its own
// TERRAIN, drawn from a deterministic climate field (elevation + moisture +
// temperature value-noise over the hex coords). That gives the island the spread
// of distinct grounds CE2 has — deserts, snow peaks, marshes, jungle, savanna,
// mountains — instead of eight near-identical biome tints. POIs still sit on
// terrain matched to their kind (a forest village on forest, a crypt on stone).
// Imports only ./types and the Hex type → stays a leaf, zero cycles. Every number
// is computed here (client-owns-numbers): the LLM never authors a tile.

// Ten land terrains (sea + shore are renderer states, not climate) — already more
// distinct grounds than CE2's terrain set, and each paints a clearly different hue.
export type Terrain =
  | 'grass' | 'forest' | 'jungle' | 'savanna' | 'desert'
  | 'marsh' | 'hills' | 'mountain' | 'snow' | 'badlands';

export const TERRAINS: ReadonlyArray<Terrain> = [
  'grass', 'forest', 'jungle', 'savanna', 'desert', 'marsh', 'hills', 'mountain', 'snow', 'badlands',
];

// The terrain a place rests on (its own tile + immediate ring), so a place reads
// coherently with its ground regardless of the climate underneath.
export const NODE_TERRAIN: Record<NodeKind, Terrain> = {
  forest: 'forest', village: 'grass', town: 'grass', camp: 'savanna',
  wild: 'savanna', ruin: 'badlands', dungeon: 'mountain', cave: 'hills',
};

// Integer hash → [0,1). Mixes a 32-bit seed with two lattice coords (xorshift
// finisher). Deterministic, fast, no allocation — the basis for the value noise.
function hash2(seed: number, ix: number, iy: number): number {
  let h = (seed | 0) * 374761393 + (ix | 0) * 668265263 + (iy | 0) * 2246822519;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);   // smoothstep ease

// Bilinear value noise on the integer lattice — a smooth field in [0,1].
function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const v00 = hash2(seed, x0, y0), v10 = hash2(seed, x0 + 1, y0);
  const v01 = hash2(seed, x0, y0 + 1), v11 = hash2(seed, x0 + 1, y0 + 1);
  const top = v00 + (v10 - v00) * fx;
  const bot = v01 + (v11 - v01) * fx;
  return top + (bot - top) * fy;
}

// Fractal sum of a few octaves → a natural-looking field, normalised to ~[0,1].
function fbm(seed: number, x: number, y: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise(seed + o * 1013, x * freq, y * freq);
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// The climatic terrain of a hex: elevation picks peaks/mountains/hills; the
// lowlands are split by temperature × moisture into the dry-to-wet spread
// (desert → savanna/badlands → grass → forest → jungle, plus marsh in wet
// hollows). Pure + deterministic from (seed, q, r). `poi` overrides the climate
// for a place's own tile so it sits on ground that matches its kind.
export function terrainAt(h: Hex, seed: number, poi?: Terrain): Terrain {
  if (poi) return poi;
  const elev = fbm(seed ^ 0x9e3779b9, h.q * 0.16, h.r * 0.16);
  const moist = fbm((seed ^ 0x85ebca6b) >>> 0, h.q * 0.13 + 11.5, h.r * 0.13 + 11.5);
  const temp = fbm((seed ^ 0xc2b2ae35) >>> 0, h.q * 0.11 - 7.5, h.r * 0.11 - 7.5);

  if (elev > 0.74) return 'snow';
  if (elev > 0.64) return 'mountain';
  if (elev > 0.56) return 'hills';

  // Lowlands.
  if (elev < 0.34 && moist > 0.56) return 'marsh';
  if (temp > 0.60) {                       // hot belt
    if (moist < 0.30) return 'desert';
    if (moist > 0.68) return 'jungle';
    return elev > 0.46 && moist < 0.46 ? 'badlands' : 'savanna';
  }
  if (temp < 0.36) {                       // cold belt
    return moist > 0.58 ? 'forest' : 'grass';
  }
  // Temperate belt.
  if (moist > 0.62) return 'forest';
  if (moist < 0.30) return 'savanna';
  return 'grass';
}

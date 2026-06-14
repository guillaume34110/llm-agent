import type { NodeKind } from './types';

// ── Hex-tile map geometry (pure leaf — Curious-Expedition-style tile board) ───
// CE2 reads the world as a hex grid you reveal tile-by-tile under fog. Monkey
// Quest keeps its node-graph travel (a closed POI network), but the world is now
// PAINTED as hex tiles: each tile takes the biome of its nearest discovered
// place and is veiled by fog until a place near it is found. This module owns the
// geometry only — axial coords, pixel mapping, neighbours, fog radius. It imports
// nothing but the NodeKind type, so it stays a leaf with zero cycles, and every
// number is computed here (client-owns-numbers): the LLM never touches a tile.

// Pointy-top axial coordinates (q across, r down). Standard redblobgames layout.
export interface Hex { q: number; r: number; }
export interface PixelPoint { x: number; y: number; }

const SQRT3 = Math.sqrt(3);

export function hexKey(h: Hex): string { return `${h.q},${h.r}`; }

// Centre pixel of a hex for a given tile `size` (centre-to-corner radius).
export function hexToPixel(h: Hex, size: number, origin: PixelPoint = { x: 0, y: 0 }): PixelPoint {
  return {
    x: origin.x + size * (SQRT3 * h.q + (SQRT3 / 2) * h.r),
    y: origin.y + size * (1.5 * h.r),
  };
}

// Cube-rounding of fractional axial coords to the nearest whole hex.
export function hexRound(qf: number, rf: number): Hex {
  const xf = qf, zf = rf, yf = -xf - zf;
  let rx = Math.round(xf), ry = Math.round(yf), rz = Math.round(zf);
  const dx = Math.abs(rx - xf), dy = Math.abs(ry - yf), dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

// The hex containing a pixel point (inverse of hexToPixel + rounding).
export function pixelToHex(p: PixelPoint, size: number, origin: PixelPoint = { x: 0, y: 0 }): Hex {
  const px = p.x - origin.x, py = p.y - origin.y;
  const qf = (SQRT3 / 3 * px - 1 / 3 * py) / size;
  const rf = (2 / 3 * py) / size;
  return hexRound(qf, rf);
}

// The six axial step directions, then the six neighbours of a hex.
const DIRS: ReadonlyArray<Hex> = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];
export function hexNeighbours(h: Hex): Hex[] {
  return DIRS.map(d => ({ q: h.q + d.q, r: h.r + d.r }));
}

// Axial (cube) distance — the number of tile steps between two hexes.
export function hexDistance(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

// The six corner points of a pointy-top hex (for an SVG polygon).
export function hexCorners(center: PixelPoint, size: number): PixelPoint[] {
  const pts: PixelPoint[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30);
    pts.push({ x: center.x + size * Math.cos(ang), y: center.y + size * Math.sin(ang) });
  }
  return pts;
}

// Every hex whose centre falls inside the W×H rect (with a `margin` ring of extra
// tiles so the board bleeds past the edges instead of stopping short). Deterministic
// row-by-row enumeration — same dimensions and size always yield the same tiling.
export function hexesCovering(W: number, H: number, size: number, margin = 1): Hex[] {
  if (size <= 0) return [];
  // r is driven by y alone (y = size·1.5·r); bound it from the rect height.
  const rMin = Math.floor((0) / (size * 1.5)) - margin;
  const rMax = Math.ceil(H / (size * 1.5)) + margin;
  const out: Hex[] = [];
  for (let r = rMin; r <= rMax; r++) {
    // For this row, x = size·(√3·q + √3/2·r) ⇒ solve q for x in [0,W].
    const shift = (SQRT3 / 2) * r;
    const qMin = Math.floor((0 / size) / SQRT3 - shift / SQRT3) - margin;
    const qMax = Math.ceil((W / size) / SQRT3 - shift / SQRT3) + margin;
    for (let q = qMin; q <= qMax; q++) out.push({ q, r });
  }
  return out;
}

// The NodeKind a tile inherits: the biome of the nearest discovered place (a
// hex-grid Voronoi). Squared distance — no sqrt needed for the argmin.
export function nearestKind(
  center: PixelPoint,
  sites: ReadonlyArray<{ p: PixelPoint; kind: NodeKind }>,
): NodeKind | null {
  let best: NodeKind | null = null, bd = Infinity;
  for (const s of sites) {
    const dx = s.p.x - center.x, dy = s.p.y - center.y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = s.kind; }
  }
  return best;
}

// The set of hex keys revealed by fog: every tile within `radius` steps of any
// discovered place's hex. Walking to a new place lights up the tiles around it,
// exactly like CE2's expanding fog. Pure — caller passes the discovered centres.
export function revealedKeys(centers: ReadonlyArray<Hex>, radius: number): Set<string> {
  const out = new Set<string>();
  const rad = Math.max(0, Math.floor(radius));
  for (const c of centers) {
    for (let dq = -rad; dq <= rad; dq++) {
      const lo = Math.max(-rad, -dq - rad), hi = Math.min(rad, -dq + rad);
      for (let dr = lo; dr <= hi; dr++) out.add(hexKey({ q: c.q + dq, r: c.r + dr }));
    }
  }
  return out;
}

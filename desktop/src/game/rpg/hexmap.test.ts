import { describe, it, expect } from 'vitest';
import {
  hexKey, hexToPixel, pixelToHex, hexRound, hexNeighbours, hexDistance,
  hexCorners, hexesCovering, nearestKind, revealedKeys, type Hex,
} from './hexmap';

describe('hex axial geometry', () => {
  it('round-trips a hex through pixel space (pixelToHex ∘ hexToPixel = id)', () => {
    const size = 24;
    for (const h of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -4, r: 5 }, { q: 7, r: 1 }]) {
      const back = pixelToHex(hexToPixel(h, size), size);
      expect(back).toEqual(h);
    }
  });

  it('honours a pixel origin offset', () => {
    const size = 20, origin = { x: 100, y: 50 };
    const h: Hex = { q: 2, r: -1 };
    const px = hexToPixel(h, size, origin);
    expect(pixelToHex(px, size, origin)).toEqual(h);
  });

  it('rounds a fractional coord to the nearest valid (q,r) on the cube constraint', () => {
    // q+r+s = 0 must hold for the cube form; rounding never breaks it.
    const h = hexRound(1.2, -0.4);
    expect(Number.isInteger(h.q)).toBe(true);
    expect(Number.isInteger(h.r)).toBe(true);
  });

  it('gives exactly six distinct neighbours, each at distance 1', () => {
    const h: Hex = { q: 2, r: -3 };
    const ns = hexNeighbours(h);
    expect(ns.length).toBe(6);
    expect(new Set(ns.map(hexKey)).size).toBe(6);
    for (const n of ns) expect(hexDistance(h, n)).toBe(1);
  });

  it('computes axial distance (0 to self, symmetric, straight line additive)', () => {
    const a: Hex = { q: 0, r: 0 }, b: Hex = { q: 3, r: 0 }, c: Hex = { q: 6, r: 0 };
    expect(hexDistance(a, a)).toBe(0);
    expect(hexDistance(a, b)).toBe(3);
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
    expect(hexDistance(a, c)).toBe(hexDistance(a, b) + hexDistance(b, c));
  });

  it('emits six hex corners around the centre', () => {
    const c = { x: 50, y: 50 };
    const pts = hexCorners(c, 10);
    expect(pts.length).toBe(6);
    for (const p of pts) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(10, 5);
  });
});

describe('hexesCovering — tiling a rectangle', () => {
  it('produces a deterministic, non-empty tiling whose centres span the rect', () => {
    const W = 400, H = 300, size = 22;
    const a = hexesCovering(W, H, size);
    const b = hexesCovering(W, H, size);
    expect(a.map(hexKey)).toEqual(b.map(hexKey)); // deterministic
    expect(a.length).toBeGreaterThan(0);
    // At least one tile centre lands inside the rect interior.
    const inside = a.some(h => {
      const p = hexToPixel(h, size);
      return p.x > 0 && p.x < W && p.y > 0 && p.y < H;
    });
    expect(inside).toBe(true);
    // Keys are unique (no tile enumerated twice).
    expect(new Set(a.map(hexKey)).size).toBe(a.length);
  });

  it('returns nothing for a non-positive tile size', () => {
    expect(hexesCovering(400, 300, 0)).toEqual([]);
    expect(hexesCovering(400, 300, -5)).toEqual([]);
  });
});

describe('nearestKind — tile inherits its nearest place biome', () => {
  it('picks the closest site by squared distance', () => {
    const sites = [
      { p: { x: 0, y: 0 }, kind: 'forest' as const },
      { p: { x: 100, y: 0 }, kind: 'dungeon' as const },
    ];
    expect(nearestKind({ x: 10, y: 0 }, sites)).toBe('forest');
    expect(nearestKind({ x: 90, y: 0 }, sites)).toBe('dungeon');
  });

  it('returns null when there are no discovered sites (all-fog board)', () => {
    expect(nearestKind({ x: 5, y: 5 }, [])).toBeNull();
  });
});

describe('revealedKeys — fog expands by tile radius around discovered places', () => {
  it('reveals exactly the hexes within `radius` steps of a centre', () => {
    const center: Hex = { q: 0, r: 0 };
    const r1 = revealedKeys([center], 1);
    // A radius-1 disc on a hex grid = the centre + its 6 neighbours = 7 tiles.
    expect(r1.size).toBe(7);
    expect(r1.has(hexKey(center))).toBe(true);
    for (const n of hexNeighbours(center)) expect(r1.has(hexKey(n))).toBe(true);
    // Radius 2 = 1 + 6 + 12 = 19 tiles (hex number sequence).
    expect(revealedKeys([center], 2).size).toBe(19);
  });

  it('radius 0 reveals only the centre tile', () => {
    const s = revealedKeys([{ q: 2, r: 2 }], 0);
    expect(s.size).toBe(1);
    expect(s.has('2,2')).toBe(true);
  });

  it('unions overlapping discs without double-counting shared tiles', () => {
    const adj = revealedKeys([{ q: 0, r: 0 }, { q: 1, r: 0 }], 1);
    // Two radius-1 discs one step apart share tiles; union < 14.
    expect(adj.size).toBeLessThan(14);
    expect(adj.size).toBeGreaterThan(7);
  });

  it('reveals nothing when no places are discovered', () => {
    expect(revealedKeys([], 3).size).toBe(0);
  });
});

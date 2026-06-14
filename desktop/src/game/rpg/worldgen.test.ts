import { describe, it, expect } from 'vitest';
import {
  REQ_BY_SIZE, SIZE_TARGET, FILL_KINDS, POI_PREFIX, POI_SUFFIX, POI_BLURB,
  islandShape, scatter2D, mapDimensions, d2, link, insideIsland,
} from './worldgen';
import type { MapSize, NodeKind, MapNode } from './types';

// A deterministic rng handing back a fixed queue, then 0 forever.
function rngOf(...vals: number[]): () => number {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
}

const SIZES: MapSize[] = ['small', 'medium', 'large'];
const KINDS: NodeKind[] = ['village', 'town', 'forest', 'wild', 'camp', 'ruin', 'dungeon', 'cave'];

describe('world tables', () => {
  it('boss req level rises with the world scale', () => {
    expect(REQ_BY_SIZE.small).toBeLessThan(REQ_BY_SIZE.medium);
    expect(REQ_BY_SIZE.medium).toBeLessThan(REQ_BY_SIZE.large);
  });
  it('SIZE_TARGET bounds are ordered low ≤ high and grow with scale', () => {
    SIZES.forEach(s => expect(SIZE_TARGET[s][0]).toBeLessThanOrEqual(SIZE_TARGET[s][1]));
    expect(SIZE_TARGET.small[1]).toBeLessThan(SIZE_TARGET.medium[0]);
    expect(SIZE_TARGET.medium[1]).toBeLessThan(SIZE_TARGET.large[0]);
  });
  it('POI suffix + blurb tables cover every node kind, and prefixes are non-empty', () => {
    for (const k of KINDS) {
      expect(POI_SUFFIX[k].length).toBeGreaterThan(0);
      expect(POI_BLURB[k].length).toBeGreaterThan(0);
      expect(POI_BLURB[k].every(b => typeof b === 'string' && b.length > 0)).toBe(true);
    }
    expect(POI_PREFIX.length).toBeGreaterThan(0);
  });
  it('FILL_KINDS only references known node kinds', () => {
    expect(FILL_KINDS.every(k => KINDS.includes(k))).toBe(true);
  });
});

describe('islandShape', () => {
  it('keeps the radius plump within [0.67, 0.93] for any angle', () => {
    const shape = islandShape(42);
    for (let t = 0; t < Math.PI * 2; t += 0.1) {
      const r = shape(t);
      expect(r).toBeGreaterThanOrEqual(0.67);
      expect(r).toBeLessThanOrEqual(0.93);
    }
  });
  it('is deterministic per seed and varies across seeds', () => {
    const a = islandShape(7), b = islandShape(7), c = islandShape(8);
    expect(a(1.2)).toBe(b(1.2));
    // Different seeds drive different harmonics → different boundary somewhere.
    const differs = [0, 1, 2, 3, 4, 5].some(t => a(t) !== c(t));
    expect(differs).toBe(true);
  });
});

describe('scatter2D', () => {
  it('places exactly n points inside the unit square', () => {
    const pts = scatter2D(20, Math.random, islandShape(1));
    expect(pts.length).toBe(20);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
  it('confines points within the island boundary (plus the shore margin)', () => {
    const shape = islandShape(3);
    const pts = scatter2D(30, Math.random, shape);
    for (const p of pts) {
      const nx = (p.x - 0.5) * 2, ny = (p.y - 0.5) * 2;
      const r = Math.hypot(nx, ny);
      const max = shape(Math.atan2(ny, nx)) * 0.90;
      expect(r).toBeLessThanOrEqual(max + 1e-6);
    }
  });
  it('keeps every pair apart (no two places collide)', () => {
    const pts = scatter2D(25, Math.random, islandShape(5));
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        minD = Math.min(minD, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    expect(minD).toBeGreaterThan(0);
  });
});

describe('mapDimensions', () => {
  it('grows the canvas with the place count, aspect 1.5', () => {
    const small = mapDimensions(10);
    const big = mapDimensions(200);
    expect(big.W).toBeGreaterThan(small.W);
    expect(big.H).toBeGreaterThan(small.H);
    expect(small.W / small.H).toBeCloseTo(1.5, 1);
  });
  it('never shrinks below the minimum canvas', () => {
    const tiny = mapDimensions(1);
    expect(tiny.W).toBeGreaterThanOrEqual(480);
    expect(tiny.H).toBeGreaterThanOrEqual(320);
  });
});

describe('d2', () => {
  it('is the squared euclidean distance', () => {
    expect(d2({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
    expect(d2({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });
});

describe('link', () => {
  function node(): MapNode {
    return { edges: [] } as unknown as MapNode;
  }
  it('adds an undirected edge between two nodes', () => {
    const nodes = { a: node(), b: node() };
    link(nodes, 'a', 'b');
    expect(nodes.a.edges).toContain('b');
    expect(nodes.b.edges).toContain('a');
  });
  it('is idempotent — relinking adds no duplicate', () => {
    const nodes = { a: node(), b: node() };
    link(nodes, 'a', 'b');
    link(nodes, 'a', 'b');
    expect(nodes.a.edges).toEqual(['b']);
    expect(nodes.b.edges).toEqual(['a']);
  });
  it('ignores self-links', () => {
    const nodes = { a: node() };
    link(nodes, 'a', 'a');
    expect(nodes.a.edges).toEqual([]);
  });
});

describe('insideIsland — land vs sea predicate', () => {
  const W = 400, H = 300, seed = 7;
  it('places the map centre on land and the far corners on sea', () => {
    expect(insideIsland(W / 2, H / 2, seed, W, H)).toBe(true);
    expect(insideIsland(0, 0, seed, W, H)).toBe(false);
    expect(insideIsland(W, H, seed, W, H)).toBe(false);
  });
  it('agrees with the island profile along an axis (inside the coast, outside past it)', () => {
    const profile = islandShape(seed);
    const cx = W / 2, rx = W * 0.5;
    const edge = profile(0);                 // half-extent fraction along +x
    // A point at 80% of the coast radius is land; at 120% it is sea.
    expect(insideIsland(cx + rx * edge * 0.8, H / 2, seed, W, H)).toBe(true);
    expect(insideIsland(cx + rx * edge * 1.2, H / 2, seed, W, H)).toBe(false);
  });
  it('returns false for a degenerate (zero-area) map', () => {
    expect(insideIsland(0, 0, seed, 0, 0)).toBe(false);
  });
});

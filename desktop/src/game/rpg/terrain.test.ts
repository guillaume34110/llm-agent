import { describe, it, expect } from 'vitest';
import { terrainAt, TERRAINS, NODE_TERRAIN, type Terrain } from './terrain';
import { hexesCovering, type Hex } from './hexmap';
import type { NodeKind } from './types';

const KINDS: NodeKind[] = ['village', 'town', 'forest', 'wild', 'camp', 'ruin', 'dungeon', 'cave'];

describe('terrain climate field', () => {
  it('is deterministic per (seed, hex)', () => {
    const h: Hex = { q: 3, r: -2 };
    expect(terrainAt(h, 42)).toBe(terrainAt(h, 42));
    expect(terrainAt(h, 42)).toBe(terrainAt({ q: 3, r: -2 }, 42));
  });

  it('always returns a known terrain', () => {
    for (let q = -8; q <= 8; q++)
      for (let r = -8; r <= 8; r++)
        expect(TERRAINS.includes(terrainAt({ q, r }, 7))).toBe(true);
  });

  it('a place override pins the tile to its matched ground', () => {
    const h: Hex = { q: 1, r: 1 };
    expect(terrainAt(h, 7, 'desert')).toBe('desert');
    expect(terrainAt(h, 7, 'snow')).toBe('snow');
  });

  it('varies across the map — at least 6 distinct terrains over a real grid', () => {
    const tiles = hexesCovering(640, 420, 28);
    const seen = new Set<Terrain>();
    for (const h of tiles) seen.add(terrainAt(h, 12345));
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('different seeds reshape the climate (board not identical)', () => {
    const tiles = hexesCovering(400, 300, 26);
    const a = tiles.map(h => terrainAt(h, 1)).join('');
    const b = tiles.map(h => terrainAt(h, 999)).join('');
    expect(a).not.toBe(b);
  });
});

describe('NODE_TERRAIN — every place kind sits on a real ground', () => {
  it('maps all eight node kinds to a known terrain', () => {
    for (const k of KINDS) {
      expect(NODE_TERRAIN[k]).toBeDefined();
      expect(TERRAINS.includes(NODE_TERRAIN[k])).toBe(true);
    }
  });
});

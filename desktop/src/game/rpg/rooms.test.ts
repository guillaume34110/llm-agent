import { describe, it, expect } from 'vitest';
import {
  ROOM_RANGE, ROOM_CAP, ROOM_NAME, ROOM_BLURB,
  roomCount, buildRooms, hasRoomsKind,
} from './rooms';
import type { MapSize, RoomKind } from './types';

// A deterministic rng handing back a fixed queue, then 0 forever.
function rngOf(...vals: number[]): () => number {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
}
const ALL_KINDS: RoomKind[] = ['combat', 'trap', 'treasure', 'puzzle', 'rest', 'boss'];

describe('room tables', () => {
  it('name + blurb tables cover every room kind', () => {
    for (const k of ALL_KINDS) {
      expect(ROOM_NAME[k].length).toBeGreaterThan(0);
      expect(typeof ROOM_BLURB[k]).toBe('string');
      expect(ROOM_BLURB[k].length).toBeGreaterThan(0);
    }
  });
  it('range bounds are ordered low ≤ high for each size', () => {
    (Object.keys(ROOM_RANGE) as MapSize[]).forEach(s => {
      const [lo, hi] = ROOM_RANGE[s];
      expect(lo).toBeLessThanOrEqual(hi);
    });
  });
});

describe('hasRoomsKind', () => {
  it('only the explorable sites hold a crawl', () => {
    expect(hasRoomsKind('dungeon')).toBe(true);
    expect(hasRoomsKind('cave')).toBe(true);
    expect(hasRoomsKind('ruin')).toBe(true);
    expect(hasRoomsKind('wild')).toBe(false);
    expect(hasRoomsKind('town')).toBe(false);
  });
});

describe('roomCount', () => {
  it('floors at 3 and caps at ROOM_CAP', () => {
    // small range is [3,5]; rng 0 → lo; a cave shaves one → 2 → floored to 3.
    expect(roomCount('cave', 1, 'small', rngOf(0))).toBe(3);
    // huge danger pushes well past the cap → clamped.
    expect(roomCount('dungeon', 99, 'large', rngOf(0.99))).toBe(ROOM_CAP);
  });
  it('deeper danger runs the crawl longer', () => {
    const base = roomCount('dungeon', 1, 'medium', rngOf(0));
    const deep = roomCount('dungeon', 4, 'medium', rngOf(0));
    expect(deep).toBeGreaterThan(base);
  });
});

describe('buildRooms', () => {
  it('opens on combat, ends on the boss, and guarantees a rest + treasure', () => {
    const rooms = buildRooms('dungeon', 3, 'large', rngOf(0.5));
    expect(rooms.length).toBeGreaterThanOrEqual(3);
    expect(rooms[0].kind).toBe('combat');
    expect(rooms[rooms.length - 1].kind).toBe('boss');
    expect(rooms.some(r => r.kind === 'rest')).toBe(true);
    expect(rooms.some(r => r.kind === 'treasure')).toBe(true);
  });
  it('every room is fresh, named, and uniquely id-d', () => {
    const rooms = buildRooms('ruin', 2, 'medium', rngOf(0.3));
    const ids = new Set(rooms.map(r => r.id));
    expect(ids.size).toBe(rooms.length);
    for (const r of rooms) {
      expect(r.cleared).toBe(false);
      expect(ROOM_NAME[r.kind]).toContain(r.name);
      expect(r.blurb).toBe(ROOM_BLURB[r.kind]);
    }
  });
  it('never exceeds the hard cap', () => {
    const rooms = buildRooms('dungeon', 50, 'large', rngOf(0.99));
    expect(rooms.length).toBeLessThanOrEqual(ROOM_CAP);
  });
});

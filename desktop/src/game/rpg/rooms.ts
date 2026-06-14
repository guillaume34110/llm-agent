import type { MapSize, RoomKind, NodeKind, DungeonRoom } from './types';
import { uid } from './ids';

// ── Dungeon rooms (the multi-screen crawl) ───────────────────────────────────
// Room count scales with the chosen world size, deepened a little by the node's
// danger, and HARD-CAPPED at 15 screens. The first room eases you in, the last
// is always the boss, and the middle guarantees a sanctuary (rest) and a cache
// (treasure) so every dungeon stays beatable and rewarding.
export const ROOM_RANGE: Record<MapSize, [number, number]> = {
  small: [3, 5],
  medium: [5, 9],
  large: [9, 13],
};
export const ROOM_CAP = 15;

export const ROOM_NAME: Record<RoomKind, string[]> = {
  combat: ['Guard Room', 'Warren', 'Bone Gallery', 'Collapsed Hall'],
  trap: ['Trapped Passage', 'Spiked Corridor', 'Pressure Gate', 'Snare Walk'],
  treasure: ['Treasure Cache', 'Hoard Vault', 'Forgotten Stash', 'Gilded Niche'],
  puzzle: ['Sealed Door', 'Rune Lock', 'Riddle Chamber', 'Warded Arch'],
  rest: ['Quiet Sanctuary', 'Still Spring', 'Old Shrine', 'Sheltered Alcove'],
  boss: ['Inner Sanctum', 'Throne of the Deep', 'Heart of the Ruin', 'Final Chamber'],
};
export const ROOM_BLURB: Record<RoomKind, string> = {
  combat: 'Shapes shift in the gloom — something guards this passage.',
  trap: 'The floor is scored with old mechanisms, primed and waiting.',
  treasure: 'A cache glints in the dark, half-buried and forgotten.',
  puzzle: 'A sealed mechanism bars the way; its logic must be read.',
  rest: 'A calm pocket of safety, untouched by the dungeon’s rot.',
  boss: 'The air turns cold. The master of this place is near.',
};

export function roomCount(kind: NodeKind, danger: number, size: MapSize, rng: () => number): number {
  const [lo, hi] = ROOM_RANGE[size];
  let n = lo + Math.floor(rng() * (hi - lo + 1));
  if (kind === 'cave') n -= 1;          // caves run a touch shorter
  n += Math.max(0, danger - 1);          // deadlier sites run deeper
  return Math.min(ROOM_CAP, Math.max(3, n));
}

export function buildRooms(kind: NodeKind, danger: number, size: MapSize, rng: () => number): DungeonRoom[] {
  const n = roomCount(kind, danger, size, rng);
  const kinds: RoomKind[] = new Array(n).fill('combat');
  kinds[0] = 'combat';
  kinds[n - 1] = 'boss';
  const bag: RoomKind[] = ['trap', 'treasure', 'puzzle', 'combat', 'rest'];
  for (let i = 1; i < n - 1; i++) kinds[i] = bag[Math.floor(rng() * bag.length)];
  // Guarantee one sanctuary + one cache in the middle so the crawl is survivable
  // and pays out. Place them on distinct middle slots when room enough.
  const mids: number[] = [];
  for (let i = 1; i < n - 1; i++) mids.push(i);
  const shuffle = (arr: number[]) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } };
  shuffle(mids);
  if (mids.length >= 1 && !kinds.includes('rest')) kinds[mids[0]] = 'rest';
  if (mids.length >= 2 && !kinds.slice(1, n - 1).includes('treasure')) kinds[mids[1]] = 'treasure';
  const pick = (k: RoomKind) => ROOM_NAME[k][Math.floor(rng() * ROOM_NAME[k].length)];
  return kinds.map((k, i) => ({
    id: uid('room'),
    kind: k,
    name: pick(k),
    blurb: ROOM_BLURB[k],
    cleared: false,
  }));
}

export function hasRoomsKind(kind: NodeKind): boolean {
  return kind === 'dungeon' || kind === 'cave' || kind === 'ruin';
}

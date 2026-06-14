// RTS « Iron Marsh » — lightweight grid pathfinding (A*). Pure: takes a passability
// test, returns tile-center waypoints. Land units treat water/rock as blocked;
// buildings are blocked too (passed in via `blocked`). Good enough for a few dozen
// units; capped node budget so a hopeless path fails fast instead of stalling.

export type Passable = (x: number, y: number) => boolean;

interface Node { x: number; y: number; g: number; f: number; parent: Node | null; }

const NEIGHBORS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function key(x: number, y: number): number { return y * 4096 + x; }
function heur(x: number, y: number, gx: number, gy: number): number {
  // octile distance (8-way movement)
  const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
  return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

// Find a path from (sx,sy) to (gx,gy) over integer tiles. Returns waypoints as
// tile centers (x+0.5) excluding the start, or null if unreachable within budget.
// If the goal tile itself is blocked, routes to the nearest passable neighbour.
export function findPath(
  sx: number, sy: number, gx: number, gy: number,
  passable: Passable, w: number, h: number, budget = 4000,
): Array<{ x: number; y: number }> | null {
  sx = Math.floor(sx); sy = Math.floor(sy);
  gx = Math.floor(gx); gy = Math.floor(gy);
  if (sx === gx && sy === gy) return [];
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;

  // If the goal is blocked, pick the closest passable neighbour as the real goal.
  if (!passable(gx, gy)) {
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (let r = 1; r <= 4 && !best; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (!inB(nx, ny) || !passable(nx, ny)) continue;
        const d = heur(nx, ny, gx, gy);
        if (d < bd) { bd = d; best = { x: nx, y: ny }; }
      }
    }
    if (!best) return null;
    gx = best.x; gy = best.y;
    if (sx === gx && sy === gy) return [];
  }

  const open: Node[] = [{ x: sx, y: sy, g: 0, f: heur(sx, sy, gx, gy), parent: null }];
  const seen = new Map<number, number>(); // key -> best g
  seen.set(key(sx, sy), 0);
  let budgetLeft = budget;

  while (open.length && budgetLeft-- > 0) {
    // pop lowest f (linear scan; grids here are small)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === gx && cur.y === gy) {
      const out: Array<{ x: number; y: number }> = [];
      let n: Node | null = cur;
      while (n && n.parent) { out.push({ x: n.x + 0.5, y: n.y + 0.5 }); n = n.parent; }
      out.reverse();
      return out;
    }
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!inB(nx, ny) || !passable(nx, ny)) continue;
      // no corner-cutting through blocked diagonals
      if (dx !== 0 && dy !== 0 && (!passable(cur.x + dx, cur.y) || !passable(cur.x, cur.y + dy))) continue;
      const step = (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1;
      const ng = cur.g + step;
      const k = key(nx, ny);
      const prev = seen.get(k);
      if (prev !== undefined && prev <= ng) continue;
      seen.set(k, ng);
      open.push({ x: nx, y: ny, g: ng, f: ng + heur(nx, ny, gx, gy), parent: cur });
    }
  }
  return null;
}

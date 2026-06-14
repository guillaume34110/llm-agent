// PICO-8-flavoured math, sandbox-safe. The cart calls these instead of `Math`
// (which is not exposed inside the worker scope). Angles are in turns (0..1),
// and sin is inverted, matching PICO-8 so ported snippets behave.

const TAU = Math.PI * 2;

export interface MathLib {
  flr(x: number): number;
  ceil(x: number): number;
  abs(x: number): number;
  min(a: number, b: number): number;
  max(a: number, b: number): number;
  mid(a: number, b: number, c: number): number;
  sqrt(x: number): number;
  sin(t: number): number;
  cos(t: number): number;
  atan2(dx: number, dy: number): number;
  sgn(x: number): number;
  rnd(x?: number): number;
  srand(seed: number): void;
}

/** Build a math library with its own seeded PRNG (mulberry32). */
export function makeMath(): MathLib {
  let s = (Date.now() ^ 0x9e3779b9) >>> 0;
  const next = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    flr: (x) => Math.floor(x),
    ceil: (x) => Math.ceil(x),
    abs: (x) => Math.abs(x),
    min: (a, b) => (a < b ? a : b),
    max: (a, b) => (a > b ? a : b),
    mid: (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)),
    sqrt: (x) => (x < 0 ? 0 : Math.sqrt(x)),
    sin: (t) => -Math.sin(t * TAU),
    cos: (t) => Math.cos(t * TAU),
    atan2: (dx, dy) => {
      const a = Math.atan2(-dy, dx) / TAU;
      return a < 0 ? a + 1 : a;
    },
    sgn: (x) => (x < 0 ? -1 : 1),
    rnd: (x = 1) => next() * x,
    srand: (seed) => {
      s = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
    },
  };
}

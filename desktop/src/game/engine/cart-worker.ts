// Sandboxed cart runtime (Web Worker). Untrusted cart code runs here, never in
// the app renderer. The worker shadows dangerous globals and rejects obvious
// escape identifiers before running (FEASIBILITY.md §4, option 1). It owns the
// framebuffer and posts a copy back each tick; the main thread only blits.

import { makeGfxState, makeGfx } from './gfx';
import { makeMath } from './mathlib';
import type { WorkerIn } from './types';

let held = 0; // button bitfield this tick
let pressed = 0; // edge-pressed bitfield this tick
let game: { _init: any; _update: any; _update60: any; _draw: any } | null = null;
let broken = false;

// Identifiers that have no place in a tiny game cart and signal an escape attempt.
const BLOCK = /\b(?:import|eval|Function|globalThis|self|window|document|fetch|XMLHttpRequest|importScripts|WebSocket|require|process|module|constructor|__proto__|localStorage|sessionStorage|indexedDB|navigator|location|postMessage|Worker)\b/;

// Globals shadowed to undefined inside the cart scope. NOTE: 'eval' (and
// 'arguments') must NOT appear here — a formal parameter named `eval` is a
// SyntaxError under the body's "use strict", which would fail every cart build.
// `eval` is already rejected by BLOCK, so shadowing it as a param is redundant.
const SHADOW = [
  'self', 'globalThis', 'window', 'document', 'fetch', 'XMLHttpRequest', 'importScripts',
  'WebSocket', 'Function', 'require', 'process', 'module', 'exports', 'postMessage',
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'Worker',
  'SharedWorker', 'indexedDB', 'localStorage', 'sessionStorage', 'location', 'navigator',
  'requestAnimationFrame', 'caches', 'crypto', 'Atomics', 'SharedArrayBuffer',
];

function err(message: string) {
  broken = true;
  (self as any).postMessage({ type: 'error', message });
}

function build(code: string, sheet: Uint8Array, flags: Uint8Array, map: Uint8Array) {
  if (BLOCK.test(code)) {
    err('cart rejected: forbidden identifier (no host/network/global access allowed)');
    return;
  }
  const st = makeGfxState(sheet, flags, map);
  const gfx = makeGfx(st);
  const m = makeMath();
  const api: Record<string, any> = {
    ...gfx,
    btn: (i: number) => (held & (1 << (i | 0))) !== 0,
    btnp: (i: number) => (pressed & (1 << (i | 0))) !== 0,
    sfx: () => {}, // audio deferred (v1 no-op)
    music: () => {},
    flr: m.flr, ceil: m.ceil, abs: m.abs, min: m.min, max: m.max, mid: m.mid,
    sqrt: m.sqrt, sin: m.sin, cos: m.cos, atan2: m.atan2, sgn: m.sgn, rnd: m.rnd, srand: m.srand,
  };
  const names = Object.keys(api);
  const body =
    '"use strict";\n' + code +
    '\nreturn {' +
    '_init: typeof _init!=="undefined"?_init:null,' +
    '_update: typeof _update!=="undefined"?_update:null,' +
    '_update60: typeof _update60!=="undefined"?_update60:null,' +
    '_draw: typeof _draw!=="undefined"?_draw:null};';
  let factory: Function;
  try {
    // eslint-disable-next-line no-new-func
    factory = new Function(...names, ...SHADOW, body);
  } catch (e: any) {
    err('cart syntax error: ' + (e?.message || e));
    return;
  }
  try {
    game = factory(...names.map((n) => api[n]), ...SHADOW.map(() => undefined));
  } catch (e: any) {
    err('cart init error: ' + (e?.message || e));
    return;
  }
  // expose the live framebuffer for posting
  (build as any)._px = st.px;
  if (game?._init) {
    try { game._init(); } catch (e: any) { err('cart _init error: ' + (e?.message || e)); return; }
  }
  // first frame
  draw();
}

function draw() {
  const px: Uint8Array | undefined = (build as any)._px;
  if (!px) return;
  // post a copy so the worker keeps its buffer
  (self as any).postMessage({ type: 'frame', px: px.slice() }, []);
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    broken = false; game = null;
    build(msg.code, msg.sheet, msg.flags, msg.map);
    return;
  }
  if (msg.type === 'tick') {
    if (broken || !game) return;
    held = msg.btn; // absolute held bitfield
    pressed = msg.btnp; // edge-pressed bitfield, computed on the main thread
    try {
      const upd = game._update60 || game._update;
      if (upd) upd();
      if (game._draw) game._draw();
    } catch (e: any) {
      err('cart runtime error: ' + (e?.message || e));
      return;
    }
    draw();
  }
};

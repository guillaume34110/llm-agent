// The draw API — pure functions over an indexed-colour framebuffer. No DOM, no
// canvas: just byte writes into px[]. Safe to run inside a Web Worker. This is
// the whitelist of graphics calls a cart may make (see ENGINE-CONTEXT.md §3).

import { SCREEN, SHEET, SPR_PX, SPR_PER_ROW, MAP_W, MAP_H, FB_LEN } from './types';
import { glyphRows, GLYPH_W, CHAR_ADVANCE, LINE_ADVANCE } from './font';

export interface GfxState {
  px: Uint8Array; // FB_LEN framebuffer (palette indices)
  sheet: Uint8Array; // SHEET*SHEET
  flags: Uint8Array; // SPRITE_COUNT
  map: Uint8Array; // MAP_W*MAP_H
  camx: number;
  camy: number;
  pal: Uint8Array; // 16-entry draw remap
  transparent: boolean[]; // per-colour transparency for spr/map (idx 0 default true)
}

export interface GfxApi {
  cls(col?: number): void;
  pset(x: number, y: number, col?: number): void;
  pget(x: number, y: number): number;
  line(x0: number, y0: number, x1: number, y1: number, col?: number): void;
  rect(x0: number, y0: number, x1: number, y1: number, col?: number): void;
  rectfill(x0: number, y0: number, x1: number, y1: number, col?: number): void;
  circ(x: number, y: number, r: number, col?: number): void;
  circfill(x: number, y: number, r: number, col?: number): void;
  spr(n: number, x: number, y: number, flipx?: boolean, flipy?: boolean): void;
  sspr(sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw?: number, dh?: number): void;
  map(cx: number, cy: number, sx: number, sy: number, cw: number, ch: number): void;
  mget(cx: number, cy: number): number;
  mset(cx: number, cy: number, n: number): void;
  print(s: any, x: number, y: number, col?: number): void;
  palt(col?: number, t?: boolean): void;
  pal(from?: number, to?: number): void;
  camera(x?: number, y?: number): void;
  fget(n: number, f?: number): number | boolean;
  fset(n: number, f: number, v?: boolean): void;
}

export function makeGfxState(sheet: Uint8Array, flags: Uint8Array, map: Uint8Array): GfxState {
  const transparent = new Array(16).fill(false);
  transparent[0] = true;
  return {
    px: new Uint8Array(FB_LEN),
    sheet,
    flags,
    map,
    camx: 0,
    camy: 0,
    pal: Uint8Array.from({ length: 16 }, (_, i) => i),
    transparent,
  };
}

const c16 = (c: number | undefined, d = 0) => (c == null ? d : ((Math.floor(c) % 16) + 16) % 16);

export function makeGfx(st: GfxState): GfxApi {
  const W = SCREEN;
  // Raw pixel plot in screen space (already camera-resolved), with palette remap.
  const plot = (sx: number, sy: number, col: number) => {
    if (sx < 0 || sy < 0 || sx >= W || sy >= W) return;
    st.px[sy * W + sx] = st.pal[col];
  };
  const put = (x: number, y: number, col: number) => plot((x - st.camx) | 0, (y - st.camy) | 0, col);

  const cls: GfxApi['cls'] = (col = 0) => st.px.fill(st.pal[c16(col)]);

  const pset: GfxApi['pset'] = (x, y, col) => put(x | 0, y | 0, c16(col, 6));
  const pget: GfxApi['pget'] = (x, y) => {
    const sx = (x - st.camx) | 0, sy = (y - st.camy) | 0;
    if (sx < 0 || sy < 0 || sx >= W || sy >= W) return 0;
    return st.px[sy * W + sx];
  };

  const line: GfxApi['line'] = (x0, y0, x1, y1, col) => {
    const c = c16(col, 6);
    let ax = x0 | 0, ay = y0 | 0;
    const bx = x1 | 0, by = y1 | 0;
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      put(ax, ay, c);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; ax += sx; }
      if (e2 <= dx) { err += dx; ay += sy; }
    }
  };

  const rectfill: GfxApi['rectfill'] = (x0, y0, x1, y1, col) => {
    const c = c16(col, 6);
    let lo = Math.min(x0, x1) | 0, hi = Math.max(x0, x1) | 0;
    let loy = Math.min(y0, y1) | 0, hiy = Math.max(y0, y1) | 0;
    for (let y = loy; y <= hiy; y++) for (let x = lo; x <= hi; x++) put(x, y, c);
  };

  const rect: GfxApi['rect'] = (x0, y0, x1, y1, col) => {
    const c = c16(col, 6);
    const lo = Math.min(x0, x1) | 0, hi = Math.max(x0, x1) | 0;
    const loy = Math.min(y0, y1) | 0, hiy = Math.max(y0, y1) | 0;
    for (let x = lo; x <= hi; x++) { put(x, loy, c); put(x, hiy, c); }
    for (let y = loy; y <= hiy; y++) { put(lo, y, c); put(hi, y, c); }
  };

  const circ: GfxApi['circ'] = (xc, yc, r, col) => {
    const c = c16(col, 6);
    xc |= 0; yc |= 0; r = Math.max(0, r | 0);
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]] as const) put(xc + px, yc + py, c);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  };

  const circfill: GfxApi['circfill'] = (xc, yc, r, col) => {
    const c = c16(col, 6);
    xc |= 0; yc |= 0; r = Math.max(0, r | 0);
    for (let dy = -r; dy <= r; dy++) {
      const dx = Math.floor(Math.sqrt(r * r - dy * dy));
      for (let x = xc - dx; x <= xc + dx; x++) put(x, yc + dy, c);
    }
  };

  const spr: GfxApi['spr'] = (n, x, y, flipx = false, flipy = false) => {
    n = n | 0;
    if (n < 0 || n > 255) return;
    const ssx = (n % SPR_PER_ROW) * SPR_PX;
    const ssy = ((n / SPR_PER_ROW) | 0) * SPR_PX;
    for (let r = 0; r < SPR_PX; r++) {
      for (let cc = 0; cc < SPR_PX; cc++) {
        const col = st.sheet[(ssy + r) * SHEET + (ssx + cc)];
        if (st.transparent[col]) continue;
        const ox = flipx ? SPR_PX - 1 - cc : cc;
        const oy = flipy ? SPR_PX - 1 - r : r;
        put((x | 0) + ox, (y | 0) + oy, col); // put() applies the palette remap
      }
    }
  };

  const sspr: GfxApi['sspr'] = (sx, sy, sw, sh, dx, dy, dw = sw, dh = sh) => {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    for (let j = 0; j < dh; j++) {
      const syy = sy + Math.floor((j * sh) / dh);
      for (let i = 0; i < dw; i++) {
        const sxx = sx + Math.floor((i * sw) / dw);
        if (sxx < 0 || syy < 0 || sxx >= SHEET || syy >= SHEET) continue;
        const col = st.sheet[syy * SHEET + sxx];
        if (st.transparent[col]) continue;
        put((dx | 0) + i, (dy | 0) + j, col);
      }
    }
  };

  const map: GfxApi['map'] = (cx, cy, sx, sy, cw, ch) => {
    cx |= 0; cy |= 0; sx |= 0; sy |= 0; cw |= 0; ch |= 0;
    for (let j = 0; j < ch; j++) {
      for (let i = 0; i < cw; i++) {
        const mx = cx + i, my = cy + j;
        if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) continue;
        const n = st.map[my * MAP_W + mx];
        if (n === 0) continue; // tile 0 = empty
        spr(n, sx + i * SPR_PX, sy + j * SPR_PX);
      }
    }
  };

  const mget: GfxApi['mget'] = (cx, cy) => {
    cx |= 0; cy |= 0;
    if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) return 0;
    return st.map[cy * MAP_W + cx];
  };
  const mset: GfxApi['mset'] = (cx, cy, n) => {
    cx |= 0; cy |= 0;
    if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) return;
    st.map[cy * MAP_W + cx] = ((n | 0) % 256 + 256) % 256;
  };

  const print: GfxApi['print'] = (s, x, y, col) => {
    const c = c16(col, 6);
    const str = String(s == null ? '' : s);
    let cx = x | 0;
    let cy = y | 0;
    for (const ch of str) {
      if (ch === '\n') { cx = x | 0; cy += LINE_ADVANCE; continue; }
      const rows = glyphRows(ch);
      for (let r = 0; r < rows.length; r++) {
        const bits = rows[r];
        for (let b = 0; b < GLYPH_W; b++) {
          if (bits & (1 << (GLYPH_W - 1 - b))) put(cx + b, cy + r, c);
        }
      }
      cx += CHAR_ADVANCE;
    }
  };

  const palt: GfxApi['palt'] = (col, t) => {
    if (col == null) { st.transparent.fill(false); st.transparent[0] = true; return; }
    st.transparent[c16(col)] = t == null ? true : !!t;
  };

  const pal: GfxApi['pal'] = (from, to) => {
    if (from == null) { for (let i = 0; i < 16; i++) st.pal[i] = i; return; }
    st.pal[c16(from)] = c16(to);
  };

  const camera: GfxApi['camera'] = (x = 0, y = 0) => { st.camx = x | 0; st.camy = y | 0; };

  const fget: GfxApi['fget'] = (n, f) => {
    const v = st.flags[(n | 0) & 255] || 0;
    return f == null ? v : (v & (1 << (f | 0))) !== 0;
  };
  const fset: GfxApi['fset'] = (n, f, v) => {
    n = (n | 0) & 255;
    if (v == null) { st.flags[n] = f | 0; return; }
    if (v) st.flags[n] |= 1 << (f | 0); else st.flags[n] &= ~(1 << (f | 0));
  };

  return { cls, pset, pget, line, rect, rectfill, circ, circfill, spr, sspr, map, mget, mset, print, palt, pal, camera, fget, fset };
}

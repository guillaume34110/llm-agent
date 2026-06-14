// Local-first cart persistence. Everything lives in localStorage; the server
// never sees a cart (mirrors rpg/state.ts loadWorlds/saveWorld). Uint8Array
// blobs are base64-encoded on disk.

import { SHEET_LEN, MAP_LEN, SPRITE_COUNT, DEFAULT_CODE, emptyCart } from './types';
import type { Cart } from './types';

const KEY = 'monkey.carts';

export interface CartDisk {
  id: string; name: string; code: string;
  sheet: string; flags: string; map: string;
  thumb?: string; createdAt: number; updatedAt: number;
}

function b64encode(u: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + CH)));
  return btoa(s);
}

function b64decode(s: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  try {
    const bin = atob(s || '');
    for (let i = 0; i < Math.min(len, bin.length); i++) out[i] = bin.charCodeAt(i);
  } catch { /* leave zeroed */ }
  return out;
}

export function toDisk(c: Cart): CartDisk {
  return {
    id: c.id, name: c.name, code: c.code,
    sheet: b64encode(c.sheet), flags: b64encode(c.flags), map: b64encode(c.map),
    thumb: c.thumb, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

export function fromDisk(d: CartDisk): Cart {
  return {
    id: d.id, name: d.name, code: d.code ?? DEFAULT_CODE,
    sheet: b64decode(d.sheet, SHEET_LEN),
    flags: b64decode(d.flags, SPRITE_COUNT),
    map: b64decode(d.map, MAP_LEN),
    thumb: d.thumb, createdAt: d.createdAt || Date.now(), updatedAt: d.updatedAt || Date.now(),
  };
}

export function loadCarts(): Cart[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CartDisk[];
    if (!Array.isArray(arr)) return [];
    return arr.map(fromDisk).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

function persist(carts: Cart[]) {
  try { localStorage.setItem(KEY, JSON.stringify(carts.map(toDisk))); } catch { /* quota */ }
}

export function getCart(id: string): Cart | null {
  return loadCarts().find((c) => c.id === id) || null;
}

export function saveCart(cart: Cart): Cart {
  cart.updatedAt = Date.now();
  const carts = loadCarts();
  const i = carts.findIndex((c) => c.id === cart.id);
  if (i >= 0) carts[i] = cart; else carts.push(cart);
  persist(carts);
  return cart;
}

export function deleteCart(id: string) {
  persist(loadCarts().filter((c) => c.id !== id));
}

export function duplicateCart(id: string): Cart | null {
  const src = getCart(id);
  if (!src) return null;
  const copy = emptyCart(`${src.name} copy`);
  copy.code = src.code;
  copy.sheet = src.sheet.slice();
  copy.flags = src.flags.slice();
  copy.map = src.map.slice();
  return saveCart(copy);
}

export function createCart(name?: string): Cart {
  return saveCart(emptyCart(name));
}

/** Resolve a spoken cart name to an id ("play my platformer"). Case/space-insensitive. */
export function resolveCartByName(name: string): Cart | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const carts = loadCarts();
  return (
    carts.find((c) => c.name.toLowerCase() === q) ||
    carts.find((c) => c.name.toLowerCase().includes(q)) ||
    null
  );
}

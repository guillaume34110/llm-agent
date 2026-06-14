// Local-first save history ("github-like" save log) per cart. Every save pushes
// a full snapshot + a diff vs the previous one onto a single linear branch; the
// user can roll back to any point. No push, no remote — everything lives in
// localStorage like the carts themselves (server never sees a cart). Snapshots
// are full so rollback is trivial and lossless; history is capped per cart.

import { SHEET, SPR_PX, SPR_PER_ROW } from './types';
import type { Cart } from './types';
import { toDisk, fromDisk } from './storage';
import type { CartDisk } from './storage';

const PREFIX = 'monkey.history.';
const MAX = 40; // cap snapshots per cart (newest kept)

export interface CartDiff {
  codeAdded: number;
  codeRemoved: number;
  spritesChanged: number;
  flagsChanged: number;
  mapCellsChanged: number;
  hunks: string; // small unified-ish code diff for display (capped)
}

export interface HistoryEntry {
  id: string;
  ts: number;
  message: string; // LLM-authored (or auto) summary of the change
  diff: CartDiff;
  snapshot: CartDisk; // full cart state, restorable as-is
}

const rid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function key(cartId: string) { return PREFIX + cartId; }

function loadDisk(cartId: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(key(cartId));
    if (!raw) return [];
    const arr = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function persistDisk(cartId: string, list: HistoryEntry[]) {
  try { localStorage.setItem(key(cartId), JSON.stringify(list)); } catch { /* quota */ }
}

/** Newest first. */
export function loadHistory(cartId: string): HistoryEntry[] {
  return loadDisk(cartId);
}

export function clearHistory(cartId: string) {
  try { localStorage.removeItem(key(cartId)); } catch { /* ignore */ }
}

// ── diff ─────────────────────────────────────────────────────────────────────

function lineDiff(a: string, b: string): { added: number; removed: number; hunks: string } {
  const al = a.split('\n');
  const bl = b.split('\n');
  const n = al.length, m = bl.length;
  // Guard against pathological sizes (LCS is O(n*m)); fall back to a coarse count.
  if (n > 1500 || m > 1500) {
    const setA = new Set(al);
    const setB = new Set(bl);
    let added = 0, removed = 0;
    for (const l of bl) if (!setA.has(l)) added++;
    for (const l of al) if (!setB.has(l)) removed++;
    return { added, removed, hunks: '' };
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0, j = 0, added = 0, removed = 0;
  const lines: string[] = [];
  const push = (s: string) => { if (lines.length < 60) lines.push(s); };
  while (i < n && j < m) {
    if (al[i] === bl[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { removed++; push('- ' + al[i]); i++; }
    else { added++; push('+ ' + bl[j]); j++; }
  }
  while (i < n) { removed++; push('- ' + al[i]); i++; }
  while (j < m) { added++; push('+ ' + bl[j]); j++; }
  return { added, removed, hunks: lines.join('\n') };
}

function spritesChanged(a: Uint8Array, b: Uint8Array): number {
  const touched = new Uint8Array((SPR_PER_ROW * SPR_PER_ROW) || 256);
  const len = Math.min(a.length, b.length);
  for (let idx = 0; idx < len; idx++) {
    if (a[idx] === b[idx]) continue;
    const x = idx % SHEET, y = (idx / SHEET) | 0;
    const spr = ((y / SPR_PX) | 0) * SPR_PER_ROW + ((x / SPR_PX) | 0);
    if (spr < touched.length) touched[spr] = 1;
  }
  let c = 0;
  for (let s = 0; s < touched.length; s++) if (touched[s]) c++;
  return c;
}

function byteChanges(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  let c = 0;
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) c++;
  return c;
}

export function diffCarts(prev: Cart | null, next: Cart): CartDiff {
  if (!prev) {
    // Treat first commit as "everything new" relative to an empty cart.
    const code = lineDiff('', next.code);
    let nonEmptySprites = 0;
    {
      const touched = new Uint8Array(SPR_PER_ROW * SPR_PER_ROW || 256);
      for (let idx = 0; idx < next.sheet.length; idx++) {
        if (!next.sheet[idx]) continue;
        const x = idx % SHEET, y = (idx / SHEET) | 0;
        const spr = ((y / SPR_PX) | 0) * SPR_PER_ROW + ((x / SPR_PX) | 0);
        if (spr < touched.length) touched[spr] = 1;
      }
      for (let s = 0; s < touched.length; s++) if (touched[s]) nonEmptySprites++;
    }
    let mapCells = 0;
    for (let i = 0; i < next.map.length; i++) if (next.map[i]) mapCells++;
    let flags = 0;
    for (let i = 0; i < next.flags.length; i++) if (next.flags[i]) flags++;
    return {
      codeAdded: code.added, codeRemoved: code.removed,
      spritesChanged: nonEmptySprites, flagsChanged: flags, mapCellsChanged: mapCells,
      hunks: code.hunks,
    };
  }
  const code = lineDiff(prev.code, next.code);
  return {
    codeAdded: code.added,
    codeRemoved: code.removed,
    spritesChanged: spritesChanged(prev.sheet, next.sheet),
    flagsChanged: byteChanges(prev.flags, next.flags),
    mapCellsChanged: byteChanges(prev.map, next.map),
    hunks: code.hunks,
  };
}

export function isEmptyDiff(d: CartDiff): boolean {
  return d.codeAdded === 0 && d.codeRemoved === 0 && d.spritesChanged === 0
    && d.flagsChanged === 0 && d.mapCellsChanged === 0;
}

/** Compact human label used as a fallback when the LLM name isn't available. */
export function autoMessage(d: CartDiff, first: boolean): string {
  if (first) return 'creation du jeu';
  const parts: string[] = [];
  if (d.codeAdded || d.codeRemoved) parts.push(`code +${d.codeAdded} -${d.codeRemoved}`);
  if (d.spritesChanged) parts.push(`${d.spritesChanged} sprite${d.spritesChanged > 1 ? 's' : ''}`);
  if (d.mapCellsChanged) parts.push(`${d.mapCellsChanged} case${d.mapCellsChanged > 1 ? 's' : ''} map`);
  if (d.flagsChanged) parts.push(`${d.flagsChanged} flag${d.flagsChanged > 1 ? 's' : ''}`);
  return parts.length ? parts.join(' · ') : 'petite retouche';
}

// ── record / rollback ─────────────────────────────────────────────────────────

/**
 * Append a snapshot of `cart` to its history if it differs from the last one.
 * Returns the new entry, or null when nothing changed (no empty commits).
 */
export function recordSnapshot(cart: Cart, message?: string): HistoryEntry | null {
  const list = loadDisk(cart.id);
  const prev = list.length ? fromDisk(list[0].snapshot) : null;
  const diff = diffCarts(prev, cart);
  if (prev && isEmptyDiff(diff)) return null;
  const entry: HistoryEntry = {
    id: rid(),
    ts: Date.now(),
    message: message ?? autoMessage(diff, !prev),
    diff,
    snapshot: toDisk(cart),
  };
  list.unshift(entry);
  if (list.length > MAX) list.length = MAX;
  persistDisk(cart.id, list);
  return entry;
}

/** Patch an entry's message (used after the async LLM name resolves). */
export function setEntryMessage(cartId: string, entryId: string, message: string) {
  const list = loadDisk(cartId);
  const e = list.find((x) => x.id === entryId);
  if (!e) return;
  e.message = message;
  persistDisk(cartId, list);
}

/**
 * Restore an old snapshot. Single branch: rolling back writes the restored state
 * as a NEW commit on top (history stays linear, nothing is lost). Returns the
 * restored cart (already saved), or null if the entry is gone.
 */
export function rollbackTo(cartId: string, entryId: string, saveCart: (c: Cart) => Cart): Cart | null {
  const list = loadDisk(cartId);
  const e = list.find((x) => x.id === entryId);
  if (!e) return null;
  const restored = fromDisk(e.snapshot);
  restored.id = cartId;
  restored.updatedAt = Date.now();
  saveCart(restored);
  const short = e.message.length > 40 ? e.message.slice(0, 39) + '…' : e.message;
  recordSnapshot(restored, `retour a « ${short} »`);
  return restored;
}

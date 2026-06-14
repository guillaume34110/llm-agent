import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRapport, clearRapport, rapportBonus, recordRapport,
  RAPPORT_CAP, RAPPORT_STEP,
} from './rapport';
import { peopleOf } from './peoples';
import type { RpgState, MapNode } from './types';

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
  return store;
}

function node(rep: number | undefined): MapNode {
  return {
    id: 'n' + Math.random(), name: 'N', edges: [], discovered: false, cleared: false,
    ...(rep === undefined ? {} : { reputation: rep }),
  } as unknown as MapNode;
}

// A state whose settlements span [lo, hi] in reputation — the spread is the
// goodwill earned this run.
function state(seed: number, reps: (number | undefined)[]): RpgState {
  const nodes: Record<string, MapNode> = {};
  reps.forEach((r, i) => { const n = node(r); nodes['n' + i] = n; });
  return { seed, ngPlus: 0, nodes } as unknown as RpgState;
}

let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });

describe('loadRapport', () => {
  it('is empty by default', () => {
    expect(loadRapport()).toEqual({});
  });

  it('returns empty on corrupt storage', () => {
    store.set('monkey.rpg.rapport', '{garbage');
    expect(loadRapport()).toEqual({});
  });

  it('coerces and clamps stored values into [0, cap]', () => {
    store.set('monkey.rpg.rapport', JSON.stringify({ a: 99, b: -5, c: 3.9, d: 'x' }));
    const r = loadRapport();
    expect(r.a).toBe(RAPPORT_CAP);
    expect(r.b).toBe(0);
    expect(r.c).toBe(3);   // floored
    expect(r.d).toBeUndefined(); // non-numeric dropped
  });

  it('clearRapport wipes it', () => {
    store.set('monkey.rpg.rapport', JSON.stringify({ a: 4 }));
    clearRapport();
    expect(loadRapport()).toEqual({});
  });
});

describe('rapportBonus', () => {
  it('is zero for a people never met', () => {
    expect(rapportBonus('nobody')).toBe(0);
  });

  it('reads back a stored floor, clamped to the cap', () => {
    store.set('monkey.rpg.rapport', JSON.stringify({ rivers: 5, coast: 999 }));
    expect(rapportBonus('rivers')).toBe(5);
    expect(rapportBonus('coast')).toBe(RAPPORT_CAP);
  });
});

describe('recordRapport', () => {
  it('banks goodwill from the settlement-rep spread (max - min)/step', () => {
    const seed = 1234;
    const pid = peopleOf(seed).id;
    // spread of 18 over settlements → floor(18 / step) points
    recordRapport(state(seed, [4, 22, undefined, 10]));
    expect(rapportBonus(pid)).toBe(Math.floor(18 / RAPPORT_STEP));
  });

  it('is monotone-max: a weaker later run never lowers the floor', () => {
    const seed = 77;
    const pid = peopleOf(seed).id;
    recordRapport(state(seed, [0, RAPPORT_STEP * 4])); // strong: 4 points
    const high = rapportBonus(pid);
    recordRapport(state(seed, [3, 3 + RAPPORT_STEP])); // weak: 1 point
    expect(rapportBonus(pid)).toBe(high);
  });

  it('is idempotent: re-recording the same state does not stack', () => {
    const s = state(55, [2, 2 + RAPPORT_STEP * 3]);
    recordRapport(s);
    const once = rapportBonus(peopleOf(55).id);
    recordRapport(s);
    recordRapport(s);
    expect(rapportBonus(peopleOf(55).id)).toBe(once);
  });

  it('caps the banked floor at RAPPORT_CAP however great the run', () => {
    const seed = 9;
    recordRapport(state(seed, [0, RAPPORT_STEP * (RAPPORT_CAP + 20)]));
    expect(rapportBonus(peopleOf(seed).id)).toBe(RAPPORT_CAP);
  });

  it('a run with no settlements banks nothing', () => {
    const seed = 3;
    recordRapport(state(seed, [undefined, undefined]));
    expect(rapportBonus(peopleOf(seed).id)).toBe(0);
  });

  it('an all-equal welcome (no spread) earns no rapport', () => {
    const seed = 8;
    recordRapport(state(seed, [10, 10, 10]));
    expect(rapportBonus(peopleOf(seed).id)).toBe(0);
  });

  it('keys rapport by people, so different peoples bank independently', () => {
    // find two seeds whose peoples differ
    let sA = 1, sB = 2;
    while (peopleOf(sA).id === peopleOf(sB).id) sB++;
    recordRapport(state(sA, [0, RAPPORT_STEP * 2]));
    expect(rapportBonus(peopleOf(sA).id)).toBe(2);
    expect(rapportBonus(peopleOf(sB).id)).toBe(0);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { computeFame, loadLogbook, saveLogbook, recordRun, clearLogbook } from './logbook';
import type { Character, RpgState, MapNode } from './types';

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

function ch(partial: Partial<Character>): Character {
  return {
    id: 'c' + Math.random(), name: 'C', className: 'Knight', blurb: '', isHero: false,
    level: 1, xp: 0, hp: 20, maxHp: 20, alive: true,
    stats: { might: 2, agility: 2, wits: 2, spirit: 2 },
    ...partial,
  } as Character;
}

function node(partial: Partial<MapNode>): MapNode {
  return { id: 'n' + Math.random(), name: 'N', edges: [], discovered: false, cleared: false, ...partial } as MapNode;
}

function state(partial: Partial<RpgState>): RpgState {
  return {
    seed: 1, ngPlus: 0, gold: 0, title: 'The Run', theme: 'jungle',
    party: [ch({})], nodes: {}, inventory: [], rivals: [],
    quest: { title: 'Slay the Beast' },
    ...partial,
  } as unknown as RpgState;
}

let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });

describe('computeFame', () => {
  it('awards the victory base and never goes negative', () => {
    const { fame, highlights } = computeFame(state({}), 'victory');
    expect(fame).toBeGreaterThanOrEqual(100);
    expect(highlights.some(h => h.includes('Slay the Beast'))).toBe(true);
  });

  it('a defeat earns less than a victory but stays >= 0', () => {
    const win = computeFame(state({}), 'victory').fame;
    const loss = computeFame(state({}), 'defeat').fame;
    expect(loss).toBeLessThan(win);
    expect(loss).toBeGreaterThanOrEqual(0);
  });

  it('rewards cleared sites, hero levels and NG+', () => {
    const s = state({
      nodes: { a: node({ cleared: true, discovered: true }), b: node({ discovered: true }) },
      party: [ch({ level: 5 })], ngPlus: 2,
    });
    const base = computeFame(state({}), 'victory').fame;
    expect(computeFame(s, 'victory').fame).toBeGreaterThan(base);
  });

  it('full party home adds the flawless bonus', () => {
    const full = state({ party: [ch({}), ch({}), ch({})] });
    const partial = state({ party: [ch({}), ch({}), ch({ alive: false })] });
    expect(computeFame(full, 'victory').fame).toBeGreaterThan(computeFame(partial, 'victory').fame);
  });

  it('no featured category leaves the haul fame unchanged (non-regression)', () => {
    const inv = [{ id: 'v', kind: 'valuable', name: 'Idol', value: 80, trade: 'gems' }];
    const s = state({ inventory: inv as unknown as RpgState['inventory'] });
    // featured undefined → exactly the face-value haul path
    expect(computeFame(s, 'victory').fame).toBe(computeFame(s, 'victory', undefined).fame);
  });

  it('the featured exhibit lifts fame for a matching valuable banked home', () => {
    const inv = [{ id: 'v', kind: 'valuable', name: 'Idol', value: 80, trade: 'gems' }];
    const s = state({ inventory: inv as unknown as RpgState['inventory'] });
    const plain = computeFame(s, 'victory').fame;
    const featured = computeFame(s, 'victory', 'gems').fame;
    expect(featured).toBeGreaterThan(plain);
    expect(computeFame(s, 'victory', 'gems').highlights.some(h => h.includes('featured'))).toBe(true);
  });

  it('a non-matching valuable earns no featured premium', () => {
    const inv = [{ id: 'v', kind: 'valuable', name: 'Idol', value: 80, trade: 'gems' }];
    const s = state({ inventory: inv as unknown as RpgState['inventory'] });
    expect(computeFame(s, 'victory', 'furs').fame).toBe(computeFame(s, 'victory').fame);
  });

  it('a wiped band carries nothing home, so the featured premium is moot', () => {
    const inv = [{ id: 'v', kind: 'valuable', name: 'Idol', value: 80, trade: 'gems' }];
    const dead = state({ party: [ch({ alive: false })], inventory: inv as unknown as RpgState['inventory'] });
    expect(computeFame(dead, 'defeat', 'gems').fame).toBe(computeFame(dead, 'defeat').fame);
  });
});

describe('logbook persistence', () => {
  it('loadLogbook is empty by default', () => {
    expect(loadLogbook()).toEqual({ fame: 0, entries: [] });
  });

  it('returns the empty book on corrupt storage', () => {
    store.set('monkey.rpg.logbook', '{garbage');
    expect(loadLogbook()).toEqual({ fame: 0, entries: [] });
  });

  it('saveLogbook round-trips', () => {
    saveLogbook({ fame: 77, entries: [] });
    expect(loadLogbook().fame).toBe(77);
  });

  it('clearLogbook wipes it', () => {
    saveLogbook({ fame: 5, entries: [] });
    clearLogbook();
    expect(loadLogbook()).toEqual({ fame: 0, entries: [] });
  });
});

describe('recordRun', () => {
  it('banks a run and accumulates fame', () => {
    const book = recordRun(state({ seed: 1 }), 'victory');
    expect(book.entries.length).toBe(1);
    expect(book.fame).toBeGreaterThan(0);
    expect(book.entries[0].outcome).toBe('victory');
  });

  it('is idempotent for the same run (no double-bank)', () => {
    const s = state({ seed: 42, ngPlus: 0 });
    const first = recordRun(s, 'victory');
    const second = recordRun(s, 'victory');
    expect(second.fame).toBe(first.fame);
    expect(second.entries.length).toBe(1);
  });

  it('distinguishes runs by seed/ngPlus/outcome', () => {
    recordRun(state({ seed: 1 }), 'victory');
    const book = recordRun(state({ seed: 2 }), 'victory');
    expect(book.entries.length).toBe(2);
  });

  it('caps the log at 30 entries', () => {
    let book = loadLogbook();
    for (let i = 0; i < 35; i++) book = recordRun(state({ seed: i }), 'victory');
    expect(book.entries.length).toBe(30);
  });
});

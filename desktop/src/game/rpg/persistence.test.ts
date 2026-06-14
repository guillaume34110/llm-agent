import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveState, loadState, clearSave } from './persistence';
import { MORALE_MAX } from './morale';
import { PROV_MAX } from './provisions';
import type { RpgState } from './types';

// jsdom-free localStorage shim (vitest env is 'node').
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

// A minimal "current" save (version 1, every field present).
function fullSave(): Record<string, unknown> {
  return {
    version: 1,
    phase: 'scene',
    gold: 42,
    ngPlus: 1,
    difficulty: 'hard',
    morale: 55,
    provisions: 7,
    rumors: ['a'],
    inventory: [{ id: 'x', kind: 'potion', name: 'P', desc: '', heal: 5 }],
    dialogue: null,
    dicePool: null,
    dilemma: null,
    rivals: [],
    rivalEncounter: null,
    quest: { objective: 'fetch' },
    party: [{ id: 'h1', name: 'Hero', trait: { id: 'brave', name: 'Brave', desc: '' } }],
    recruitPool: [],
    nodes: {},
  };
}

let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });

describe('save / load round-trip', () => {
  it('rehydrates a freshly written run unchanged', () => {
    const s = fullSave() as unknown as RpgState;
    saveState(s);
    const back = loadState();
    expect(back).not.toBeNull();
    expect(back!.gold).toBe(42);
    expect(back!.difficulty).toBe('hard');
    expect(back!.morale).toBe(55);
    expect(back!.provisions).toBe(7);
  });

  it('clearSave wipes the slot', () => {
    saveState(fullSave() as unknown as RpgState);
    clearSave();
    expect(loadState()).toBeNull();
  });

  it('returns null when nothing was ever saved', () => {
    expect(loadState()).toBeNull();
  });

  it('rejects a save with the wrong version', () => {
    store.set('monkey.rpg.save', JSON.stringify({ ...fullSave(), version: 99 }));
    expect(loadState()).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    store.set('monkey.rpg.save', '{not json');
    expect(loadState()).toBeNull();
  });
});

describe('forward-compat backfill (old saves)', () => {
  // Strip a field, persist, and check loadState fills the default.
  function loadMissing(...omit: string[]): RpgState {
    const base = fullSave();
    for (const k of omit) delete base[k];
    store.set('monkey.rpg.save', JSON.stringify(base));
    const s = loadState();
    expect(s).not.toBeNull();
    return s!;
  }

  it('defaults missing rumors to an empty array', () => {
    expect(loadMissing('rumors').rumors).toEqual([]);
  });

  it('defaults missing morale to MORALE_MAX', () => {
    expect(loadMissing('morale').morale).toBe(MORALE_MAX);
  });

  it('defaults missing provisions to PROV_MAX', () => {
    expect(loadMissing('provisions').provisions).toBe(PROV_MAX);
  });

  it('defaults missing gold/ngPlus to 0', () => {
    const s = loadMissing('gold', 'ngPlus');
    expect(s.gold).toBe(0);
    expect(s.ngPlus).toBe(0);
  });

  it('coerces an unknown difficulty to normal', () => {
    const base = fullSave(); base.difficulty = 'lunatic';
    store.set('monkey.rpg.save', JSON.stringify(base));
    expect(loadState()!.difficulty).toBe('normal');
  });

  it('defaults missing inventory/rivals to empty arrays', () => {
    const s = loadMissing('inventory', 'rivals');
    expect(s.inventory).toEqual([]);
    expect(s.rivals).toEqual([]);
  });

  it('backfills quest objective to slay', () => {
    const base = fullSave(); base.quest = {};
    store.set('monkey.rpg.save', JSON.stringify(base));
    expect((loadState()!.quest as { objective?: string }).objective).toBe('slay');
  });
});

describe('stale phase repair', () => {
  function loadPhase(phase: string, extra: Record<string, unknown> = {}): RpgState {
    store.set('monkey.rpg.save', JSON.stringify({ ...fullSave(), phase, ...extra }));
    return loadState()!;
  }

  it("drops a mid-combat save back to 'scene'", () => {
    expect(loadPhase('combat').phase).toBe('scene');
  });

  it("drops a dangling 'dialogue' phase (no dialogue) to 'scene'", () => {
    expect(loadPhase('dialogue', { dialogue: null }).phase).toBe('scene');
  });

  it("drops a dangling 'dilemma' phase to 'scene'", () => {
    expect(loadPhase('dilemma', { dilemma: null }).phase).toBe('scene');
  });

  it("drops a dangling 'rival' phase to 'scene'", () => {
    expect(loadPhase('rival', { rivalEncounter: null }).phase).toBe('scene');
  });
});

describe('companion trait backfill', () => {
  it('assigns a deterministic trait to a trait-less party member', () => {
    const base = fullSave();
    base.party = [{ id: 'h1', name: 'Hero' }]; // no trait
    store.set('monkey.rpg.save', JSON.stringify(base));
    const s = loadState()!;
    const member = s.party[0] as unknown as { trait?: { id: string } };
    expect(member.trait).toBeDefined();
    // deterministic from id → reloading the same id yields the same trait
    store.set('monkey.rpg.save', JSON.stringify(base));
    const again = loadState()!;
    expect((again.party[0] as unknown as { trait: { id: string } }).trait.id)
      .toBe(member.trait!.id);
  });
});

describe('scouted backfill', () => {
  it('marks a discovered node as scouted when the field predates the feature', () => {
    const base = fullSave();
    base.nodes = { n1: { id: 'n1', discovered: true, edges: [] }, n2: { id: 'n2', discovered: false, edges: [] } };
    store.set('monkey.rpg.save', JSON.stringify(base));
    const s = loadState()! as unknown as { nodes: Record<string, { scouted: boolean }> };
    expect(s.nodes.n1.scouted).toBe(true);
    expect(s.nodes.n2.scouted).toBe(false);
  });
});

describe('saveState resilience', () => {
  it('swallows a quota error instead of throwing', () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage.setItem = () => {
      throw new Error('QuotaExceeded');
    };
    expect(() => saveState(fullSave() as unknown as RpgState)).not.toThrow();
    vi.restoreAllMocks();
  });
});

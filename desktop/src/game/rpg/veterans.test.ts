import { describe, it, expect, beforeEach } from 'vitest';
import { loadVeterans, saveVeterans, clearVeterans, VET_CAP } from './veterans';
import type { Character, RpgState } from './types';

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
    level: 3, xp: 0, hp: 5, maxHp: 30, alive: true,
    stats: { might: 2, agility: 2, wits: 2, spirit: 2 },
    ...partial,
  } as Character;
}

function state(party: Character[], extra: Partial<RpgState> = {}): RpgState {
  return { party, theme: 'jungle', title: 'The Run', ngPlus: 1, ...extra } as unknown as RpgState;
}

let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });

describe('loadVeterans', () => {
  it('returns [] when nothing is stored', () => {
    expect(loadVeterans()).toEqual([]);
  });

  it('returns [] on corrupt JSON', () => {
    store.set('monkey.rpg.veterans', '{bad');
    expect(loadVeterans()).toEqual([]);
  });

  it('filters out malformed records (no char.level)', () => {
    store.set('monkey.rpg.veterans', JSON.stringify([
      { char: { id: 'ok', level: 2 } },
      { char: { id: 'bad' } },
      { nope: true },
    ]));
    const v = loadVeterans();
    expect(v.length).toBe(1);
    expect(v[0].char.id).toBe('ok');
  });
});

describe('saveVeterans', () => {
  it('persists only living survivors, healed to full', () => {
    saveVeterans(state([ch({ id: 'a', hp: 5, maxHp: 30, alive: true }), ch({ id: 'd', alive: false })]));
    const v = loadVeterans();
    expect(v.length).toBe(1);
    expect(v[0].char.id).toBe('a');
    expect(v[0].char.hp).toBe(30); // healed to maxHp
    expect(v[0].theme).toBe('jungle');
    expect(v[0].ngPlus).toBe(1);
  });

  it('is a no-op when no one survives', () => {
    saveVeterans(state([ch({ alive: false })]));
    expect(loadVeterans()).toEqual([]);
  });

  it('dedupes by char id, newest first', () => {
    saveVeterans(state([ch({ id: 'a', level: 2 })]));
    saveVeterans(state([ch({ id: 'a', level: 9 })], { title: 'Later' }));
    const v = loadVeterans();
    expect(v.length).toBe(1);
    // newest write wins (fresh prepended before existing in the dedupe merge)
    expect(v[0].char.level).toBe(9);
  });

  it('caps the roster at VET_CAP', () => {
    const many = Array.from({ length: VET_CAP + 5 }, (_, i) => ch({ id: 'h' + i }));
    saveVeterans(state(many));
    expect(loadVeterans().length).toBe(VET_CAP);
  });
});

describe('clearVeterans', () => {
  it('wipes the roster', () => {
    saveVeterans(state([ch({ id: 'a' })]));
    clearVeterans();
    expect(loadVeterans()).toEqual([]);
  });
});

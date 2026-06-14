import { describe, it, expect, beforeEach } from 'vitest';
import { loadWorlds, saveWorld, deleteWorld } from './worlds';
import type { RpgSetupResult } from '../../api';

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

function setup(kinds: string[] = ['ruin']): RpgSetupResult {
  return {
    title: 'A World', intro: 'once', theme: 'jungle',
    locations: kinds.map((kind, i) => ({ name: 'L' + i, kind, blurb: '' })),
    heroes: [],
  } as unknown as RpgSetupResult;
}

let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });

describe('worlds persistence', () => {
  it('loadWorlds is empty by default', () => {
    expect(loadWorlds()).toEqual([]);
  });

  it('returns [] on corrupt storage', () => {
    store.set('monkey.rpg.worlds', '{garbage');
    expect(loadWorlds()).toEqual([]);
  });

  it('drops malformed entries (no setup.locations)', () => {
    store.set('monkey.rpg.worlds', JSON.stringify([{ id: 'x', theme: 't' }, { id: 'y', setup: { locations: [] } }]));
    expect(loadWorlds().map(w => w.id)).toEqual(['y']);
  });

  it('saveWorld prepends a vignette and round-trips', () => {
    const list = saveWorld('haunted bog', setup(['cave']));
    expect(list.length).toBe(1);
    expect(list[0].theme).toBe('haunted bog');
    expect(list[0].decor).toBe('cave');
    expect(loadWorlds().length).toBe(1);
  });

  it('ignores a blank theme', () => {
    expect(saveWorld('   ', setup())).toEqual([]);
    expect(loadWorlds()).toEqual([]);
  });

  it('dedups by theme (case-insensitive) and floats the re-roll to the front', () => {
    saveWorld('Desert', setup(['wild']));
    saveWorld('other', setup(['forest']));
    const list = saveWorld('DESERT', setup(['ruin']));
    expect(list.filter(w => w.theme.toLowerCase() === 'desert').length).toBe(1);
    expect(list[0].theme).toBe('DESERT');
    expect(list[0].decor).toBe('ruin');
  });

  it('picks the most evocative biome for the thumbnail', () => {
    const list = saveWorld('mixed', setup(['village', 'dungeon', 'forest']));
    expect(list[0].decor).toBe('dungeon'); // dungeon outranks forest/village
  });

  it('caps the list at 12 newest-first', () => {
    for (let i = 0; i < 15; i++) saveWorld('world ' + i, setup());
    const list = loadWorlds();
    expect(list.length).toBe(12);
    expect(list[0].theme).toBe('world 14');
  });

  it('deleteWorld removes by id', () => {
    saveWorld('keep', setup());
    const after = saveWorld('drop', setup());
    const dropId = after.find(w => w.theme === 'drop')!.id;
    const remaining = deleteWorld(dropId);
    expect(remaining.map(w => w.theme)).toEqual(['keep']);
    expect(loadWorlds().map(w => w.theme)).toEqual(['keep']);
  });
});

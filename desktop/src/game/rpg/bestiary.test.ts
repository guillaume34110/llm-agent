import { describe, it, expect } from 'vitest';
import {
  ENEMY_TABLE, BOSS_TITLES, BOSS_EXCLUDE,
  makeEnemies, makeBoss, nodeRoster,
} from './bestiary';
import type { NodeKind, MapNode, RpgState, Character } from './types';
import type { DiffParams } from './difficulty';

// A deterministic rng handing back a fixed queue, then 0 forever.
function rngOf(...vals: number[]): () => number {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
}

const KINDS: NodeKind[] = ['village', 'town', 'forest', 'wild', 'camp', 'ruin', 'dungeon', 'cave'];
const DIFF: DiffParams = { hp: 1, atk: 1 } as DiffParams;

function ch(partial: Partial<Character> = {}): Character {
  return {
    id: 'c1', name: 'Hero', className: 'warrior',
    stats: { might: 6, agility: 2, wits: 2, spirit: 2 },
    hp: 30, maxHp: 30, level: 3, xp: 0, alive: true,
    ...partial,
  } as Character;
}

function node(partial: Partial<MapNode> = {}): MapNode {
  return { id: 'n1', kind: 'dungeon', danger: 2, ...partial } as unknown as MapNode;
}

function state(partial: Partial<RpgState> = {}): RpgState {
  return { party: [ch()], inventory: [], difficulty: 'normal', ngPlus: 0, ...partial } as unknown as RpgState;
}

describe('ENEMY_TABLE', () => {
  it('holds at least one well-formed template for every node kind', () => {
    for (const k of KINDS) {
      const pool = ENEMY_TABLE[k];
      expect(pool.length).toBeGreaterThan(0);
      for (const t of pool) {
        expect(typeof t.name).toBe('string');
        expect(t.name.length).toBeGreaterThan(0);
        expect(typeof t.glyph).toBe('string');
        expect(t.glyph.length).toBeGreaterThan(0);
      }
    }
  });
  it('offers boss-worthy foes (not all trash) for the explorable sites', () => {
    for (const k of ['dungeon', 'cave', 'ruin'] as NodeKind[]) {
      expect(ENEMY_TABLE[k].some(t => !BOSS_EXCLUDE.test(t.name))).toBe(true);
    }
  });
});

describe('BOSS_TITLES / BOSS_EXCLUDE', () => {
  it('offers epithets and screens out trash species', () => {
    expect(BOSS_TITLES.length).toBeGreaterThan(0);
    expect(BOSS_EXCLUDE.test('Skull Mimic')).toBe(true);
    expect(BOSS_EXCLUDE.test('Woodland Imp')).toBe(true);
    expect(BOSS_EXCLUDE.test('Crypt Guardian')).toBe(false);
  });
});

describe('makeEnemies', () => {
  it('packs denser on more dangerous ground', () => {
    expect(makeEnemies(node({ danger: 1 }), rngOf(0), DIFF, state()).length).toBe(1);
    expect(makeEnemies(node({ danger: 2 }), rngOf(0), DIFF, state()).length).toBe(2);
    expect(makeEnemies(node({ danger: 3 }), rngOf(0), DIFF, state()).length).toBe(3);
  });
  it('gives stable, prefixed ids and live, named foes', () => {
    const foes = makeEnemies(node({ danger: 2 }), rngOf(0, 0, 0, 0), DIFF, state(), 'foe:n1');
    expect(foes.map(e => e.id)).toEqual(['foe:n1:0', 'foe:n1:1']);
    foes.forEach(e => {
      expect(e.alive).toBe(true);
      expect(e.hp).toBe(e.maxHp);
      expect(e.hp).toBeGreaterThan(0);
      expect(e.atk).toBeGreaterThanOrEqual(1);
      expect(e.name.length).toBeGreaterThan(0);
    });
  });
  it('scales foe atk up with party veterancy', () => {
    const green = makeEnemies(node({ danger: 2 }), rngOf(0, 0, 0, 0), DIFF, state({ party: [ch({ level: 1 })] }));
    const vet = makeEnemies(node({ danger: 2 }), rngOf(0, 0, 0, 0), DIFF, state({ party: [ch({ level: 8 })] }));
    expect(vet[0].atk).toBeGreaterThan(green[0].atk);
  });
});

describe('makeBoss', () => {
  it('crowns one multi-phase, boss-worthy foe', () => {
    const [boss] = makeBoss(node({ danger: 3 }), rngOf(0), 0, DIFF, state(), 'foe:n1');
    expect(boss.id).toBe('foe:n1:boss');
    expect(boss.bossPhase).toBe(1);
    expect(boss.bossMaxPhase).toBe(3);          // danger ≥ 3 → 3 phases
    expect(boss.hp).toBe(boss.maxHp);
    expect(boss.alive).toBe(true);
    expect(BOSS_EXCLUDE.test(boss.name)).toBe(false); // never a trash species
  });
  it('runs two phases below danger 3', () => {
    const [boss] = makeBoss(node({ danger: 2 }), rngOf(0), 0, DIFF, state());
    expect(boss.bossMaxPhase).toBe(2);
  });
  it('is deterministic per node (same species + title each call)', () => {
    const a = makeBoss(node({ id: 'x', danger: 3 }), rngOf(0), 0, DIFF, state(), 'p');
    const b = makeBoss(node({ id: 'x', danger: 3 }), rngOf(0.9), 0, DIFF, state(), 'p');
    expect(a[0].name).toBe(b[0].name);          // name is seeded by node id, not rng
  });
});

describe('nodeRoster', () => {
  it('is empty for a safe or cleared node', () => {
    expect(nodeRoster(node({ danger: 0 }), state())).toEqual([]);
    expect(nodeRoster(node({ danger: 3, cleared: true }), state())).toEqual([]);
  });
  it('drops the foes already slain, keeping the survivors', () => {
    const full = nodeRoster(node({ danger: 3 }), state());
    expect(full.length).toBe(3);
    const partial = nodeRoster(node({ danger: 3, defeatedFoes: [full[0].id] }), state());
    expect(partial.length).toBe(2);
    expect(partial.find(e => e.id === full[0].id)).toBeUndefined();
  });
});

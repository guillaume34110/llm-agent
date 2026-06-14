import { describe, it, expect, beforeEach } from 'vitest';
import {
  rivalNodeAt, spawnRivals, tickRivals, pressRivalsInPlace, maybeRivalEncounter, raceTracker,
} from './rivals';
import type { RpgState, MapNode, Rival } from './types';

// loadHub (read by spawnRivals for a returning nemesis) touches localStorage —
// install a Map-backed shim so the node env doesn't throw and we control the hub.
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
let store: Map<string, string>;
beforeEach(() => { store = installLocalStorage(); });

// A simple connected chain a-b-c-d-e (undirected edges), laid on a line.
function chain(ids: string[]): { nodes: Record<string, MapNode>; order: string[] } {
  const nodes: Record<string, MapNode> = {};
  ids.forEach((id, i) => {
    const edges: string[] = [];
    if (i > 0) edges.push(ids[i - 1]);
    if (i < ids.length - 1) edges.push(ids[i + 1]);
    nodes[id] = { id, name: id.toUpperCase(), kind: 'wild', blurb: '', edges, discovered: true, cleared: false, danger: 1, x: i, y: 0 } as MapNode;
  });
  return { nodes, order: ids };
}

function rival(partial: Partial<Rival> = {}): Rival {
  return {
    id: 'r1', name: 'Voss', glyph: '▲', blurb: 'a crew',
    path: ['a', 'b', 'c', 'd'], progress: 0, pace: 0.1, nodeId: 'a',
    disposition: 'rival', met: false, hindered: 0, arrived: false,
    ...partial,
  } as Rival;
}

function state(partial: Partial<RpgState> = {}): RpgState {
  const { nodes } = chain(['a', 'b', 'c', 'd', 'e']);
  return {
    currentNodeId: 'a', nodes,
    quest: { goalNodeId: 'e', done: false, kind: 'slay' },
    party: [{ alive: true } as never],
    rivals: [],
    phase: 'scene',
    ...partial,
  } as unknown as RpgState;
}

describe('rivalNodeAt', () => {
  it('maps progress to a node along the path', () => {
    const r = rival({ path: ['a', 'b', 'c', 'd'], progress: 0 });
    expect(rivalNodeAt(r)).toBe('a');
    expect(rivalNodeAt({ ...r, progress: 1 })).toBe('d');
    expect(rivalNodeAt({ ...r, progress: 0.5 })).toBe('c'); // round(0.5*3)=2 → c
  });
  it('falls back to nodeId on an empty path', () => {
    expect(rivalNodeAt(rival({ path: [], nodeId: 'z' }))).toBe('z');
  });
});

describe('spawnRivals', () => {
  it('is deterministic for the same seed + entropy', () => {
    const { nodes, order } = chain(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const a = spawnRivals(nodes, order, 'a', 'j', 'normal', 123, 7);
    const b = spawnRivals(nodes, order, 'a', 'j', 'normal', 123, 7);
    expect(a.map(r => ({ name: r.name, path: r.path, prog: r.progress }))).toEqual(b.map(r => ({ name: r.name, path: r.path, prog: r.progress })));
  });
  it('fields two rivals on a large map, one on a small one', () => {
    const big = chain(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const small = chain(['a', 'b', 'c', 'd']);
    expect(spawnRivals(big.nodes, big.order, 'a', 'j', 'normal', 1, 1).length).toBe(2);
    expect(spawnRivals(small.nodes, small.order, 'a', 'd', 'normal', 1, 1).length).toBe(1);
  });
  it('every rival has a path that reaches the goal and starts underway', () => {
    const { nodes, order } = chain(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    for (const r of spawnRivals(nodes, order, 'a', 'j', 'normal', 5, 2)) {
      expect(r.path[r.path.length - 1]).toBe('j');
      expect(r.progress).toBeGreaterThanOrEqual(0.06);
      expect(r.progress).toBeLessThanOrEqual(0.34);
      expect(r.arrived).toBe(false);
    }
  });
  it('the lead rival becomes the saved nemesis', () => {
    store.set('monkey.rpg.hub', JSON.stringify({ nemesis: { name: 'Old Foe', glyph: '☠', wins: 2 } }));
    const { nodes, order } = chain(['a', 'b', 'c', 'd', 'e', 'f']);
    const rivals = spawnRivals(nodes, order, 'a', 'f', 'normal', 9, 3);
    expect(rivals[0].name).toBe('Old Foe');
    expect(rivals[0].glyph).toBe('☠');
    expect(rivals[0].disposition).toBe('cutthroat');
    expect((rivals[0] as Rival & { nemesis?: boolean }).nemesis).toBe(true);
  });
});

describe('tickRivals', () => {
  it('advances progress by pace and reports a winner on arrival', () => {
    const s = state({ rivals: [rival({ progress: 0.95, pace: 0.1 })] });
    const won = tickRivals(s);
    expect(s.rivals![0].progress).toBe(1);
    expect(s.rivals![0].arrived).toBe(true);
    expect(won).toEqual(['Voss']);
  });
  it('a hindered rival crawls at 40% pace and burns one hinder on a full leg', () => {
    const s = state({ rivals: [rival({ progress: 0, pace: 0.1, hindered: 2 })] });
    tickRivals(s, 1);
    expect(s.rivals![0].progress).toBeCloseTo(0.04, 5);
    expect(s.rivals![0].hindered).toBe(1);
  });
  it('frac scales the step and a partial leg does not burn the hinder', () => {
    const s = state({ rivals: [rival({ progress: 0, pace: 0.2, hindered: 1 })] });
    tickRivals(s, 0.5); // 0.2 * 0.4 * 0.5 = 0.04
    expect(s.rivals![0].progress).toBeCloseTo(0.04, 5);
    expect(s.rivals![0].hindered).toBe(1);
  });
  it('skips an already-arrived rival', () => {
    const s = state({ rivals: [rival({ progress: 1, arrived: true })] });
    expect(tickRivals(s)).toEqual([]);
  });
});

describe('pressRivalsInPlace', () => {
  it('is a no-op while the party stands on the goal site', () => {
    const s = state({ currentNodeId: 'e', rivals: [rival({ progress: 0.99 })] });
    expect(pressRivalsInPlace(s)).toBeNull();
    expect(s.phase).toBe('scene');
  });
  it('returns null with no rivals', () => {
    expect(pressRivalsInPlace(state({ rivals: [] }))).toBeNull();
  });
  it('ends the run when a rival snatches the prize and the quest is unmet', () => {
    const s = state({ currentNodeId: 'a', rivals: [rival({ progress: 0.99, pace: 1 })] });
    const lostTo = pressRivalsInPlace(s);
    expect(lostTo).toBe('Voss');
    expect(s.phase).toBe('gameover');
  });
});

describe('maybeRivalEncounter', () => {
  it('opens a meeting when a live rival stands on the node', () => {
    const s = state({ rivals: [rival({ nodeId: 'b', arrived: false })] });
    expect(maybeRivalEncounter(s, 'b')).toBe(true);
    expect(s.phase).toBe('rival');
    expect(s.rivalEncounter?.options.length).toBeGreaterThanOrEqual(3);
    expect(s.rivals![0].met).toBe(true);
  });
  it('does not fire on an empty node or after the quest is done', () => {
    expect(maybeRivalEncounter(state({ rivals: [rival({ nodeId: 'b' })] }), 'c')).toBe(false);
    const done = state({ rivals: [rival({ nodeId: 'b' })], quest: { goalNodeId: 'e', done: true, kind: 'slay' } as never });
    expect(maybeRivalEncounter(done, 'b')).toBe(false);
  });
});

describe('raceTracker', () => {
  it('reports party at 1 on the goal and the party leading', () => {
    const t = raceTracker(state({ currentNodeId: 'e', rivals: [rival({ progress: 0.5 })] }));
    expect(t.party).toBe(1);
    expect(t.leader).toBe('party');
  });
  it('a rival ahead of the party takes the lead', () => {
    const t = raceTracker(state({ currentNodeId: 'a', rivals: [rival({ progress: 0.9 })] }));
    expect(t.leader).toBe('rival');
    expect(t.rivals[0].pct).toBeCloseTo(0.9, 5);
  });
});

import { describe, it, expect } from 'vitest';
import { currentNode, neighbors, partyAlive, legalTags, fallbackChoices } from './queries';
import type { RpgState, MapNode, ActionTag } from './types';

function node(partial: Partial<MapNode> = {}): MapNode {
  return {
    id: 'n', name: 'N', kind: 'wild', blurb: '', edges: [],
    discovered: true, cleared: false, danger: 0, x: 0, y: 0,
    ...partial,
  } as MapNode;
}

function state(partial: Partial<RpgState> = {}): RpgState {
  return {
    currentNodeId: 'a',
    nodes: { a: node({ id: 'a' }) },
    party: [{ alive: true } as never],
    provisions: 12, recruitPool: [],
    ...partial,
  } as unknown as RpgState;
}

describe('currentNode / neighbors', () => {
  it('currentNode returns the node at currentNodeId', () => {
    const s = state({ currentNodeId: 'a', nodes: { a: node({ id: 'a', name: 'Home' }) } });
    expect(currentNode(s).name).toBe('Home');
  });
  it('neighbors maps a node\'s edges to nodes', () => {
    const s = state({ nodes: { a: node({ id: 'a', edges: ['b', 'c'] }), b: node({ id: 'b' }), c: node({ id: 'c' }) } });
    expect(neighbors(s, 'a').map(n => n.id)).toEqual(['b', 'c']);
  });
});

describe('partyAlive', () => {
  it('is true while any member lives', () => {
    expect(partyAlive(state({ party: [{ alive: false }, { alive: true }] as never }))).toBe(true);
  });
  it('is false when all are down', () => {
    expect(partyAlive(state({ party: [{ alive: false }] as never }))).toBe(false);
  });
});

describe('legalTags (frozen client rules)', () => {
  it('always offers look/search/quest', () => {
    const tags = legalTags(state(), node());
    expect(tags).toEqual(expect.arrayContaining(['look', 'search', 'quest']));
  });
  it('offers fight at a dangerous uncleared non-crawl node', () => {
    expect(legalTags(state(), node({ danger: 2, cleared: false }))).toContain('fight');
    expect(legalTags(state(), node({ danger: 2, cleared: true }))).not.toContain('fight');
  });
  it('never offers fight at a crawl (room) node', () => {
    const rooms = [{ id: 'r' }] as never;
    expect(legalTags(state(), node({ danger: 2, cleared: false, rooms }))).not.toContain('fight');
  });
  it('settlements offer talk/rest and provision only when not full', () => {
    expect(legalTags(state({ provisions: 12 }), node({ kind: 'town' }))).toEqual(expect.arrayContaining(['talk', 'rest']));
    expect(legalTags(state({ provisions: 12 }), node({ kind: 'town' }))).not.toContain('provision');
    expect(legalTags(state({ provisions: 3 }), node({ kind: 'town' }))).toContain('provision');
  });
  it('offers recruit only with a pool, room in the party, at a settlement', () => {
    const withPool = state({ recruitPool: [{} as never], party: [{ alive: true }] as never });
    expect(legalTags(withPool, node({ kind: 'village' }))).toContain('recruit');
    const fullParty = state({ recruitPool: [{} as never], party: [{}, {}, {}, {}] as never });
    expect(legalTags(fullParty, node({ kind: 'village' }))).not.toContain('recruit');
  });
  it('offers hunt at a cleared, farmable, dangerous site while the party lives', () => {
    expect(legalTags(state(), node({ farmable: true, cleared: true, danger: 1 }))).toContain('hunt');
  });
  it('offers leave only on safe or cleared ground', () => {
    expect(legalTags(state(), node({ danger: 0 }))).toContain('leave');
    expect(legalTags(state(), node({ danger: 3, cleared: false }))).not.toContain('leave');
  });
});

describe('fallbackChoices', () => {
  it('drops leave, caps at four, and labels each tag', () => {
    const tags: ActionTag[] = ['look', 'search', 'fight', 'quest', 'leave'];
    const choices = fallbackChoices(tags);
    expect(choices.length).toBeLessThanOrEqual(4);
    expect(choices.every(c => c.tag !== 'leave')).toBe(true);
    expect(choices.every(c => typeof c.label === 'string' && c.label.length > 0)).toBe(true);
  });
});

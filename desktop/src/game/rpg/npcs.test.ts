import { describe, it, expect } from 'vitest';
import { npcFor, sceneNpc } from './npcs';
import type { MapNode, NodeKind } from './types';

function node(partial: Partial<MapNode> = {}): MapNode {
  return { id: 'n1', kind: 'town', ...partial } as unknown as MapNode;
}

describe('npcFor', () => {
  it('is deterministic per node id (same speaker every call)', () => {
    const a = npcFor(node({ id: 'x', kind: 'town' }));
    const b = npcFor(node({ id: 'x', kind: 'town' }));
    expect(a).toEqual(b);
    expect(a.name.length).toBeGreaterThan(0);
    expect(a.role.length).toBeGreaterThan(0);
  });
  it('picks a role fitting the settlement kind', () => {
    expect(['merchant', 'town guard', 'elder', 'innkeeper']).toContain(npcFor(node({ id: 't', kind: 'town' })).role);
    expect(['villager', 'village elder', 'farmer', 'healer']).toContain(npcFor(node({ id: 'v', kind: 'village' })).role);
    expect(['watch guard', 'old traveler']).toContain(npcFor(node({ id: 'c', kind: 'camp' })).role);
  });
  it('falls back to a wanderer for non-settlement kinds', () => {
    expect(npcFor(node({ id: 'w', kind: 'wild' })).role).toBe('wanderer');
  });
});

describe('sceneNpc', () => {
  it('returns a speaker only in settlements', () => {
    for (const k of ['town', 'village', 'camp'] as NodeKind[]) {
      expect(sceneNpc(node({ id: k, kind: k }))).not.toBeNull();
    }
  });
  it('returns null where no one is around', () => {
    for (const k of ['wild', 'forest', 'dungeon', 'cave', 'ruin'] as NodeKind[]) {
      expect(sceneNpc(node({ id: k, kind: k }))).toBeNull();
    }
  });
  it('matches npcFor when a speaker is present', () => {
    const n = node({ id: 'q', kind: 'town' });
    expect(sceneNpc(n)).toEqual(npcFor(n));
  });
});

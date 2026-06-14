import type { MapNode } from './types';
import { makeRng, seedFrom } from './dice';
import { NAMES } from './character';

// ── NPCs (deterministic settlement speakers; pure, client-owned) ─────────────

// Which NPC the player meets at a node — deterministic per node so the same
// place always has the same speaker (replayable). Roles drive the LLM persona.
export function npcFor(node: MapNode): { name: string; role: string } {
  const rng = makeRng(seedFrom(`npc:${node.id}`));
  const rolesByKind: Record<string, string[]> = {
    town: ['merchant', 'town guard', 'elder', 'innkeeper'],
    village: ['villager', 'village elder', 'farmer', 'healer'],
    camp: ['watch guard', 'old traveler'],
  };
  const roles = rolesByKind[node.kind] || ['wanderer'];
  const role = roles[Math.floor(rng() * roles.length)];
  const name = NAMES[Math.floor(rng() * NAMES.length)];
  return { name, role };
}

// The interactive NPC standing in a settlement scene (deterministic per node).
// null where no one is around (wilds, dungeons, …) so the scene draws no speaker.
export function sceneNpc(node: MapNode): { name: string; role: string } | null {
  if (node.kind !== 'town' && node.kind !== 'village' && node.kind !== 'camp') return null;
  return npcFor(node);
}

import type { RpgState, MapNode, ActionTag, SceneChoice } from './types';
import { PROV_MAX } from './provisions';

// ── Queries ─────────────────────────────────────────────────────────────────
// Pure reads over the run state. The engine and the UI both lean on these; they
// never mutate. Kept in their own leaf so any layer can ask "what's legal here?"
// without pulling in the mutation engine.

export function currentNode(state: RpgState): MapNode {
  return state.nodes[state.currentNodeId];
}

export function neighbors(state: RpgState, id: string): MapNode[] {
  return state.nodes[id].edges.map(e => state.nodes[e]);
}

export function partyAlive(state: RpgState): boolean {
  return state.party.some(c => c.alive);
}

// The action tags legal at a node — the client's frozen rules, sent to the GM
// so it only ever proposes choices the engine can actually resolve.
export function legalTags(state: RpgState, node: MapNode): ActionTag[] {
  const tags: ActionTag[] = ['look', 'search'];
  // Room nodes resolve their danger room-by-room (the crawl view), never as one
  // whole-node fight — so no abstract 'fight' tag is offered there.
  const isCrawl = !!(node.rooms && node.rooms.length);
  if (node.danger > 0 && !node.cleared && !isCrawl) tags.push('fight');
  if (node.kind === 'village' || node.kind === 'town') tags.push('talk');
  if ((node.kind === 'village' || node.kind === 'town' || node.kind === 'camp')) tags.push('rest');
  // Settlements sell rations — offer a restock only when the satchel isn't full.
  if ((node.kind === 'village' || node.kind === 'town') && state.provisions < PROV_MAX) tags.push('provision');
  if (state.recruitPool.length > 0 && state.party.length < 4 &&
      (node.kind === 'village' || node.kind === 'town')) tags.push('recruit');
  // A cleared farmable site can be hunted again for XP + light loot (grinding).
  if (node.farmable && node.cleared && node.danger > 0 && partyAlive(state)) tags.push('hunt');
  tags.push('quest');
  // Friendly ground = leave freely; a dangerous place must be cleared first.
  if (node.danger === 0 || node.cleared) tags.push('leave');
  return tags;
}

export function fallbackChoices(tags: ActionTag[]): SceneChoice[] {
  const labels: Record<ActionTag, string> = {
    search: 'Search the area', talk: 'Find someone to talk to', rest: 'Make camp and rest',
    look: 'Look around', fight: 'Face the danger', recruit: 'Look for an ally',
    quest: 'Review the quest', leave: 'Move on', hunt: 'Hunt for XP',
    provision: 'Buy supplies',
  };
  return tags.filter(t => t !== 'leave').slice(0, 4).map(t => ({ label: labels[t], tag: t }));
}

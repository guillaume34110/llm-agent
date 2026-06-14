import type { RpgState, QuestObjective } from './types';

// True when the run's win condition is met. slay ⇒ the goal boss is down (node
// cleared); retrieve ⇒ the relic is claimed; both ⇒ both. The lone source of truth.
// questSatisfied is the SINGLE authority — every clearing/claim event and the
// commission ledger re-derive victory from it, so the three objective shapes never
// drift. Pure; depends only on the run state.
export function questSatisfied(state: RpgState): boolean {
  const goal = state.nodes[state.quest.goalNodeId];
  if (!goal) return false;
  const slain = !!goal.cleared;
  const got = !!state.quest.relicClaimed;
  switch (state.quest.objective || 'slay') {
    case 'retrieve': return got;
    case 'both': return slain && got;
    default: return slain;
  }
}

// ── Quest objective (slay / retrieve / both; client-owned) ───────────────────
// The win condition picked at world-build. The relic (retrieve/both) is seized
// from a flagged treasure room of the goal dungeon; the boss (slay/both) is felled
// at its deepest room. questSatisfied is the SINGLE authority — every clearing and
// claim event re-derives victory from it, so the three objective shapes never drift.
export const OBJECTIVES: QuestObjective[] = ['slay', 'retrieve', 'both'];
export const RELIC_NAMES = [
  'the Sunfire Crown', 'the Heart of the Mountain', 'the Whispering Codex',
  'the Tear of the Moon', 'the Obsidian Seal', 'the Everflame Lantern',
  'the Crystal of Ages', 'the Serpent Chalice', 'the Worldroot Sigil',
];

// Flip the quest to done if its objective is satisfied; optionally transition to
// the victory phase (callers mid-combat defer the phase swap to endCombat). Returns
// whether the quest is now complete. Idempotent.
export function maybeWinQuest(state: RpgState, transition: boolean): boolean {
  if (!questSatisfied(state)) return false;
  state.quest.done = true;
  if (transition) state.phase = 'victory';
  return true;
}

// One-line label for a quest objective (HUD/quest scroll).
export function objectiveLabel(q: { objective?: QuestObjective; relicName?: string }): string {
  switch (q.objective || 'slay') {
    case 'retrieve': return `Retrieve ${q.relicName || 'the relic'}`;
    case 'both': return `Retrieve ${q.relicName || 'the relic'} and slay the master`;
    default: return 'Slay the master of the goal';
  }
}

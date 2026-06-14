import { describe, it, expect } from 'vitest';
import { questSatisfied, maybeWinQuest, objectiveLabel, OBJECTIVES, RELIC_NAMES } from './quest';
import type { RpgState } from './types';

function state(quest: Record<string, unknown>, nodes: Record<string, { cleared?: boolean }> = {}): RpgState {
  return { quest, nodes } as unknown as RpgState;
}

describe('questSatisfied', () => {
  it('is false when the goal node is unknown', () => {
    expect(questSatisfied(state({ goalNodeId: 'ghost', objective: 'slay' }))).toBe(false);
  });

  it('slay: satisfied only when the goal node is cleared', () => {
    expect(questSatisfied(state({ goalNodeId: 'g', objective: 'slay' }, { g: { cleared: false } }))).toBe(false);
    expect(questSatisfied(state({ goalNodeId: 'g', objective: 'slay' }, { g: { cleared: true } }))).toBe(true);
  });

  it('defaults a missing objective to slay', () => {
    expect(questSatisfied(state({ goalNodeId: 'g' }, { g: { cleared: true } }))).toBe(true);
    expect(questSatisfied(state({ goalNodeId: 'g' }, { g: { cleared: false } }))).toBe(false);
  });

  it('retrieve: satisfied only when the relic is claimed', () => {
    expect(questSatisfied(state({ goalNodeId: 'g', objective: 'retrieve' }, { g: { cleared: true } }))).toBe(false);
    expect(questSatisfied(state({ goalNodeId: 'g', objective: 'retrieve', relicClaimed: true }, { g: { cleared: false } }))).toBe(true);
  });

  it('both: needs the boss down AND the relic claimed', () => {
    expect(questSatisfied(state({ goalNodeId: 'g', objective: 'both', relicClaimed: true }, { g: { cleared: false } }))).toBe(false);
    expect(questSatisfied(state({ goalNodeId: 'g', objective: 'both' }, { g: { cleared: true } }))).toBe(false);
    expect(questSatisfied(state({ goalNodeId: 'g', objective: 'both', relicClaimed: true }, { g: { cleared: true } }))).toBe(true);
  });
});

describe('maybeWinQuest', () => {
  it('leaves an unmet quest untouched and reports false', () => {
    const s = state({ goalNodeId: 'g', objective: 'slay', done: false }, { g: { cleared: false } });
    (s as { phase?: string }).phase = 'scene';
    expect(maybeWinQuest(s, true)).toBe(false);
    expect(s.quest.done).toBe(false);
    expect((s as { phase?: string }).phase).toBe('scene');
  });
  it('flips done and transitions to victory when asked', () => {
    const s = state({ goalNodeId: 'g', objective: 'slay', done: false }, { g: { cleared: true } });
    (s as { phase?: string }).phase = 'scene';
    expect(maybeWinQuest(s, true)).toBe(true);
    expect(s.quest.done).toBe(true);
    expect((s as { phase?: string }).phase).toBe('victory');
  });
  it('flips done but holds the phase when transition is false (deferred to endCombat)', () => {
    const s = state({ goalNodeId: 'g', objective: 'slay', done: false }, { g: { cleared: true } });
    (s as { phase?: string }).phase = 'combat';
    expect(maybeWinQuest(s, false)).toBe(true);
    expect(s.quest.done).toBe(true);
    expect((s as { phase?: string }).phase).toBe('combat');
  });
});

describe('objectiveLabel', () => {
  it('reads each objective shape, defaulting to slay', () => {
    expect(objectiveLabel({ objective: 'slay' })).toContain('Slay');
    expect(objectiveLabel({})).toContain('Slay');
    expect(objectiveLabel({ objective: 'retrieve', relicName: 'the Crown' })).toBe('Retrieve the Crown');
    expect(objectiveLabel({ objective: 'both', relicName: 'the Seal' })).toBe('Retrieve the Seal and slay the master');
  });
  it('falls back to a generic relic name when none is set', () => {
    expect(objectiveLabel({ objective: 'retrieve' })).toBe('Retrieve the relic');
  });
});

describe('objective tables', () => {
  it('cover the three shapes and offer relic names', () => {
    expect(OBJECTIVES).toEqual(['slay', 'retrieve', 'both']);
    expect(RELIC_NAMES.length).toBeGreaterThan(0);
    expect(RELIC_NAMES.every(n => typeof n === 'string' && n.length > 0)).toBe(true);
  });
});

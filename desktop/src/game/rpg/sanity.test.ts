import { describe, it, expect, vi } from 'vitest';
import { HALLUCINATIONS, maybeHallucinate } from './sanity';
import type { RpgState } from './types';

// A deterministic rng that hands back a fixed queue, then 0 forever.
function rngOf(...vals: number[]): () => number {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
}

function state(morale: number): RpgState {
  return { morale } as unknown as RpgState;
}

describe('maybeHallucinate', () => {
  it('never fires (and never rolls) at or above the affliction morale floor', () => {
    const rng = vi.fn(() => 0);
    expect(maybeHallucinate(state(40), rng)).toBeNull();
    expect(maybeHallucinate(state(80), rng)).toBeNull();
    expect(rng).not.toHaveBeenCalled();
  });

  it('returns null when the first roll clears the (low-morale) chance', () => {
    // morale 10 → chance = min(0.4, 30/120) = 0.25; roll 0.25 is NOT < 0.25.
    expect(maybeHallucinate(state(10), rngOf(0.25))).toBeNull();
  });

  it('fires a hallucination line when the roll lands under the chance', () => {
    // roll 0.1 < 0.25 fires; line index floor(0 * len) = 0; 0.9 ≥ 0.34 → no morale loss.
    const s = state(10);
    const out = maybeHallucinate(s, rngOf(0.1, 0, 0.9));
    expect(out).toBe(`A trick of the mind: ${HALLUCINATIONS[0]}`);
    expect(s.morale).toBe(10);
  });

  it('a vivid spell (third roll < 0.34) shaves 2 morale', () => {
    const s = state(10);
    const out = maybeHallucinate(s, rngOf(0.1, 0.5, 0.1));
    expect(out).toContain(`A trick of the mind: ${HALLUCINATIONS[3]}`); // floor(0.5*7)=3
    expect(s.morale).toBe(8);
  });

  it('chance is capped at 0.4 even at rock-bottom morale', () => {
    // morale 0 → (40-0)/120 = 0.333 < 0.4; a roll of 0.39 must NOT fire.
    expect(maybeHallucinate(state(0), rngOf(0.39))).toBeNull();
    // and a roll just under 0.333 does fire.
    expect(maybeHallucinate(state(0), rngOf(0.3, 0, 0.9))).not.toBeNull();
  });

  it('only ever picks lines from the table', () => {
    for (let r = 0; r < 1; r += 0.13) {
      const out = maybeHallucinate(state(5), rngOf(0.01, r, 0.99));
      expect(out).not.toBeNull();
      expect(HALLUCINATIONS.some(h => out!.endsWith(h))).toBe(true);
    }
  });
});

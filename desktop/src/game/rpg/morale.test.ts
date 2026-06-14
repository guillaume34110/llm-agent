import { describe, it, expect } from 'vitest';
import type { RpgState } from './types';
import { MORALE_MAX, clampMorale, adjustMorale, moraleBand } from './morale';

describe('clampMorale', () => {
  it('floors at 0 and caps at MORALE_MAX', () => {
    expect(clampMorale(-50)).toBe(0);
    expect(clampMorale(999)).toBe(MORALE_MAX);
    expect(clampMorale(MORALE_MAX)).toBe(MORALE_MAX);
  });
  it('rounds to an integer (morale is never fractional)', () => {
    expect(clampMorale(41.4)).toBe(41);
    expect(clampMorale(41.6)).toBe(42);
  });
});

describe('moraleBand thresholds', () => {
  it('maps the four bands at the documented cut points', () => {
    expect(moraleBand(100)).toBe('high');
    expect(moraleBand(70)).toBe('high');
    expect(moraleBand(69)).toBe('steady');
    expect(moraleBand(40)).toBe('steady');
    expect(moraleBand(39)).toBe('low');
    expect(moraleBand(20)).toBe('low');
    expect(moraleBand(19)).toBe('breaking');
    expect(moraleBand(0)).toBe('breaking');
  });
});

describe('adjustMorale', () => {
  it('mutates state and returns the signed delta actually applied', () => {
    const st = { morale: 50 } as RpgState;
    expect(adjustMorale(st, 30)).toBe(30);
    expect(st.morale).toBe(80);
  });
  it('clamps at the ceiling and reports the real (smaller) delta', () => {
    const st = { morale: 90 } as RpgState;
    expect(adjustMorale(st, 30)).toBe(10); // only 10 fit before MORALE_MAX
    expect(st.morale).toBe(MORALE_MAX);
  });
  it('clamps at the floor without going negative', () => {
    const st = { morale: 5 } as RpgState;
    expect(adjustMorale(st, -40)).toBe(-5);
    expect(st.morale).toBe(0);
  });
});

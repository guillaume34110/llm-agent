import { describe, it, expect } from 'vitest';
import { xpForLevel } from './progression';

describe('xpForLevel', () => {
  it('follows the level*12 + 8 curve', () => {
    expect(xpForLevel(1)).toBe(20);
    expect(xpForLevel(2)).toBe(32);
    expect(xpForLevel(5)).toBe(68);
  });
  it('is strictly increasing so higher levels never trivialise', () => {
    for (let l = 1; l < 20; l++) {
      expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    }
  });
});

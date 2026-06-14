import { describe, it, expect } from 'vitest';
import { featuredExhibit, EXHIBIT_BONUS } from './exposition';
import { TRADE_GOODS } from './peoples';

describe('featuredExhibit', () => {
  it('always names a real trade-good category', () => {
    for (let chapter = 1; chapter <= 12; chapter++) {
      expect(TRADE_GOODS).toContain(featuredExhibit(12345, chapter));
    }
  });

  it('is deterministic per (campaign seed, chapter)', () => {
    expect(featuredExhibit(777, 3)).toBe(featuredExhibit(777, 3));
    expect(featuredExhibit(777, 3)).toBe(featuredExhibit(777, 3)); // no hidden state
  });

  it('rotates the gallery across chapters of one campaign', () => {
    const seen = new Set<string>();
    for (let chapter = 1; chapter <= 12; chapter++) seen.add(featuredExhibit(42, chapter));
    // a long campaign should headline more than a single category
    expect(seen.size).toBeGreaterThan(1);
  });

  it('different campaigns can headline different galleries the same chapter', () => {
    const galleries = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) galleries.add(featuredExhibit(seed, 1));
    expect(galleries.size).toBeGreaterThan(1);
  });

  it('the exhibit bonus is a positive, player-favourable premium', () => {
    expect(EXHIBIT_BONUS).toBeGreaterThan(0);
  });
});

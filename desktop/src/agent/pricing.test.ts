import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateCostCents, formatCostBadge } from './pricing';

describe('pricing', () => {
  describe('estimateTokens', () => {
    it('empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('hello world', () => {
      expect(estimateTokens('hello world')).toBe(Math.ceil(11 / 4));
    });
  });

  describe('estimateCostCents', () => {
    it('empty prompt with null model', () => {
      expect(estimateCostCents('', null)).toBe(0);
    });

    it('zero prices', () => {
      expect(estimateCostCents('hello', { inputCostPer1MTokensCents: 0, outputCostPer1MTokensCents: 0 })).toBe(0);
    });

    it('calculation: 4000 chars, 100 cents/M input, 400 cents/M output', () => {
      const result = estimateCostCents(
        'a'.repeat(4000),
        { inputCostPer1MTokensCents: 100, outputCostPer1MTokensCents: 400 },
        500
      );
      expect(result).toBeCloseTo(0.3, 5);
    });
  });

  describe('formatCostBadge', () => {
    it('zero cost', () => {
      expect(formatCostBadge(0)).toBe('—');
    });

    it('less than 0.1 cents', () => {
      expect(formatCostBadge(0.05)).toBe('<0.1¢');
    });

    it('0.45 cents', () => {
      expect(formatCostBadge(0.45)).toBe('0.45¢');
    });

    it('5.2 cents', () => {
      expect(formatCostBadge(5.2)).toBe('5.2¢');
    });

    it('150 cents (1.50 euros)', () => {
      expect(formatCostBadge(150)).toBe('1.50€');
    });
  });
});

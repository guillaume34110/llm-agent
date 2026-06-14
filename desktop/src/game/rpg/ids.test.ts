import { describe, it, expect } from 'vitest';
import { uid } from './ids';

describe('uid', () => {
  it('keeps the requested prefix', () => {
    expect(uid('item')).toMatch(/^item_/);
    expect(uid('char')).toMatch(/^char_/);
  });
  it('never collides across a burst of mints', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(uid('x'));
    expect(seen.size).toBe(1000);
  });
});

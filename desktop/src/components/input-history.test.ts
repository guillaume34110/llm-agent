import { beforeEach, describe, expect, it } from 'vitest';
import { clearHistory, getHistory, pushHistory } from './input-history';

function installStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
    configurable: true,
    writable: true,
  });
  return store;
}

describe('input-history', () => {
  beforeEach(() => installStorage().clear());

  it('returns empty array when no history', () => {
    expect(getHistory()).toEqual([]);
  });

  it('adds message to front of history', () => {
    pushHistory('first');
    pushHistory('second');
    expect(getHistory()).toEqual(['second', 'first']);
  });

  it('moves duplicate to front instead of appending', () => {
    pushHistory('msg a');
    pushHistory('msg b');
    pushHistory('msg a');
    expect(getHistory()).toEqual(['msg a', 'msg b']);
  });

  it('ignores empty or whitespace-only strings', () => {
    pushHistory('');
    pushHistory('   ');
    expect(getHistory()).toEqual([]);
  });

  it('trims text before storing', () => {
    pushHistory('  hello  ');
    expect(getHistory()[0]).toBe('hello');
  });

  it('caps history at 100 entries', () => {
    for (let i = 0; i < 110; i++) pushHistory(`message ${i}`);
    expect(getHistory()).toHaveLength(100);
  });

  it('clearHistory removes all entries', () => {
    pushHistory('a');
    pushHistory('b');
    clearHistory();
    expect(getHistory()).toEqual([]);
  });

  it('preserves insertion order (most recent first)', () => {
    const messages = ['alpha', 'beta', 'gamma'];
    messages.forEach(pushHistory);
    expect(getHistory()).toEqual(['gamma', 'beta', 'alpha']);
  });
});

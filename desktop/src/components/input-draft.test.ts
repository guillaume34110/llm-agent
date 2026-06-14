import { beforeEach, describe, expect, it } from 'vitest';
import { clearDraft, loadDraft, saveDraft } from './input-draft';

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

describe('input-draft', () => {
  beforeEach(() => installStorage().clear());

  it('returns empty string when no draft saved', () => {
    expect(loadDraft()).toBe('');
  });

  it('saves and restores draft text', () => {
    saveDraft('hello world');
    expect(loadDraft()).toBe('hello world');
  });

  it('saveDraft with empty string removes the key', () => {
    saveDraft('some text');
    saveDraft('');
    expect(loadDraft()).toBe('');
  });

  it('clearDraft removes the key', () => {
    saveDraft('draft to clear');
    clearDraft();
    expect(loadDraft()).toBe('');
  });

  it('overwrites previous draft', () => {
    saveDraft('first draft');
    saveDraft('second draft');
    expect(loadDraft()).toBe('second draft');
  });

  it('preserves whitespace inside text', () => {
    saveDraft('  leading and trailing  ');
    expect(loadDraft()).toBe('  leading and trailing  ');
  });
});

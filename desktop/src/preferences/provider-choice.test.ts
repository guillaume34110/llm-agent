import { beforeEach, describe, expect, it } from 'vitest';
import {
  getChatProviderChoice,
  normalizeChatProviderChoice,
  parseChatProviderChoice,
  setChatProviderChoice,
} from './provider-choice';

function installStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
    configurable: true,
    writable: true,
  });
}

describe('provider-choice', () => {
  beforeEach(() => {
    installStorageMock();
    globalThis.localStorage.clear();
  });

  it('defaults to local', () => {
    expect(getChatProviderChoice()).toBe('local');
    expect(parseChatProviderChoice(null)).toEqual({ providerMode: 'local' });
  });

  it('normalizes invalid values back to local', () => {
    expect(normalizeChatProviderChoice('')).toBe('local');
    expect(normalizeChatProviderChoice('friend:')).toBe('local');
    expect(normalizeChatProviderChoice('cloud')).toBe('local');
  });

  it('persists a friend choice and exposes friend id', () => {
    setChatProviderChoice('friend:user-42');

    expect(getChatProviderChoice()).toBe('friend:user-42');
    expect(parseChatProviderChoice('friend:user-42')).toEqual({
      providerMode: 'friend',
      providerUserId: 'user-42',
    });
  });
});

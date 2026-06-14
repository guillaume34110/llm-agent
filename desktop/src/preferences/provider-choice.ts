const KEY = 'app.chatProviderChoice';

export type ChatProviderChoice = 'local' | `friend:${string}`;

export function normalizeChatProviderChoice(value: string | null | undefined): ChatProviderChoice {
  const raw = (value || '').trim();
  if (raw.startsWith('friend:') && raw.slice('friend:'.length).trim()) {
    return `friend:${raw.slice('friend:'.length).trim()}`;
  }
  return 'local';
}

export function getChatProviderChoice(): ChatProviderChoice {
  try {
    return normalizeChatProviderChoice(localStorage.getItem(KEY));
  } catch {
    return 'local';
  }
}

export function setChatProviderChoice(value: string) {
  const next = normalizeChatProviderChoice(value);
  try {
    localStorage.setItem(KEY, next);
  } catch {}
}

export function parseChatProviderChoice(value: string | null | undefined): {
  providerMode: 'local' | 'friend';
  providerUserId?: string;
} {
  const normalized = normalizeChatProviderChoice(value);
  if (normalized === 'local') {
    return { providerMode: 'local' };
  }
  return {
    providerMode: 'friend',
    providerUserId: normalized.slice('friend:'.length),
  };
}

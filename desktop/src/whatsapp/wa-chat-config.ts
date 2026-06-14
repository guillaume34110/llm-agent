// Per-chat WhatsApp agent config. Local-first: stored in localStorage only.
// Owner chat is forced to full agent capabilities; contacts are opt-in personas
// with restricted tool modes.

export type ChatKind = 'owner' | 'contact';
export type ToolMode = 'full' | 'chat_only' | 'chat_search';

export type ChatConfig = {
  agentEnabled: boolean;
  persona: string;
  toolMode: ToolMode;
  contextFolder: string;
  updatedAt: string;
};

const STORAGE_KEY = 'app.wa.chatConfig.v2';
const PERSONA_MAX = 4000;

const OWNER_CONFIG: ChatConfig = Object.freeze({
  agentEnabled: true,
  persona: '',
  toolMode: 'full',
  contextFolder: '',
  updatedAt: '1970-01-01T00:00:00.000Z',
}) as ChatConfig;

const CONTACT_DEFAULT: ChatConfig = {
  agentEnabled: false,
  persona: '',
  toolMode: 'chat_only',
  contextFolder: '',
  updatedAt: '1970-01-01T00:00:00.000Z',
};

type Store = Record<string, ChatConfig>;
type Listener = (store: Store) => void;

const listeners = new Set<Listener>();

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
  listeners.forEach(l => { try { l(store); } catch {} });
}

function sanitizeConfig(input: Partial<ChatConfig>, base: ChatConfig): ChatConfig {
  const persona = typeof input.persona === 'string'
    ? input.persona.slice(0, PERSONA_MAX)
    : base.persona;
  const toolMode: ToolMode = input.toolMode === 'full' || input.toolMode === 'chat_search' || input.toolMode === 'chat_only'
    ? input.toolMode
    : base.toolMode;
  const agentEnabled = typeof input.agentEnabled === 'boolean' ? input.agentEnabled : base.agentEnabled;
  const contextFolder = typeof input.contextFolder === 'string'
    ? input.contextFolder.trim().slice(0, 1024)
    : base.contextFolder;
  return {
    agentEnabled,
    persona,
    toolMode,
    contextFolder,
    updatedAt: new Date().toISOString(),
  };
}

export function getChatConfig(jid: string, kind: ChatKind): ChatConfig {
  if (kind === 'owner') return { ...OWNER_CONFIG };
  const store = readStore();
  const stored = store[jid];
  if (!stored) return { ...CONTACT_DEFAULT };
  return {
    agentEnabled: typeof stored.agentEnabled === 'boolean' ? stored.agentEnabled : CONTACT_DEFAULT.agentEnabled,
    persona: typeof stored.persona === 'string' ? stored.persona.slice(0, PERSONA_MAX) : '',
    toolMode: stored.toolMode === 'full' || stored.toolMode === 'chat_search' || stored.toolMode === 'chat_only'
      ? stored.toolMode
      : CONTACT_DEFAULT.toolMode,
    contextFolder: typeof stored.contextFolder === 'string' ? stored.contextFolder.slice(0, 1024) : '',
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : CONTACT_DEFAULT.updatedAt,
  };
}

export function setChatConfig(jid: string, kind: ChatKind, patch: Partial<ChatConfig>): ChatConfig {
  if (kind === 'owner') return { ...OWNER_CONFIG };
  const store = readStore();
  const base = store[jid] || { ...CONTACT_DEFAULT };
  const next = sanitizeConfig(patch, base);
  store[jid] = next;
  writeStore(store);
  return next;
}

export function clearChatConfig(jid: string) {
  const store = readStore();
  if (!(jid in store)) return;
  delete store[jid];
  writeStore(store);
}

export function disableAllContacts(): number {
  const store = readStore();
  let count = 0;
  for (const jid of Object.keys(store)) {
    if (store[jid].agentEnabled) {
      store[jid] = { ...store[jid], agentEnabled: false, updatedAt: new Date().toISOString() };
      count += 1;
    }
  }
  if (count > 0) writeStore(store);
  return count;
}

export function listKnownJids(): string[] {
  return Object.keys(readStore());
}

export function snapshotConfigs(): Store {
  return readStore();
}

export function subscribeChatConfigs(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const PERSONA_MAX_CHARS = PERSONA_MAX;

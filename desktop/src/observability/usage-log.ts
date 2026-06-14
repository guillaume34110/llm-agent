export type UsageEntry =
  | { kind: 'tool'; ts: number; name: string; ok: boolean }
  | { kind: 'tokens'; ts: number; model: string; promptTokens: number; completionTokens: number; costCents: number };

const STORAGE_KEY = 'monkey-usage-log';
const MAX_ENTRIES = 500;

let subscribers: Set<() => void> = new Set();
let inMemory: UsageEntry[] = [];
const hasStorage = typeof globalThis !== 'undefined' && globalThis.localStorage;

function getStorage() {
  if (!hasStorage) return inMemory;
  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setStorage(entries: UsageEntry[]) {
  if (!hasStorage) {
    inMemory = entries;
  } else {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      inMemory = entries;
    }
  }
}

export function recordUsage(entry: UsageEntry): void {
  let entries = getStorage();
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  setStorage(entries);
  subscribers.forEach(fn => fn());
}

export function getUsageLog(): UsageEntry[] {
  try {
    return getStorage();
  } catch {
    return [];
  }
}

export function clearUsageLog(): void {
  setStorage([]);
  subscribers.forEach(fn => fn());
}

export function getDailyTokens(days: number = 7): Array<{ dayIso: string; promptTokens: number; completionTokens: number; costCents: number }> {
  const entries = getUsageLog();
  const buckets: Record<string, { promptTokens: number; completionTokens: number; costCents: number }> = {};

  entries.forEach(e => {
    if (e.kind === 'tokens') {
      const dayIso = new Date(e.ts).toISOString().slice(0, 10);
      if (!buckets[dayIso]) {
        buckets[dayIso] = { promptTokens: 0, completionTokens: 0, costCents: 0 };
      }
      buckets[dayIso].promptTokens += e.promptTokens;
      buckets[dayIso].completionTokens += e.completionTokens;
      buckets[dayIso].costCents += e.costCents;
    }
  });

  const now = new Date();
  const result: Array<{ dayIso: string; promptTokens: number; completionTokens: number; costCents: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dayIso = d.toISOString().slice(0, 10);
    result.push({
      dayIso,
      ...buckets[dayIso] || { promptTokens: 0, completionTokens: 0, costCents: 0 },
    });
  }
  return result;
}

export function getRecentTools(limit: number = 50): Array<{ ts: number; name: string; ok: boolean }> {
  const entries = getUsageLog();
  const tools = entries.filter(e => e.kind === 'tool').map(e => e as Extract<UsageEntry, { kind: 'tool' }>);
  return tools.slice(-limit).reverse().map(t => ({ ts: t.ts, name: t.name, ok: t.ok }));
}

export function subscribeUsageLog(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

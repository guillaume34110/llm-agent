import { createLocalStore } from '../lib/local-store';

export interface RecentFileEntry {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  absolutePath?: string | null;
  note?: string;
  lastOpenedAt: string;
}

const store = createLocalStore<RecentFileEntry[]>('monkey-recent-files', []);

export function getRecentFiles() {
  return store.read().sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export function subscribeRecentFiles(listener: (files: RecentFileEntry[]) => void) {
  return store.subscribe(() => listener(getRecentFiles()));
}

export function rememberRecentFile(file: Omit<RecentFileEntry, 'id' | 'lastOpenedAt'> & { id?: string }) {
  const entry: RecentFileEntry = {
    id: file.id || crypto.randomUUID(),
    lastOpenedAt: new Date().toISOString(),
    ...file,
  };
  store.update(prev => {
    const filtered = prev.filter(item => !(
      (entry.absolutePath && item.absolutePath === entry.absolutePath) ||
      (!entry.absolutePath && item.name === entry.name && item.sizeBytes === entry.sizeBytes)
    ));
    return [entry, ...filtered].slice(0, 30);
  });
  return entry;
}

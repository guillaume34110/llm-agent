import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { enqueueJob } from '../jobs/job-service';
import Dropdown from './Dropdown';
import { getEffectiveModelId } from '../preferences/runtime-mode';
import {
  archiveLibraryDocument,
  archiveMemoryItem,
  getLibraryDocumentPreview,
  listLibraryDocuments,
  listMemoryItems,
  searchLibraryDocuments,
  searchMemoryItems,
  summarizeMemoryItems,
  type LibraryDocumentItem,
  type LibraryMemoryItem,
} from '../library/library.service';
import {
  addDocumentsToCollection,
  createCollection,
  deleteCollection,
  listCollections,
  listDocumentsInCollection,
  removeDocumentsFromCollection,
  renameCollection,
  type DocumentCollection,
} from '../library/collections.service';
import { shareCollection, importCollectionFromUrl } from '../library/collection-share';
import { deleteTask, listTasks, listUpcoming, subscribeTasksChanged } from '../tasks/task-client';
import type { TaskItem } from '../types';
import InlineTaskEdit from './InlineTaskEdit';

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

type MemorySort = 'recent' | 'old' | 'type' | 'alpha';
type LibTab = 'memory' | 'tasks' | 'documents';

export default function LibraryView() {
  const { t: tLibrary } = useTranslation();
  const [tab, setTab] = useState<LibTab>('memory');
  const [query, setQuery] = useState('');
  const [memoryItems, setMemoryItems] = useState<LibraryMemoryItem[]>([]);
  const [documents, setDocuments] = useState<LibraryDocumentItem[]>([]);
  const [docPreview, setDocPreview] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('');
  const [docHits, setDocHits] = useState<Array<{ documentId: string; documentTitle: string; content: string; score: number }>>([]);
  const [memSort, setMemSort] = useState<MemorySort>('recent');
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [collections, setCollections] = useState<DocumentCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string>('');
  const [collectionDocs, setCollectionDocs] = useState<LibraryDocumentItem[]>([]);
  const [addMenuDocId, setAddMenuDocId] = useState<string>('');
  const [upcoming, setUpcoming] = useState<TaskItem[]>([]);
  const [finished, setFinished] = useState<TaskItem[]>([]);
  const [expandedTaskId, setExpandedTaskId] = useState<string>('');
  const expandedRef = React.useRef('');
  expandedRef.current = expandedTaskId;
  const upcomingRef = React.useRef<TaskItem[]>([]);
  upcomingRef.current = upcoming;

  useEffect(() => {
    let alive = true;
    const fetchAll = () => {
      listUpcoming(20)
        .then(items => {
          if (!alive) return;
          // Always accept fresh server state. InlineTaskEdit merges its own draft
          // against the new prop to preserve unsaved user edits while letting
          // server-managed fields (nextRunAt, runResult, runHistory, status) refresh.
          setUpcoming(items);
        })
        .catch(() => { if (alive) setUpcoming([]); });
      listTasks()
        .then(items => {
          if (!alive) return;
          const done = items
            .filter(t => t.status === 'done' || t.status === 'cancelled')
            .sort((a, b) => (b.runFinishedAt || b.updatedAt || '').localeCompare(a.runFinishedAt || a.updatedAt || ''))
            .slice(0, 30);
          setFinished(done);
        })
        .catch(() => { if (alive) setFinished([]); });
    };
    fetchAll();
    // Adaptive cadence: poll fast (5s) when any task is mid-run so the inline
    // runLog stream feels live; otherwise fall back to 20s.
    let timer: number = 0;
    const schedule = () => {
      const fast = upcomingRef.current.some(t => t.runStartedAt && !t.runFinishedAt);
      timer = window.setTimeout(() => { fetchAll(); schedule(); }, fast ? 5000 : 20000);
    };
    schedule();
    const unsub = subscribeTasksChanged(fetchAll);
    return () => { alive = false; window.clearTimeout(timer); unsub(); };
  }, []);

  const sortedMemory = React.useMemo(() => {
    const arr = [...memoryItems];
    switch (memSort) {
      case 'recent': arr.sort((a, b) => b.createdAt - a.createdAt); break;
      case 'old': arr.sort((a, b) => a.createdAt - b.createdAt); break;
      case 'type': arr.sort((a, b) => a.type.localeCompare(b.type) || b.createdAt - a.createdAt); break;
      case 'alpha': arr.sort((a, b) => a.content.localeCompare(b.content)); break;
    }
    return arr;
  }, [memoryItems, memSort]);

  const handleSummarize = async () => {
    setSummarizing(true);
    setShowSummary(true);
    setSummary(tLibrary('library.memory.summary.loading'));
    try {
      const modelId = getEffectiveModelId();
      const { summary: text, count } = await summarizeMemoryItems(modelId || undefined);
      setSummary(`_(${tLibrary('library.memory.summary.analyzed', { count })})_\n\n${text}`);
    } finally {
      setSummarizing(false);
    }
  };

  const reload = useCallback(async () => {
    if (query.trim()) {
      const [mem, hits] = await Promise.all([
        searchMemoryItems(query.trim(), 20),
        searchLibraryDocuments(query.trim(), 12),
      ]);
      setMemoryItems(mem.map(item => ({
        id: item.id,
        content: item.content,
        type: item.type,
        tags: item.tags,
        sessionId: item.sessionId,
        createdAt: item.createdAt,
      })));
      setDocHits(hits);
      setDocuments([]);
      return;
    }
    const [mem, docs] = await Promise.all([
      listMemoryItems(30),
      listLibraryDocuments(30),
    ]);
    setMemoryItems(mem);
    setDocuments(docs);
    setDocHits([]);
  }, [query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reloadCollections = useCallback(async () => {
    try {
      setCollections(await listCollections());
    } catch {
      setCollections([]);
    }
  }, []);

  useEffect(() => {
    void reloadCollections();
  }, [reloadCollections]);

  useEffect(() => {
    if (!activeCollectionId) {
      setCollectionDocs([]);
      return;
    }
    listDocumentsInCollection(activeCollectionId)
      .then(setCollectionDocs)
      .catch(() => setCollectionDocs([]));
  }, [activeCollectionId, collections]);

  const handleNewCollection = async () => {
    const name = window.prompt(tLibrary('library.collections.prompt.name'));
    if (!name || !name.trim()) return;
    await createCollection(name.trim());
    await reloadCollections();
  };

  const handleRenameCollection = async (c: DocumentCollection) => {
    const next = window.prompt(tLibrary('library.collections.prompt.rename'), c.name);
    if (!next || !next.trim() || next.trim() === c.name) return;
    await renameCollection(c.id, next.trim());
    await reloadCollections();
  };

  const handleDeleteCollection = async (c: DocumentCollection) => {
    if (!window.confirm(tLibrary('library.collections.confirm.delete', { name: c.name }))) return;
    await deleteCollection(c.id);
    if (activeCollectionId === c.id) setActiveCollectionId('');
    await reloadCollections();
  };

  const handleAddToCollection = async (collectionId: string, docId: string) => {
    await addDocumentsToCollection(collectionId, [docId]);
    setAddMenuDocId('');
    await reloadCollections();
  };

  const handleShareActiveCollection = async () => {
    if (!activeCollectionId) return;
    try {
      const res = await shareCollection(activeCollectionId);
      await navigator.clipboard.writeText(res.url);
      window.alert(tLibrary('library.collections.share.copied', { count: res.docCount }));
    } catch (e: any) {
      window.alert(tLibrary('library.collections.share.failed', { error: String(e?.message || e) }));
    }
  };

  const handleImportCollection = async () => {
    const url = window.prompt(tLibrary('library.collections.import.prompt'));
    if (!url || !url.trim()) return;
    try {
      const res = await importCollectionFromUrl(url.trim());
      const vectors = res.vectorsKept
        ? tLibrary('library.collections.import.vectors.kept')
        : tLibrary('library.collections.import.vectors.dropped');
      window.alert(tLibrary('library.collections.import.done', { count: res.imported, vectors }));
      await reloadCollections();
      setActiveCollectionId(res.collectionId);
    } catch (e: any) {
      window.alert(tLibrary('library.collections.import.failed', { error: String(e?.message || e) }));
    }
  };

  const handleRemoveFromActive = async (docId: string) => {
    if (!activeCollectionId) return;
    await removeDocumentsFromCollection(activeCollectionId, [docId]);
    await reloadCollections();
    setCollectionDocs(prev => prev.filter(d => d.id !== docId));
  };

  useEffect(() => {
    if (!selectedDocId) {
      setDocPreview('');
      return;
    }
    getLibraryDocumentPreview(selectedDocId)
      .then(text => setDocPreview(text.slice(0, 5000)))
      .catch(() => setDocPreview(''));
  }, [selectedDocId]);

  const importFiles = async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      title: tLibrary('library.import.dialog.title'),
    });
    if (!selected) return;
    const paths = (Array.isArray(selected) ? selected : [selected]).map(String);
    enqueueJob('import-kb', `Import KB (${paths.length})`, { paths });
  };

  return (
    <div className="flex flex-1 min-h-0 relative isolate">
      <div className="flex flex-1 min-w-0 flex-col border-r border-[var(--border)] bg-[var(--bg2)] relative z-10">
        <div className="grid gap-[10px] border-b border-[var(--border)] p-[18px]">
          <div>
            <div className="text-[18px] font-black text-[var(--text)]">{tLibrary('library.title')}</div>
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">{tLibrary('library.subtitle')}</div>
          </div>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={tLibrary('library.search.placeholder')}
            className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg3)] px-[12px] py-[10px] font-[Nunito] text-[var(--text)]"
          />
          <button
            onClick={importFiles}
            className="rounded-[var(--r)] border border-[var(--accent)] bg-[var(--accent-soft)] px-[12px] py-[10px] cursor-pointer font-extrabold font-[Nunito] text-[var(--accent)]"
          >
            {tLibrary('library.import.button')}
          </button>
        </div>

        <div className="flex gap-1 px-[18px] pt-[12px] pb-0 border-b border-[var(--border)]">
          {([
            { id: 'memory' as LibTab, label: tLibrary('library.tab.memory'), count: sortedMemory.length },
            { id: 'tasks' as LibTab, label: tLibrary('library.tab.tasks'), count: upcoming.length + finished.length },
            { id: 'documents' as LibTab, label: tLibrary('library.tab.documents'), count: activeCollectionId ? collectionDocs.length : (docHits.length || documents.length) },
          ]).map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-[14px] py-[8px] text-[12px] font-[Nunito] cursor-pointer border-b-2 -mb-[1px] ${active ? 'border-[var(--accent)] text-[var(--accent)] font-bold' : 'border-transparent text-[var(--text-muted)] font-semibold hover:text-[var(--text)]'}`}
              >
                {t.label} <span className="opacity-60">({t.count})</span>
              </button>
            );
          })}
        </div>

        <div className="grid gap-[18px] overflow-auto p-[18px]">
          {tab === 'memory' && (
          <section>
            <div className="mb-[10px] flex items-center gap-2">
              <div className="flex-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-dim)]">
                {tLibrary('library.tab.memory')} ({sortedMemory.length})
              </div>
              <Dropdown
                value={memSort}
                onChange={v => setMemSort(v as MemorySort)}
                options={[
                  { value: 'recent', label: tLibrary('library.memory.sort.recent') },
                  { value: 'old', label: tLibrary('library.memory.sort.old') },
                  { value: 'type', label: tLibrary('library.memory.sort.type') },
                  { value: 'alpha', label: tLibrary('library.memory.sort.alpha') },
                ]}
                width={120}
                fontSize={11}
                buttonPadding="4px 8px"
              />
            </div>
            <button
              onClick={handleSummarize}
              disabled={summarizing || sortedMemory.length === 0}
              style={{
                background: summarizing ? 'var(--bg3)' : 'var(--accent-soft)',
                cursor: summarizing || sortedMemory.length === 0 ? 'default' : 'pointer',
                opacity: sortedMemory.length === 0 ? 0.5 : 1,
              }}
              className="mb-[10px] w-full rounded-[var(--r)] border border-[var(--accent)] px-[12px] py-[8px] font-extrabold font-[Nunito] text-[12px] text-[var(--accent)]"
            >
              {summarizing ? tLibrary('library.memory.summary.button.loading') : tLibrary('library.memory.summary.button.idle')}
            </button>
            <div className="grid gap-[10px]">
              {sortedMemory.map(item => (
                <div key={item.id} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg3)] p-3">
                  <div className="text-[12.5px] leading-[1.6] text-[var(--text)]">{item.content.slice(0, 220)}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10.5px] text-[var(--text-dim)]">{item.type}</span>
                    <div className="flex-1" />
                    <button
                      onClick={() => archiveMemoryItem(item.id).then(() => reload())}
                      className="border-none bg-transparent cursor-pointer text-[11.5px] font-bold text-[var(--red)]"
                    >
                      {tLibrary('library.memory.archive.button')}
                    </button>
                  </div>
                </div>
              ))}
              {sortedMemory.length === 0 && <div className="text-[12.5px] text-[var(--text-dim)]">{tLibrary('library.memory.empty')}</div>}
            </div>
          </section>
          )}

          {tab === 'tasks' && (<>
          <section>
            <div className="mb-[10px] text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-dim)]">
              {tLibrary('library.tasks.upcoming.header', { count: upcoming.length })}
            </div>
            <div className="grid gap-2">
              {upcoming.map(task => {
                const isAgent = !!task.agentPrompt;
                const isRecurring = !!task.recurrence;
                const expanded = expandedTaskId === task.id;
                return (
                  <div
                    key={task.id}
                    style={{
                      borderColor: isRecurring ? 'var(--accent-2)' : 'var(--border)',
                      borderLeftColor: isRecurring ? 'var(--accent-2)' : 'var(--border)',
                      background: isRecurring ? 'var(--accent-2-soft)' : 'var(--bg3)',
                    }}
                    className="rounded-[var(--r)] border p-[10px]"
                  >
                    <button
                      onClick={() => setExpandedTaskId(expanded ? '' : task.id)}
                      className="flex w-full items-center gap-2 border-none bg-transparent p-0 text-left cursor-pointer"
                    >
                      <div className="min-w-[78px] text-[11px] tabular-nums text-[var(--text-dim)]">
                        {formatWhen(task.nextRunAt || task.scheduledFor)}
                      </div>
                      <div className="flex-1 truncate text-[12.5px] font-bold text-[var(--text)]">
                        {task.title}
                      </div>
                      {isRecurring && (
                        <span className="rounded border border-[var(--accent-2)] px-[5px] py-[1px] text-[9.5px] font-extrabold tracking-[0.04em] text-[var(--accent-2)]">
                          RÉCURRENT
                        </span>
                      )}
                      {isAgent && (
                        <span className="rounded border border-[var(--accent)] px-[5px] py-[1px] text-[9.5px] font-extrabold tracking-[0.04em] text-[var(--accent)]">
                          AGENT
                        </span>
                      )}
                    </button>
                    {expanded && (
                      <InlineTaskEdit
                        task={task}
                        onSaved={updated => setUpcoming(prev => prev.map(t => t.id === updated.id ? updated : t))}
                        onDelete={() => {
                          deleteTask(task.id)
                            .then(() => setUpcoming(prev => prev.filter(t => t.id !== task.id)))
                            .catch(() => {});
                        }}
                      />
                    )}
                  </div>
                );
              })}
              {upcoming.length === 0 && <div className="text-[12.5px] text-[var(--text-dim)]">{tLibrary('library.tasks.upcoming.empty')}</div>}
            </div>
          </section>

          <section>
            <div className="mb-[10px] text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-dim)]">
              {tLibrary('library.tasks.finished.header', { count: finished.length })}
            </div>
            <div className="grid gap-2">
              {finished.map(task => {
                const expanded = expandedTaskId === task.id;
                const cancelled = task.status === 'cancelled';
                return (
                  <div
                    key={task.id}
                    style={{ opacity: cancelled ? 0.7 : 1 }}
                    className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg3)] p-[10px]"
                  >
                    <button
                      onClick={() => setExpandedTaskId(expanded ? '' : task.id)}
                      className="flex w-full items-center gap-2 border-none bg-transparent p-0 text-left cursor-pointer"
                    >
                      <div className="min-w-[78px] text-[11px] tabular-nums text-[var(--text-dim)]">
                        {formatWhen(task.runFinishedAt || task.scheduledFor)}
                      </div>
                      <div className="flex-1 truncate text-[12.5px] font-bold text-[var(--text)]">
                        {task.title}
                      </div>
                      <span style={{ color: cancelled ? 'var(--red)' : 'var(--text-dim)', borderColor: cancelled ? 'var(--red)' : 'var(--border)' }} className="rounded border px-[5px] py-[1px] text-[9.5px] font-extrabold tracking-[0.04em]">
                        {cancelled ? tLibrary('library.tasks.finished.status.failed') : tLibrary('library.tasks.finished.status.ok')}
                      </span>
                    </button>
                    {expanded && (
                      <InlineTaskEdit
                        task={task}
                        onSaved={updated => setFinished(prev => prev.map(t => t.id === updated.id ? updated : t))}
                        onDelete={() => {
                          deleteTask(task.id)
                            .then(() => setFinished(prev => prev.filter(t => t.id !== task.id)))
                            .catch(() => {});
                        }}
                      />
                    )}
                  </div>
                );
              })}
              {finished.length === 0 && <div className="text-[12.5px] text-[var(--text-dim)]">{tLibrary('library.tasks.finished.empty')}</div>}
            </div>
          </section>
          </>)}

          {tab === 'documents' && (
          <section>
            <div className="mb-[10px] flex items-center gap-2">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-dim)] flex-1">
                {tLibrary('library.collections.header')}
              </div>
              <button
                onClick={handleImportCollection}
                className="rounded-[6px] border border-[var(--border)] bg-[var(--bg3)] text-[var(--text-muted)] px-[8px] py-[3px] text-[11px] font-extrabold cursor-pointer"
              >
                {tLibrary('library.collections.import')}
              </button>
              <button
                onClick={handleNewCollection}
                className="rounded-[6px] border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] px-[8px] py-[3px] text-[11px] font-extrabold cursor-pointer"
              >
                + {tLibrary('library.collections.new')}
              </button>
            </div>
            <div className="mb-[14px] flex flex-wrap gap-[6px]">
              <button
                onClick={() => setActiveCollectionId('')}
                style={{
                  borderColor: !activeCollectionId ? 'var(--accent)' : 'var(--border)',
                  color: !activeCollectionId ? 'var(--accent)' : 'var(--text-muted)',
                }}
                className="rounded-[6px] border bg-[var(--bg3)] px-[10px] py-[4px] text-[11.5px] font-bold cursor-pointer"
              >
                {tLibrary('library.collections.all')} ({docHits.length || documents.length})
              </button>
              {collections.map(c => {
                const active = activeCollectionId === c.id;
                return (
                  <div key={c.id} className="flex items-center gap-1">
                    <button
                      onClick={() => setActiveCollectionId(c.id)}
                      onDoubleClick={() => handleRenameCollection(c)}
                      title={tLibrary('library.collections.dblclick.rename')}
                      style={{
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                        color: active ? 'var(--accent)' : 'var(--text)',
                      }}
                      className="rounded-[6px] border bg-[var(--bg3)] px-[10px] py-[4px] text-[11.5px] font-bold cursor-pointer"
                    >
                      {c.name} <span className="opacity-60">({c.documentCount})</span>
                    </button>
                    {active && (
                      <>
                        <button
                          onClick={handleShareActiveCollection}
                          title={tLibrary('library.collections.share')}
                          className="rounded-[6px] border border-[var(--border)] bg-[var(--bg3)] px-[6px] py-[2px] text-[11px] text-[var(--accent)] cursor-pointer"
                        >
                          ↗
                        </button>
                        <button
                          onClick={() => handleDeleteCollection(c)}
                          title={tLibrary('library.collections.delete')}
                          className="rounded-[6px] border border-[var(--border)] bg-[var(--bg3)] px-[6px] py-[2px] text-[11px] text-[var(--red)] cursor-pointer"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mb-[10px] text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-dim)]">
              {activeCollectionId
                ? `${collections.find(c => c.id === activeCollectionId)?.name ?? ''} (${collectionDocs.length})`
                : tLibrary('library.documents.header')}
            </div>
            <div className="grid gap-[10px]">
              {(() => {
                const items = activeCollectionId
                  ? collectionDocs
                  : (docHits.length > 0
                    ? docHits.map(hit => ({
                        id: hit.documentId,
                        title: hit.documentTitle,
                        source: 'search',
                        mimeType: 'text/plain',
                        sizeBytes: hit.content.length,
                        tags: [] as string[],
                        createdAt: 0,
                      }))
                    : documents);
                if (!items.length) {
                  return <div className="text-[12.5px] text-[var(--text-dim)]">{tLibrary('library.documents.empty')}</div>;
                }
                return items.map(doc => (
                  <div
                    key={doc.id}
                    style={{ borderColor: selectedDocId === doc.id ? 'var(--accent)' : 'var(--border)' }}
                    className="rounded-[var(--r)] border bg-[var(--bg3)] p-3 flex items-start gap-2 relative"
                  >
                    <button
                      onClick={() => setSelectedDocId(doc.id)}
                      className="flex-1 text-left cursor-pointer bg-transparent border-none p-0"
                    >
                      <div className="text-[12.5px] font-extrabold text-[var(--text)]">{doc.title}</div>
                      <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">{doc.source}</div>
                    </button>
                    {activeCollectionId ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleRemoveFromActive(doc.id); }}
                        title={tLibrary('library.collections.remove')}
                        className="rounded-[6px] border border-[var(--border)] bg-[var(--bg2)] px-[8px] py-[3px] text-[11px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--red)]"
                      >
                        −
                      </button>
                    ) : (
                      <div className="relative">
                        <button
                          onClick={(e) => { e.stopPropagation(); setAddMenuDocId(addMenuDocId === doc.id ? '' : doc.id); }}
                          title={tLibrary('library.collections.addTo')}
                          className="rounded-[6px] border border-[var(--border)] bg-[var(--bg2)] px-[8px] py-[3px] text-[11px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--accent)]"
                        >
                          +
                        </button>
                        {addMenuDocId === doc.id && (
                          <div className="absolute right-0 top-full mt-1 z-10 min-w-[180px] rounded-[6px] border border-[var(--border)] bg-[var(--bg2)] shadow-lg py-1">
                            {collections.length === 0 && (
                              <div className="px-3 py-2 text-[11.5px] text-[var(--text-dim)]">
                                {tLibrary('library.collections.menu.empty')}
                              </div>
                            )}
                            {collections.map(c => (
                              <button
                                key={c.id}
                                onClick={(e) => { e.stopPropagation(); void handleAddToCollection(c.id, doc.id); }}
                                className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg3)] cursor-pointer bg-transparent border-none"
                              >
                                {c.name}
                              </button>
                            ))}
                            <div className="border-t border-[var(--border)] mt-1 pt-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAddMenuDocId('');
                                  void (async () => {
                                    const name = window.prompt(tLibrary('library.collections.prompt.name'));
                                    if (!name || !name.trim()) return;
                                    const created = await createCollection(name.trim());
                                    await addDocumentsToCollection(created.id, [doc.id]);
                                    await reloadCollections();
                                  })();
                                }}
                                className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--accent)] hover:bg-[var(--bg3)] cursor-pointer bg-transparent border-none font-extrabold"
                              >
                                + {tLibrary('library.collections.new')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          </section>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-w-0 flex-col relative z-10">
        <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg2)] px-5 py-[18px]">
          <div className="flex-1">
            <div className="text-[16px] font-black text-[var(--text)]">
              {showSummary ? tLibrary('library.preview.title.summary') : selectedDocId ? tLibrary('library.preview.title.document') : tLibrary('library.preview.title.empty')}
            </div>
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">
              {showSummary
                ? tLibrary('library.preview.description.summary')
                : tLibrary('library.preview.description.default')}
            </div>
          </div>
          {showSummary && (
            <button
              onClick={() => { setShowSummary(false); setSummary(''); }}
              className="rounded-[var(--r)] border border-[var(--border)] bg-transparent px-[10px] py-2 font-bold text-[var(--text-muted)] cursor-pointer"
            >
              {tLibrary('library.preview.close.button')}
            </button>
          )}
          {!showSummary && selectedDocId && (
            <button
              onClick={() => archiveLibraryDocument(selectedDocId).then(() => { setSelectedDocId(''); void reload(); })}
              className="rounded-[var(--r)] border border-[var(--border)] bg-transparent px-[10px] py-2 font-bold text-[var(--red)] cursor-pointer"
            >
              {tLibrary('library.documents.archive.button')}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto p-5">
          {showSummary ? (
            <pre className="m-0 whitespace-pre-wrap leading-[1.7] text-[13px] font-[Nunito] text-[var(--text)]">
              {summary || tLibrary('library.preview.loading')}
            </pre>
          ) : selectedDocId ? (
            <pre className="m-0 whitespace-pre-wrap leading-[1.7] text-[13px] font-[Nunito] text-[var(--text)]">
              {docPreview || tLibrary('library.preview.loading')}
            </pre>
          ) : (
            <div className="rounded-[var(--rm)] border border-dashed border-[var(--border)] p-7 text-[13px] text-[var(--text-dim)] relative isolate overflow-hidden min-h-[200px]">
              <div className="relative z-10">{tLibrary('library.preview.empty.message')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

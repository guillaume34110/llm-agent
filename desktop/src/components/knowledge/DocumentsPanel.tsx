import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  FilePlus, FileText, Trash2, FolderPlus, Maximize2, Minimize2,
  CheckSquare, Square, X, Loader2, CircleDot, Pencil, Tag,
  ArrowDownUp, Filter, Copy, Database, ChevronDown, ChevronUp,
  Archive, ArchiveRestore, AlertTriangle,
} from 'lucide-react';
import { enqueueJob, subscribeJobs, type BackgroundJob } from '../../jobs/job-service';
import {
  archiveLibraryDocument,
  countArchivedLibraryDocuments,
  deleteLibraryDocument,
  deleteManyLibraryDocuments,
  findLibraryDuplicates,
  getLibraryDocumentPreview,
  getLibraryStats,
  listAllLibraryTags,
  listArchivedLibraryDocuments,
  listLibraryDocuments,
  renameLibraryDocument,
  restoreLibraryDocument,
  searchLibraryDocuments,
  setLibraryDocumentTags,
  type LibraryDocumentItem,
} from '../../library/library.service';
import {
  addDocumentsToCollection,
  createCollection,
  listCollections,
  type DocumentCollection,
} from '../../library/collections.service';
import { knowledgeService } from '../../memory/knowledge.service';
import { GlassPromptModal, GlassConfirmModal } from '../GlassModal';

interface Props {
  query: string;
}

interface KbStatus {
  totalChunks: number;
  vectorizedChunks: number;
  isActive: boolean;
  isConfigured: boolean;
}

type SortKey = 'recent' | 'title' | 'size';

interface DocItem extends LibraryDocumentItem {
  snippet?: string;
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function formatRelative(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q.trim()) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase()
      ? <mark key={i} className="bg-[var(--accent-soft)] text-[var(--accent)] font-bold rounded-sm px-0.5">{p}</mark>
      : <span key={i}>{p}</span>,
  );
}

export default function DocumentsPanel({ query }: Props) {
  const [docs, setDocs] = useState<LibraryDocumentItem[]>([]);
  const [hits, setHits] = useState<Array<{ documentId: string; documentTitle: string; content: string; score: number }>>([]);
  const [collections, setCollections] = useState<DocumentCollection[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [preview, setPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [addMenuFor, setAddMenuFor] = useState('');
  const [bulkAddMenu, setBulkAddMenu] = useState(false);
  const [askNewCollection, setAskNewCollection] = useState<{ docId?: string; bulk?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string>('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const [importJobs, setImportJobs] = useState<BackgroundJob[]>([]);
  const [kbStatus, setKbStatus] = useState<KbStatus | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [sortMenu, setSortMenu] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [askRename, setAskRename] = useState<{ id: string; title: string } | null>(null);
  const [askTags, setAskTags] = useState<LibraryDocumentItem | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [tagsBeingEdited, setTagsBeingEdited] = useState<string[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getLibraryStats>> | null>(null);
  const [duplicates, setDuplicates] = useState<Awaited<ReturnType<typeof findLibraryDuplicates>>>([]);
  const [showDupModal, setShowDupModal] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [dupBusy, setDupBusy] = useState<string>('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [archivedCount, setArchivedCount] = useState(0);
  const [confirmHardDelete, setConfirmHardDelete] = useState<string>('');
  const [confirmBulkHardDelete, setConfirmBulkHardDelete] = useState(false);

  const reload = useCallback(async () => {
    if (view === 'archived') {
      setDocs(await listArchivedLibraryDocuments(200));
      setHits([]);
    } else if (query.trim()) {
      setHits(await searchLibraryDocuments(query.trim(), 30));
      setDocs([]);
    } else {
      setDocs(await listLibraryDocuments(200));
      setHits([]);
    }
  }, [query, view]);

  const reloadArchivedCount = useCallback(async () => {
    try { setArchivedCount(await countArchivedLibraryDocuments()); } catch { setArchivedCount(0); }
  }, []);

  const reloadTags = useCallback(async () => {
    try { setAllTags(await listAllLibraryTags()); } catch { setAllTags([]); }
  }, []);

  const reloadCollections = useCallback(async () => {
    try { setCollections(await listCollections()); } catch { setCollections([]); }
  }, []);

  const reloadStats = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([getLibraryStats(), findLibraryDuplicates()]);
      setStats(s);
      setDuplicates(d);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void reloadCollections(); }, [reloadCollections]);
  useEffect(() => { void reloadTags(); }, [reloadTags]);
  useEffect(() => { void reloadStats(); }, [reloadStats]);
  useEffect(() => { void reloadArchivedCount(); }, [reloadArchivedCount]);

  useEffect(() => {
    if (!selectedId) { setPreview(''); setPreviewLoading(false); return; }
    setPreviewLoading(true);
    getLibraryDocumentPreview(selectedId)
      .then(text => setPreview(text))
      .catch(() => setPreview(''))
      .finally(() => setPreviewLoading(false));
  }, [selectedId]);

  // KB indexing status poll.
  useEffect(() => {
    let cancel = false;
    const fetch = async () => {
      try {
        const s = await knowledgeService.getStatus();
        if (!cancel) setKbStatus(s);
      } catch { /* ignore */ }
    };
    void fetch();
    const id = setInterval(fetch, 5000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  // Subscribe to import jobs; auto-reload on completion.
  useEffect(() => {
    let prevRunning = 0;
    return subscribeJobs(jobs => {
      const imports = jobs.filter(j => j.kind === 'import-kb');
      const running = imports.filter(j => j.status === 'pending' || j.status === 'running');
      setImportJobs(running);
      if (running.length < prevRunning) { void reload(); void reloadStats(); }
      prevRunning = running.length;
    });
  }, [reload, reloadStats]);

  // Close popovers on outside click.
  useEffect(() => {
    if (!sortMenu && !bulkAddMenu && !addMenuFor) return;
    const handler = () => {
      setSortMenu(false);
      setBulkAddMenu(false);
      setAddMenuFor('');
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [sortMenu, bulkAddMenu, addMenuFor]);

  // OS-level drag-drop file import (Tauri v2).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let active = true;
    (async () => {
      try {
        const u = await getCurrentWebview().onDragDropEvent(event => {
          if (!active) return;
          const t = (event.payload as any).type;
          if (t === 'over' || t === 'enter') setDragOver(true);
          else if (t === 'leave') setDragOver(false);
          else if (t === 'drop') {
            setDragOver(false);
            const paths = ((event.payload as any).paths as string[] | undefined) || [];
            if (paths.length > 0) enqueueJob('import-kb', `Import KB (${paths.length})`, { paths });
          }
        });
        unlisten = u;
      } catch { /* no-op outside Tauri */ }
    })();
    return () => { active = false; if (unlisten) unlisten(); };
  }, []);

  const items = useMemo<DocItem[]>(() => {
    if (hits.length > 0) {
      // Dedupe by documentId, keep best (first = highest score) snippet.
      const seen = new Map<string, DocItem>();
      for (const h of hits) {
        if (seen.has(h.documentId)) continue;
        seen.set(h.documentId, {
          id: h.documentId,
          title: h.documentTitle,
          source: 'search',
          mimeType: 'text/plain',
          sizeBytes: 0,
          tags: [],
          createdAt: 0,
          snippet: h.content,
        });
      }
      return Array.from(seen.values());
    }
    let out: DocItem[] = docs;
    if (tagFilter) out = out.filter(d => d.tags.includes(tagFilter));
    const sorted = [...out];
    if (sortKey === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortKey === 'size') sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
    else sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  }, [hits, docs, sortKey, tagFilter]);

  // Keep refs of mutable values needed inside the global keydown handler.
  const itemsRef = useRef(items); itemsRef.current = items;
  const selectedIdsRef = useRef(selectedIds); selectedIdsRef.current = selectedIds;
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const fullscreenRef = useRef(fullscreen); fullscreenRef.current = fullscreen;
  const viewRef = useRef(view); viewRef.current = view;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || !!tgt?.isContentEditable;
      if (e.key === 'Escape') {
        if (fullscreenRef.current) { setFullscreen(false); return; }
        if (selectedIdsRef.current.size > 0) { setSelectedIds(new Set()); return; }
        if (selectedIdRef.current) { setSelectedId(''); return; }
        return;
      }
      if (editable) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        setSelectedIds(new Set(itemsRef.current.map(d => d.id)));
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.size > 0) {
        e.preventDefault();
        if (viewRef.current === 'archived') setConfirmBulkHardDelete(true);
        else setConfirmBulkDelete(true);
        return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleImport = async () => {
    const selected = await openDialog({ multiple: true, directory: false, title: 'Import documents' });
    if (!selected) return;
    const paths = (Array.isArray(selected) ? selected : [selected]).map(String);
    enqueueJob('import-kb', `Import KB (${paths.length})`, { paths });
  };

  const toggleSelect = (id: string, shift: boolean, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shift && lastClickedId) {
        const a = items.findIndex(i => i.id === lastClickedId);
        const b = items.findIndex(i => i.id === id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(items[i].id);
        } else {
          next.has(id) ? next.delete(id) : next.add(id);
        }
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    setLastClickedId(id);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length && items.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map(d => d.id)));
  };

  const runBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    setConfirmBulkDelete(false);
    setSelectedIds(new Set());
    await Promise.all(ids.map(id => archiveLibraryDocument(id).catch(() => null)));
    if (ids.includes(selectedId)) setSelectedId('');
    await reload();
    await reloadStats();
    await reloadArchivedCount();
  };

  const runBulkRestore = async () => {
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    await Promise.all(ids.map(id => restoreLibraryDocument(id).catch(() => null)));
    if (ids.includes(selectedId)) setSelectedId('');
    await reload();
    await reloadStats();
    await reloadArchivedCount();
    await reloadTags();
  };

  const runBulkHardDelete = async () => {
    const ids = Array.from(selectedIds);
    setConfirmBulkHardDelete(false);
    setSelectedIds(new Set());
    try { await deleteManyLibraryDocuments(ids); } catch { /* ignore */ }
    if (ids.includes(selectedId)) setSelectedId('');
    await reload();
    await reloadStats();
    await reloadArchivedCount();
  };

  const runRestoreOne = async (id: string) => {
    await restoreLibraryDocument(id);
    if (selectedId === id) setSelectedId('');
    await reload();
    await reloadStats();
    await reloadArchivedCount();
    await reloadTags();
  };

  const archiveDuplicate = async (groupKey: string, docId: string) => {
    setDupBusy(docId);
    try {
      await archiveLibraryDocument(docId);
      setDuplicates(prev => prev
        .map(g => g.key === groupKey ? { ...g, docs: g.docs.filter(d => d.id !== docId) } : g)
        .filter(g => g.docs.length >= 2));
      if (selectedId === docId) setSelectedId('');
      await reload();
      await reloadStats();
      await reloadArchivedCount();
    } finally {
      setDupBusy('');
    }
  };

  const archiveOlderInGroup = async (groupKey: string) => {
    const group = duplicates.find(g => g.key === groupKey);
    if (!group) return;
    const sorted = [...group.docs].sort((a, b) => b.createdAt - a.createdAt);
    const olderIds = sorted.slice(1).map(d => d.id);
    if (!olderIds.length) return;
    setDupBusy(groupKey);
    try {
      await Promise.all(olderIds.map(id => archiveLibraryDocument(id).catch(() => null)));
      if (olderIds.includes(selectedId)) setSelectedId('');
      await reload();
      await reloadStats();
      await reloadArchivedCount();
    } finally {
      setDupBusy('');
    }
  };

  const runBulkAddToCollection = async (collectionId: string) => {
    const ids = Array.from(selectedIds);
    setBulkAddMenu(false);
    await addDocumentsToCollection(collectionId, ids);
    setSelectedIds(new Set());
    await reloadCollections();
  };

  const openTagsEditor = (doc: LibraryDocumentItem) => {
    setAskTags(doc);
    setTagsBeingEdited([...doc.tags]);
    setTagDraft('');
  };

  const commitTagDraft = () => {
    const v = tagDraft.trim();
    if (!v) return;
    if (!tagsBeingEdited.includes(v)) setTagsBeingEdited(prev => [...prev, v]);
    setTagDraft('');
  };

  const saveTags = async () => {
    if (!askTags) return;
    const docId = askTags.id;
    const tags = tagsBeingEdited;
    setAskTags(null);
    await setLibraryDocumentTags(docId, tags);
    await reload();
    await reloadTags();
    await reloadStats();
  };

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const hasSelection = selectedIds.size > 0;

  const SORT_LABELS: Record<SortKey, string> = {
    recent: 'Recent',
    title: 'Title (A→Z)',
    size: 'Size',
  };

  const indexingPct = kbStatus && kbStatus.totalChunks > 0
    ? Math.round((kbStatus.vectorizedChunks / kbStatus.totalChunks) * 100)
    : null;

  return (
    <div className="max-w-[1100px] mx-auto flex gap-4 min-h-0 relative">
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[10.5px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)]">
            Documents ({items.length})
          </div>
          {(archivedCount > 0 || view === 'archived') && (
            <div className="flex items-center gap-0.5 ml-1 p-0.5 rounded-full bg-[var(--glass-bg-strong)]">
              <button
                onClick={() => { setView('active'); setSelectedIds(new Set()); setSelectedId(''); }}
                className={`px-2.5 h-[20px] rounded-full text-[10.5px] font-black ${
                  view === 'active'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                Active
              </button>
              <button
                onClick={() => { setView('archived'); setSelectedIds(new Set()); setSelectedId(''); }}
                title="Archived documents"
                className={`flex items-center gap-1 px-2.5 h-[20px] rounded-full text-[10.5px] font-black ${
                  view === 'archived'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                <Archive size={10} strokeWidth={2.6} />
                Archived ({archivedCount})
              </button>
            </div>
          )}
          {kbStatus && kbStatus.isConfigured && view === 'active' && (
            <div
              title={kbStatus.isActive
                ? `Indexing in progress — ${kbStatus.vectorizedChunks}/${kbStatus.totalChunks} chunks`
                : `Index ready — ${kbStatus.totalChunks} chunks`}
              className="flex items-center gap-1.5 px-2 h-[22px] rounded-full text-[10.5px] font-bold border border-[var(--glass-border)]"
              style={{
                color: kbStatus.isActive ? 'var(--accent)' : kbStatus.totalChunks > 0 ? 'var(--text-muted)' : 'var(--text-dim)',
              }}
            >
              {kbStatus.isActive
                ? <Loader2 size={10} strokeWidth={2.4} className="animate-spin" />
                : <CircleDot size={10} strokeWidth={2.4} />}
              {kbStatus.isActive
                ? (indexingPct !== null ? `Indexing ${indexingPct}%` : 'Indexing…')
                : kbStatus.totalChunks > 0 ? `${kbStatus.totalChunks} chunks` : 'Empty'}
            </div>
          )}
          <div className="flex-1" />
          {!query.trim() && (
            <div className="relative">
              <button
                onClick={e => { e.stopPropagation(); setSortMenu(v => !v); }}
                title="Sort"
                className="flex items-center gap-1.5 px-2 h-[26px] rounded-full text-[11px] font-bold text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
              >
                <ArrowDownUp size={11} strokeWidth={2.4} />
                {SORT_LABELS[sortKey]}
              </button>
              {sortMenu && (
                <div
                  onClick={e => e.stopPropagation()}
                  className="absolute right-0 top-full mt-1 z-30 min-w-[160px] glass-card-strong py-1"
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                    <button
                      key={k}
                      onClick={() => { setSortKey(k); setSortMenu(false); }}
                      className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--glass-bg-strong)] bg-transparent border-none ${k === sortKey ? 'text-[var(--accent)] font-black' : 'text-[var(--text)]'}`}
                    >
                      {SORT_LABELS[k]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {items.length > 0 && (
            <button
              onClick={toggleSelectAll}
              title={allSelected ? 'Clear selection (Esc)' : 'Select all (Cmd+A)'}
              className="flex items-center gap-1.5 px-2 h-[26px] rounded-full text-[11px] font-bold text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
            >
              {allSelected
                ? <CheckSquare size={12} strokeWidth={2.4} />
                : <Square size={12} strokeWidth={2.4} />}
              {allSelected ? 'All' : 'Select'}
            </button>
          )}
          {view === 'active' && (
            <button
              onClick={handleImport}
              className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
            >
              <FilePlus size={11} strokeWidth={2.6} />
              Import
            </button>
          )}
        </div>

        {/* Archive warning banner */}
        {view === 'archived' && (
          <div className="mb-3 glass-card px-3 py-2 flex items-center gap-2 border-l-[3px]" style={{ borderLeftColor: 'var(--accent)' }}>
            <AlertTriangle size={12} strokeWidth={2.4} className="text-[var(--accent)] flex-shrink-0" />
            <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.45] flex-1">
              Viewing archived documents. Restore to bring them back, or delete to remove permanently.
            </div>
          </div>
        )}

        {/* Stats card */}
        {view === 'active' && !query.trim() && stats && stats.docCount > 0 && (
          <div className="mb-3 glass-card px-3 py-2">
            <div className="flex items-center gap-3 text-[11px] text-[var(--text-dim)]">
              <div className="flex items-center gap-1.5">
                <FileText size={11} strokeWidth={2.4} className="text-[var(--accent)]" />
                <span className="tabular-nums font-black text-[var(--text)]">{stats.docCount}</span>
                <span>docs</span>
              </div>
              <span className="opacity-40">·</span>
              <div className="flex items-center gap-1.5">
                <Database size={11} strokeWidth={2.4} className="text-[var(--accent)]" />
                <span className="tabular-nums font-black text-[var(--text)]">
                  {stats.chunkCount > 0 ? Math.round((stats.vectorizedChunks / stats.chunkCount) * 100) : 0}%
                </span>
                <span>indexed</span>
                <span className="opacity-60 tabular-nums">({stats.vectorizedChunks}/{stats.chunkCount})</span>
              </div>
              <span className="opacity-40">·</span>
              <div className="tabular-nums">
                <span className="font-black text-[var(--text)]">{formatSize(stats.totalBytes)}</span>
              </div>
              {stats.tagCount > 0 && (
                <>
                  <span className="opacity-40">·</span>
                  <div className="flex items-center gap-1">
                    <Tag size={10} strokeWidth={2.4} />
                    <span className="tabular-nums font-black text-[var(--text)]">{stats.tagCount}</span>
                    <span>tags</span>
                  </div>
                </>
              )}
              <span className="opacity-40">·</span>
              <div>
                <span className="opacity-80">Last import </span>
                <span className="font-bold text-[var(--text-muted)]">{formatRelative(stats.lastImportAt)}</span>
              </div>
              <div className="flex-1" />
              {duplicates.length > 0 && (
                <button
                  onClick={() => setShowDupModal(true)}
                  title="Review possible duplicates"
                  className="flex items-center gap-1.5 px-2 h-[22px] rounded-full text-[10.5px] font-black bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-80 border-none"
                >
                  <Copy size={10} strokeWidth={2.6} />
                  {duplicates.length} duplicate{duplicates.length > 1 ? 's' : ''}
                </button>
              )}
              <button
                onClick={() => setStatsExpanded(v => !v)}
                title={statsExpanded ? 'Hide details' : 'Show details'}
                className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
              >
                {statsExpanded
                  ? <ChevronUp size={11} strokeWidth={2.4} />
                  : <ChevronDown size={11} strokeWidth={2.4} />}
              </button>
            </div>
            {statsExpanded && (
              <div className="mt-2 pt-2 border-t border-[var(--glass-border)] grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-[var(--text-dim)]">
                <div className="flex justify-between">
                  <span>Avg doc size</span>
                  <span className="tabular-nums text-[var(--text)] font-bold">
                    {stats.docCount > 0 ? formatSize(Math.round(stats.totalBytes / stats.docCount)) : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Chunks / doc</span>
                  <span className="tabular-nums text-[var(--text)] font-bold">
                    {stats.docCount > 0 ? (stats.chunkCount / stats.docCount).toFixed(1) : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Unindexed chunks</span>
                  <span className="tabular-nums text-[var(--text)] font-bold">
                    {Math.max(0, stats.chunkCount - stats.vectorizedChunks)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Possible duplicates</span>
                  <span className="tabular-nums text-[var(--text)] font-bold">{duplicates.length}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tag filter chips */}
        {!query.trim() && allTags.length > 0 && (
          <div className="mb-3 flex items-center gap-1.5 flex-wrap">
            <Filter size={11} strokeWidth={2.4} className="text-[var(--text-dim)]" />
            <button
              onClick={() => setTagFilter('')}
              className={`px-2 h-[22px] rounded-full text-[10.5px] font-bold border ${
                !tagFilter
                  ? 'bg-[var(--accent)] text-[var(--on-accent)] border-transparent'
                  : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]'
              }`}
            >
              All
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setTagFilter(prev => prev === tag ? '' : tag)}
                className={`px-2 h-[22px] rounded-full text-[10.5px] font-bold border ${
                  tagFilter === tag
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] border-transparent'
                    : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {/* Import jobs progress */}
        {importJobs.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {importJobs.map(job => (
              <div key={job.id} className="glass-card px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <Loader2 size={11} strokeWidth={2.4} className="animate-spin text-[var(--accent)] flex-shrink-0" />
                  <div className="text-[11.5px] font-bold text-[var(--text)] flex-1 truncate">{job.title}</div>
                  <div className="text-[10.5px] font-bold text-[var(--text-dim)] tabular-nums">
                    {Math.round((job.progress || 0) * 100)}%
                  </div>
                </div>
                <div className="h-[3px] rounded-full bg-[var(--glass-bg-strong)] overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-[width] duration-300"
                    style={{ width: `${Math.max(4, Math.round((job.progress || 0) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Bulk action toolbar */}
        {hasSelection && (
          <div
            className="mb-3 glass-card-strong px-3 py-2 flex items-center gap-2 sticky top-0 z-20 fade-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-[12px] font-black text-[var(--accent)]">
              {selectedIds.size} selected
            </div>
            <div className="flex-1" />
            {view === 'active' ? (
              <>
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setBulkAddMenu(v => !v); }}
                    className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-bold border border-[var(--glass-border)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    <FolderPlus size={11} strokeWidth={2.4} />
                    Add to collection
                  </button>
                  {bulkAddMenu && (
                    <div
                      onClick={e => e.stopPropagation()}
                      className="absolute right-0 top-full mt-1 z-30 min-w-[220px] glass-card-strong py-1"
                    >
                      {collections.length === 0 && (
                        <div className="px-3 py-2 text-[11.5px] text-[var(--text-dim)]">No collections yet.</div>
                      )}
                      {collections.map(c => (
                        <button
                          key={c.id}
                          onClick={() => runBulkAddToCollection(c.id)}
                          className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--glass-bg-strong)] bg-transparent border-none"
                        >
                          {c.name}
                        </button>
                      ))}
                      <div className="border-t border-[var(--glass-border)] mt-1 pt-1">
                        <button
                          onClick={() => { setBulkAddMenu(false); setAskNewCollection({ bulk: true }); }}
                          className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--accent)] font-black hover:bg-[var(--glass-bg-strong)] bg-transparent border-none"
                        >
                          + New collection
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setConfirmBulkDelete(true)}
                  title="Archive selected (Delete)"
                  className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-bold text-[var(--red)] border border-[var(--glass-border)] hover:border-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
                >
                  <Trash2 size={11} strokeWidth={2.4} />
                  Archive
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={runBulkRestore}
                  title="Restore selected"
                  className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-bold text-[var(--accent)] border border-[var(--glass-border)] hover:border-[var(--accent)] hover:bg-[var(--glass-bg-strong)]"
                >
                  <ArchiveRestore size={11} strokeWidth={2.4} />
                  Restore
                </button>
                <button
                  onClick={() => setConfirmBulkHardDelete(true)}
                  title="Delete forever (cannot be undone)"
                  className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-bold text-[var(--on-accent)] bg-[var(--red)] hover:opacity-90 border-none"
                >
                  <AlertTriangle size={11} strokeWidth={2.6} />
                  Delete forever
                </button>
              </>
            )}
            <button
              onClick={() => setSelectedIds(new Set())}
              title="Clear (Esc)"
              className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
            >
              <X size={12} strokeWidth={2.4} />
            </button>
          </div>
        )}

        {/* List */}
        <div className="space-y-1.5">
          {items.map(doc => {
            const active = selectedId === doc.id;
            const checked = selectedIds.has(doc.id);
            return (
              <div
                key={doc.id}
                className="glass-card p-3 flex items-start gap-2 relative"
                style={{
                  borderColor: checked ? 'var(--accent)' : active ? 'var(--accent)' : undefined,
                  background: checked ? 'var(--glass-bg-strong)' : undefined,
                }}
              >
                <button
                  onClick={e => toggleSelect(doc.id, e.shiftKey, e)}
                  title={checked ? 'Deselect' : 'Select (Shift+click for range)'}
                  className="w-6 h-6 mt-[1px] rounded flex items-center justify-center flex-shrink-0 text-[var(--text-dim)] hover:text-[var(--accent)] bg-transparent border-none"
                >
                  {checked
                    ? <CheckSquare size={13} strokeWidth={2.4} className="text-[var(--accent)]" />
                    : <Square size={13} strokeWidth={2.2} />}
                </button>
                <button
                  onClick={() => setSelectedId(doc.id)}
                  className="flex-1 min-w-0 text-left bg-transparent border-none p-0"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={12} strokeWidth={2.2} className="text-[var(--text-dim)] flex-shrink-0" />
                    <div className="text-[12.5px] font-bold text-[var(--text)] truncate">
                      {query.trim() ? highlight(doc.title, query.trim()) : doc.title}
                    </div>
                  </div>
                  {doc.snippet ? (
                    <div className="mt-1 text-[11px] text-[var(--text-muted)] leading-[1.45] line-clamp-2">
                      {highlight(doc.snippet, query.trim())}
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2 text-[10.5px] text-[var(--text-dim)]">
                      <span className="truncate flex-shrink min-w-0">{doc.source}</span>
                      {doc.sizeBytes > 0 && (
                        <>
                          <span>·</span>
                          <span className="tabular-nums flex-shrink-0">{formatSize(doc.sizeBytes)}</span>
                        </>
                      )}
                    </div>
                  )}
                  {doc.tags.length > 0 && !doc.snippet && (
                    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                      {doc.tags.map(tag => (
                        <span
                          key={tag}
                          className="px-1.5 h-[16px] inline-flex items-center rounded-full text-[9.5px] font-bold text-[var(--accent)] bg-[var(--accent-soft)]"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
                <div className="relative flex items-center gap-1">
                  {view === 'active' ? (
                    <>
                      <button
                        onClick={() => setAskRename({ id: doc.id, title: doc.title })}
                        title="Rename"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--glass-bg-strong)]"
                      >
                        <Pencil size={11} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() => openTagsEditor(doc)}
                        title="Edit tags"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--glass-bg-strong)]"
                      >
                        <Tag size={11} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setAddMenuFor(addMenuFor === doc.id ? '' : doc.id); }}
                        title="Add to collection"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--glass-bg-strong)]"
                      >
                        <FolderPlus size={11} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(doc.id)}
                        title="Archive document"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
                      >
                        <Trash2 size={11} strokeWidth={2.2} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => runRestoreOne(doc.id)}
                        title="Restore document"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--glass-bg-strong)]"
                      >
                        <ArchiveRestore size={11} strokeWidth={2.2} />
                      </button>
                      <button
                        onClick={() => setConfirmHardDelete(doc.id)}
                        title="Delete forever"
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
                      >
                        <AlertTriangle size={11} strokeWidth={2.4} />
                      </button>
                    </>
                  )}
                  {view === 'active' && addMenuFor === doc.id && (
                    <div
                      onClick={e => e.stopPropagation()}
                      className="absolute right-0 top-full mt-1 z-10 min-w-[200px] glass-card-strong py-1"
                    >
                      {collections.length === 0 && (
                        <div className="px-3 py-2 text-[11.5px] text-[var(--text-dim)]">No collections yet.</div>
                      )}
                      {collections.map(c => (
                        <button
                          key={c.id}
                          onClick={async () => {
                            await addDocumentsToCollection(c.id, [doc.id]);
                            setAddMenuFor('');
                            await reloadCollections();
                          }}
                          className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--glass-bg-strong)] bg-transparent border-none"
                        >
                          {c.name}
                        </button>
                      ))}
                      <div className="border-t border-[var(--glass-border)] mt-1 pt-1">
                        <button
                          onClick={() => { setAddMenuFor(''); setAskNewCollection({ docId: doc.id }); }}
                          className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--accent)] font-black hover:bg-[var(--glass-bg-strong)] bg-transparent border-none"
                        >
                          + New collection
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="py-12 text-center text-[12px] text-[var(--text-dim)]">
              {view === 'archived'
                ? 'No archived documents.'
                : query
                  ? 'No documents match.'
                  : 'No documents yet. Drop files here or use Import.'}
            </div>
          )}
        </div>
      </div>

      {/* Preview side panel */}
      {selectedId && !fullscreen && (
        <div className="w-[420px] flex-shrink-0 sticky top-0 self-start max-h-[calc(100vh-200px)]">
          <div className="glass-card-strong p-4 flex flex-col gap-3 max-h-[calc(100vh-200px)]">
            <div className="flex items-center gap-2">
              <FileText size={14} strokeWidth={2.2} className="text-[var(--accent)]" />
              <div className="text-[13px] font-black text-[var(--text)] flex-1 truncate">
                {items.find(d => d.id === selectedId)?.title || 'Document'}
              </div>
              <button
                onClick={() => setFullscreen(true)}
                title="Open fullscreen"
                className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--glass-bg-strong)]"
              >
                <Maximize2 size={11} strokeWidth={2.4} />
              </button>
              <button
                onClick={() => setSelectedId('')}
                className="text-[11px] font-bold text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                Close
              </button>
            </div>
            <pre className="flex-1 overflow-auto m-0 whitespace-pre-wrap leading-[1.6] text-[12.5px] font-[Nunito] text-[var(--text)]">
              {previewLoading ? 'Loading…' : (preview || '(empty)')}
            </pre>
          </div>
        </div>
      )}

      {/* Fullscreen preview modal */}
      {selectedId && fullscreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setFullscreen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="glass-card-strong w-full max-w-[1100px] h-full max-h-[88vh] flex flex-col fade-up"
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--glass-border)]">
              <FileText size={15} strokeWidth={2.2} className="text-[var(--accent)]" />
              <div className="text-[14px] font-black text-[var(--text)] flex-1 truncate">
                {items.find(d => d.id === selectedId)?.title || 'Document'}
              </div>
              <div className="text-[10.5px] text-[var(--text-dim)] tabular-nums mr-2">
                {preview.length.toLocaleString()} chars
              </div>
              <button
                onClick={() => setFullscreen(false)}
                title="Exit fullscreen (Esc)"
                className="w-[28px] h-[28px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--glass-bg-strong)]"
              >
                <Minimize2 size={13} strokeWidth={2.4} />
              </button>
              <button
                onClick={() => { setFullscreen(false); setSelectedId(''); }}
                title="Close (Esc)"
                className="w-[28px] h-[28px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
              >
                <X size={14} strokeWidth={2.4} />
              </button>
            </div>
            <pre className="flex-1 overflow-auto m-0 whitespace-pre-wrap leading-[1.65] text-[13px] font-[Nunito] text-[var(--text)] px-6 py-4">
              {previewLoading ? 'Loading…' : (preview || '(empty)')}
            </pre>
          </div>
        </div>
      )}

      {/* Drag-drop overlay */}
      {dragOver && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none fade-up"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          <div
            className="glass-card-strong px-8 py-6 flex flex-col items-center gap-3"
            style={{ border: '2px dashed var(--accent)' }}
          >
            <FilePlus size={28} strokeWidth={2.2} className="text-[var(--accent)]" />
            <div className="text-[14px] font-black text-[var(--text)]">Drop to import</div>
            <div className="text-[11px] text-[var(--text-dim)]">Files will be added to your knowledge base.</div>
          </div>
        </div>
      )}

      {/* Modals */}
      <GlassPromptModal
        open={!!askNewCollection}
        title="New collection"
        placeholder="e.g. Research notes"
        confirmLabel="Create & add"
        onConfirm={async (name) => {
          const ctx = askNewCollection;
          setAskNewCollection(null);
          if (!ctx) return;
          const created = await createCollection(name);
          if (ctx.bulk) {
            await addDocumentsToCollection(created.id, Array.from(selectedIds));
            setSelectedIds(new Set());
          } else if (ctx.docId) {
            await addDocumentsToCollection(created.id, [ctx.docId]);
          }
          await reloadCollections();
        }}
        onCancel={() => setAskNewCollection(null)}
      />

      <GlassConfirmModal
        open={!!confirmDelete}
        title="Archive document?"
        message="The document moves to your archive. You can restore it from there."
        destructive
        confirmLabel="Archive"
        onConfirm={async () => {
          const id = confirmDelete;
          setConfirmDelete('');
          await archiveLibraryDocument(id);
          if (selectedId === id) setSelectedId('');
          await reload();
          await reloadStats();
          await reloadArchivedCount();
        }}
        onCancel={() => setConfirmDelete('')}
      />

      <GlassConfirmModal
        open={confirmBulkDelete}
        title={`Archive ${selectedIds.size} document${selectedIds.size > 1 ? 's' : ''}?`}
        message="They move to your archive. You can restore them from there."
        destructive
        confirmLabel="Archive all"
        onConfirm={runBulkArchive}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      <GlassConfirmModal
        open={!!confirmHardDelete}
        title="Delete forever?"
        message="This permanently removes the document and its chunks. This cannot be undone."
        destructive
        confirmLabel="Delete forever"
        onConfirm={async () => {
          const id = confirmHardDelete;
          setConfirmHardDelete('');
          try { await deleteLibraryDocument(id); } catch { /* ignore */ }
          if (selectedId === id) setSelectedId('');
          await reload();
          await reloadStats();
          await reloadArchivedCount();
        }}
        onCancel={() => setConfirmHardDelete('')}
      />

      <GlassConfirmModal
        open={confirmBulkHardDelete}
        title={`Delete ${selectedIds.size} document${selectedIds.size > 1 ? 's' : ''} forever?`}
        message="This permanently removes them and their chunks. This cannot be undone."
        destructive
        confirmLabel="Delete forever"
        onConfirm={runBulkHardDelete}
        onCancel={() => setConfirmBulkHardDelete(false)}
      />

      <GlassPromptModal
        open={!!askRename}
        title="Rename document"
        defaultValue={askRename?.title || ''}
        confirmLabel="Rename"
        onConfirm={async (title) => {
          const ctx = askRename;
          setAskRename(null);
          if (!ctx) return;
          await renameLibraryDocument(ctx.id, title);
          await reload();
        }}
        onCancel={() => setAskRename(null)}
      />

      {askTags && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setAskTags(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="glass-card-strong w-full max-w-[460px] p-5 flex flex-col gap-4 fade-up"
          >
            <div className="flex items-center gap-2">
              <Tag size={14} strokeWidth={2.4} className="text-[var(--accent)]" />
              <div className="text-[14px] font-black text-[var(--text)] flex-1 truncate">
                Tags — {askTags.title}
              </div>
              <button
                onClick={() => setAskTags(null)}
                className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
              >
                <X size={13} strokeWidth={2.4} />
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
              {tagsBeingEdited.length === 0 && (
                <div className="text-[11px] text-[var(--text-dim)] italic">No tags yet.</div>
              )}
              {tagsBeingEdited.map(tag => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-2 h-[22px] rounded-full text-[11px] font-bold text-[var(--accent)] bg-[var(--accent-soft)]"
                >
                  #{tag}
                  <button
                    onClick={() => setTagsBeingEdited(prev => prev.filter(t => t !== tag))}
                    className="text-[var(--text-dim)] hover:text-[var(--red)] bg-transparent border-none p-0 flex items-center"
                  >
                    <X size={10} strokeWidth={2.6} />
                  </button>
                </span>
              ))}
            </div>

            <input
              value={tagDraft}
              onChange={e => setTagDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTagDraft(); }
                else if (e.key === 'Backspace' && !tagDraft && tagsBeingEdited.length) {
                  setTagsBeingEdited(prev => prev.slice(0, -1));
                }
              }}
              onBlur={commitTagDraft}
              placeholder="Add tag and press Enter…"
              autoFocus
              className="w-full px-3 h-[32px] bg-transparent outline-none border border-[var(--glass-border)] rounded-full text-[12px] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
            />

            {allTags.filter(t => !tagsBeingEdited.includes(t)).length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-dim)] mb-1.5">
                  Existing tags
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {allTags.filter(t => !tagsBeingEdited.includes(t)).map(t => (
                    <button
                      key={t}
                      onClick={() => setTagsBeingEdited(prev => [...prev, t])}
                      className="px-2 h-[22px] rounded-full text-[10.5px] font-bold border border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
                    >
                      +#{t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setAskTags(null)}
                className="px-3 h-[30px] rounded-full text-[12px] font-bold text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
              >
                Cancel
              </button>
              <button
                onClick={saveTags}
                className="px-4 h-[30px] rounded-full text-[12px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showDupModal && createPortal(
        <div
          className="fixed inset-0 z-[10001] overflow-y-auto backdrop-blur-md"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setShowDupModal(false)}
        >
          <div className="min-h-full flex items-start justify-center p-6">
            <div
              onClick={e => e.stopPropagation()}
              className="glass-card-strong w-full max-w-[640px] max-h-[calc(100vh-3rem)] p-5 flex flex-col gap-3 fade-up overflow-hidden my-auto"
            >
              <div className="flex items-center gap-2 flex-shrink-0">
                <Copy size={14} strokeWidth={2.4} className="text-[var(--accent)]" />
                <div className="text-[14px] font-black text-[var(--text)] flex-1">
                  Possible duplicates ({duplicates.length})
                </div>
                <button
                  onClick={() => setShowDupModal(false)}
                  className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
                >
                  <X size={13} strokeWidth={2.4} />
                </button>
              </div>
              <div className="text-[11.5px] text-[var(--text-dim)] leading-[1.5] flex-shrink-0">
                Grouped by identical title and file size. Archiving keeps the newest and removes the rest — documents move to your archive, not permanent delete.
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 -mx-1 px-1">
              {duplicates.length === 0 ? (
                <div className="py-10 text-center text-[12px] text-[var(--text-dim)]">
                  No duplicates left. Nice library hygiene.
                </div>
              ) : duplicates.map(group => {
                const sorted = [...group.docs].sort((a, b) => b.createdAt - a.createdAt);
                const newest = sorted[0];
                return (
                  <div key={group.key} className="glass-card p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-black text-[var(--text)] truncate">{group.title}</div>
                        <div className="text-[10.5px] text-[var(--text-dim)] tabular-nums mt-0.5">
                          {group.docs.length} copies · {formatSize(group.sizeBytes)}
                        </div>
                      </div>
                      <button
                        onClick={() => archiveOlderInGroup(group.key)}
                        disabled={dupBusy === group.key}
                        title="Keep newest, archive the rest"
                        className="flex items-center gap-1.5 px-2.5 h-[24px] rounded-full text-[10.5px] font-black bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-80 border-none disabled:opacity-40 disabled:cursor-wait"
                      >
                        {dupBusy === group.key
                          ? <Loader2 size={10} strokeWidth={2.6} className="animate-spin" />
                          : <Trash2 size={10} strokeWidth={2.6} />}
                        Keep newest
                      </button>
                    </div>
                    <div className="space-y-1">
                      {sorted.map(d => {
                        const isNewest = d.id === newest.id;
                        return (
                          <div
                            key={d.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--rm)] hover:bg-[var(--glass-bg-strong)]"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] text-[var(--text-muted)] truncate flex items-center gap-1.5">
                                {isNewest && (
                                  <span className="px-1.5 h-[15px] inline-flex items-center rounded-full text-[9px] font-black text-[var(--accent)] bg-[var(--accent-soft)]">
                                    NEWEST
                                  </span>
                                )}
                                <span className="truncate">{d.source || '(no source)'}</span>
                              </div>
                              <div className="text-[10px] text-[var(--text-dim)] tabular-nums">
                                {d.createdAt ? new Date(d.createdAt).toLocaleString() : '—'}
                              </div>
                            </div>
                            <button
                              onClick={() => archiveDuplicate(group.key, d.id)}
                              disabled={dupBusy === d.id}
                              title="Archive this copy"
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)] disabled:opacity-40 disabled:cursor-wait"
                            >
                              {dupBusy === d.id
                                ? <Loader2 size={10} strokeWidth={2.4} className="animate-spin" />
                                : <Trash2 size={10} strokeWidth={2.4} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

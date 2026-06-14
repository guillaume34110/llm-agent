import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Trash2, CheckSquare, Square, X, Filter, Tag, Maximize2 } from 'lucide-react';
import {
  archiveMemoryItem,
  listMemoryItems,
  searchMemoryItems,
  summarizeMemoryItems,
  type LibraryMemoryItem,
} from '../../library/library.service';
import { getEffectiveModelId } from '../../preferences/runtime-mode';
import Dropdown from '../Dropdown';
import { GlassConfirmModal } from '../GlassModal';

type MemorySort = 'recent' | 'old' | 'type' | 'alpha';

interface Props {
  query: string;
}

function formatRelative(ts: number): string {
  if (!ts) return '—';
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

export default function MemoryPanel({ query }: Props) {
  const [items, setItems] = useState<LibraryMemoryItem[]>([]);
  const [sort, setSort] = useState<MemorySort>('recent');
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState('');
  const [confirmBulkArchive, setConfirmBulkArchive] = useState(false);
  const [expanded, setExpanded] = useState<LibraryMemoryItem | null>(null);

  const reload = useCallback(async () => {
    if (query.trim()) {
      const mem = await searchMemoryItems(query.trim(), 30);
      setItems(mem);
    } else {
      setItems(await listMemoryItems(200));
    }
  }, [query]);

  useEffect(() => { void reload(); }, [reload]);

  const allTypes = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.type) s.add(it.type);
    return Array.from(s).sort();
  }, [items]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) for (const t of it.tags) s.add(t);
    return Array.from(s).sort();
  }, [items]);

  const sorted = useMemo(() => {
    let arr = items;
    if (typeFilter) arr = arr.filter(it => it.type === typeFilter);
    if (tagFilter) arr = arr.filter(it => it.tags.includes(tagFilter));
    const out = [...arr];
    switch (sort) {
      case 'recent': out.sort((a, b) => b.createdAt - a.createdAt); break;
      case 'old':    out.sort((a, b) => a.createdAt - b.createdAt); break;
      case 'type':   out.sort((a, b) => a.type.localeCompare(b.type) || b.createdAt - a.createdAt); break;
      case 'alpha':  out.sort((a, b) => a.content.localeCompare(b.content)); break;
    }
    return out;
  }, [items, sort, typeFilter, tagFilter]);

  const itemsRef = useRef(sorted); itemsRef.current = sorted;
  const selectedIdsRef = useRef(selectedIds); selectedIdsRef.current = selectedIds;
  const expandedRef = useRef(expanded); expandedRef.current = expanded;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || !!tgt?.isContentEditable;
      if (e.key === 'Escape') {
        if (expandedRef.current) { setExpanded(null); return; }
        if (selectedIdsRef.current.size > 0) { setSelectedIds(new Set()); return; }
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
        setConfirmBulkArchive(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSummarize = async () => {
    setSummarizing(true);
    setShowSummary(true);
    setSummary('Analyzing memory…');
    try {
      const modelId = getEffectiveModelId();
      const { summary: text, count } = await summarizeMemoryItems(modelId || undefined);
      setSummary(`_(${count} items analyzed)_\n\n${text}`);
    } finally {
      setSummarizing(false);
    }
  };

  const toggleSelect = (id: string, shift: boolean, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shift && lastClickedId) {
        const a = sorted.findIndex(i => i.id === lastClickedId);
        const b = sorted.findIndex(i => i.id === id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          for (let i = lo; i <= hi; i++) next.add(sorted[i].id);
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
    if (selectedIds.size === sorted.length && sorted.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(sorted.map(d => d.id)));
  };

  const runBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    setConfirmBulkArchive(false);
    setSelectedIds(new Set());
    await Promise.all(ids.map(id => archiveMemoryItem(id).catch(() => null)));
    await reload();
  };

  const allSelected = sorted.length > 0 && selectedIds.size === sorted.length;
  const hasSelection = selectedIds.size > 0;
  const q = query.trim();

  return (
    <div className="max-w-[760px] mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-[10.5px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)] flex-1">
          Memory ({sorted.length}{items.length !== sorted.length ? ` / ${items.length}` : ''})
        </div>
        {sorted.length > 0 && (
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
        <Dropdown
          value={sort}
          onChange={v => setSort(v as MemorySort)}
          options={[
            { value: 'recent', label: 'Recent' },
            { value: 'old',    label: 'Oldest' },
            { value: 'type',   label: 'By type' },
            { value: 'alpha',  label: 'A→Z' },
          ]}
          width={110}
          fontSize={11}
          buttonPadding="4px 8px"
        />
        <button
          onClick={handleSummarize}
          disabled={summarizing || sorted.length === 0}
          className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-black bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90 disabled:opacity-40"
        >
          <Sparkles size={11} strokeWidth={2.6} />
          {summarizing ? 'Summarizing…' : 'Summarize'}
        </button>
      </div>

      {(allTypes.length > 1 || allTags.length > 0) && (
        <div className="mb-3 space-y-1.5">
          {allTypes.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Filter size={11} strokeWidth={2.4} className="text-[var(--text-dim)]" />
              <button
                onClick={() => setTypeFilter('')}
                className={`px-2 h-[22px] rounded-full text-[10.5px] font-bold border ${
                  !typeFilter
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] border-transparent'
                    : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]'
                }`}
              >
                All types
              </button>
              {allTypes.map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(prev => prev === t ? '' : t)}
                  className={`px-2 h-[22px] rounded-full text-[10.5px] font-bold border uppercase tracking-[0.04em] ${
                    typeFilter === t
                      ? 'bg-[var(--accent)] text-[var(--on-accent)] border-transparent'
                      : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag size={11} strokeWidth={2.4} className="text-[var(--text-dim)]" />
              <button
                onClick={() => setTagFilter('')}
                className={`px-2 h-[22px] rounded-full text-[10.5px] font-bold border ${
                  !tagFilter
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] border-transparent'
                    : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]'
                }`}
              >
                All tags
              </button>
              {allTags.map(t => (
                <button
                  key={t}
                  onClick={() => setTagFilter(prev => prev === t ? '' : t)}
                  className={`px-2 h-[22px] rounded-full text-[10.5px] font-bold border ${
                    tagFilter === t
                      ? 'bg-[var(--accent)] text-[var(--on-accent)] border-transparent'
                      : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)]'
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {hasSelection && (
        <div
          className="mb-3 glass-card-strong px-3 py-2 flex items-center gap-2 sticky top-0 z-20 fade-up"
          onClick={e => e.stopPropagation()}
        >
          <div className="text-[12px] font-black text-[var(--accent)]">
            {selectedIds.size} selected
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setConfirmBulkArchive(true)}
            title="Archive selected (Delete)"
            className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-bold text-[var(--red)] border border-[var(--glass-border)] hover:border-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
          >
            <Trash2 size={11} strokeWidth={2.4} />
            Archive
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            title="Clear (Esc)"
            className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
          >
            <X size={12} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {showSummary && (
        <div className="glass-card p-4 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={12} strokeWidth={2.4} className="text-[var(--accent)]" />
            <div className="text-[10.5px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)] flex-1">
              Summary
            </div>
            <button
              onClick={() => { setShowSummary(false); setSummary(''); }}
              className="text-[11px] font-bold text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              Close
            </button>
          </div>
          <pre className="m-0 whitespace-pre-wrap leading-[1.6] text-[12.5px] font-[Nunito] text-[var(--text)]">
            {summary || 'Loading…'}
          </pre>
        </div>
      )}

      <div className="space-y-1.5">
        {sorted.map(item => {
          const checked = selectedIds.has(item.id);
          const truncated = item.content.length > 280;
          const preview = truncated ? item.content.slice(0, 280) + '…' : item.content;
          return (
            <div
              key={item.id}
              className="glass-card p-3 flex items-start gap-2 group"
              style={{
                borderColor: checked ? 'var(--accent)' : undefined,
                background: checked ? 'var(--glass-bg-strong)' : undefined,
              }}
            >
              <button
                onClick={e => toggleSelect(item.id, e.shiftKey, e)}
                title={checked ? 'Deselect' : 'Select (Shift+click for range)'}
                className="w-6 h-6 mt-[1px] rounded flex items-center justify-center flex-shrink-0 text-[var(--text-dim)] hover:text-[var(--accent)] bg-transparent border-none"
              >
                {checked
                  ? <CheckSquare size={13} strokeWidth={2.4} className="text-[var(--accent)]" />
                  : <Square size={13} strokeWidth={2.2} />}
              </button>
              <button
                onClick={() => setExpanded(item)}
                className="flex-1 min-w-0 text-left bg-transparent border-none p-0"
              >
                <div className="text-[12.5px] leading-[1.55] text-[var(--text)]">
                  {highlight(preview, q)}
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-[var(--text-dim)] font-bold uppercase tracking-[0.04em]">
                  <span className="text-[var(--accent)]">{q && item.type.toLowerCase().includes(q.toLowerCase()) ? highlight(item.type, q) : item.type}</span>
                  <span className="opacity-60">·</span>
                  <span className="normal-case tracking-normal font-normal">{formatRelative(item.createdAt)}</span>
                  {truncated && (
                    <>
                      <span className="opacity-60">·</span>
                      <span className="normal-case tracking-normal font-normal text-[var(--accent)]">click to expand</span>
                    </>
                  )}
                </div>
                {item.tags.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                    {item.tags.map(t => (
                      <span
                        key={t}
                        className="px-1.5 h-[16px] inline-flex items-center rounded-full text-[9.5px] font-bold text-[var(--accent)] bg-[var(--accent-soft)]"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
              <button
                onClick={() => setExpanded(item)}
                title="Open"
                className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--glass-bg-strong)] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Maximize2 size={11} strokeWidth={2.2} />
              </button>
              <button
                onClick={() => archiveMemoryItem(item.id).then(reload)}
                title="Archive"
                className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={11} strokeWidth={2.2} />
              </button>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div className="py-12 text-center text-[12px] text-[var(--text-dim)]">
            {query
              ? 'No memory matches.'
              : items.length > 0
                ? 'No items match the active filters.'
                : 'No memory items yet.'}
          </div>
        )}
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setExpanded(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="glass-card-strong w-full max-w-[720px] max-h-[80vh] flex flex-col fade-up"
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--glass-border)]">
              <Sparkles size={13} strokeWidth={2.4} className="text-[var(--accent)]" />
              <div className="text-[10.5px] font-black uppercase tracking-[0.06em] text-[var(--accent)]">
                {expanded.type}
              </div>
              <div className="text-[10.5px] text-[var(--text-dim)]">·</div>
              <div className="text-[10.5px] text-[var(--text-dim)] tabular-nums flex-1">
                {expanded.createdAt ? new Date(expanded.createdAt).toLocaleString() : '—'}
              </div>
              <button
                onClick={() => {
                  archiveMemoryItem(expanded.id).then(reload);
                  setExpanded(null);
                }}
                title="Archive"
                className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
              >
                <Trash2 size={12} strokeWidth={2.4} />
              </button>
              <button
                onClick={() => setExpanded(null)}
                title="Close (Esc)"
                className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
              >
                <X size={13} strokeWidth={2.4} />
              </button>
            </div>
            <pre className="flex-1 overflow-auto m-0 whitespace-pre-wrap leading-[1.65] text-[13px] font-[Nunito] text-[var(--text)] px-6 py-4">
              {expanded.content}
            </pre>
            {expanded.tags.length > 0 && (
              <div className="px-5 py-3 border-t border-[var(--glass-border)] flex items-center gap-1 flex-wrap">
                {expanded.tags.map(t => (
                  <span
                    key={t}
                    className="px-2 h-[20px] inline-flex items-center rounded-full text-[10.5px] font-bold text-[var(--accent)] bg-[var(--accent-soft)]"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <GlassConfirmModal
        open={confirmBulkArchive}
        title={`Archive ${selectedIds.size} memory item${selectedIds.size > 1 ? 's' : ''}?`}
        message="They will be removed from your memory list."
        destructive
        confirmLabel="Archive all"
        onConfirm={runBulkArchive}
        onCancel={() => setConfirmBulkArchive(false)}
      />
    </div>
  );
}

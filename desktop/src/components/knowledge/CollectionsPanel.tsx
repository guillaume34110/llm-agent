import { useCallback, useEffect, useRef, useState } from 'react';
import { Folder, FolderPlus, Share2, Trash2, Pencil, Download, FileText, Check } from 'lucide-react';
import {
  createCollection,
  deleteCollection,
  listCollections,
  listDocumentsInCollection,
  removeDocumentsFromCollection,
  renameCollection,
  updateCollectionDescription,
  type DocumentCollection,
} from '../../library/collections.service';
import { shareCollection, importCollectionFromUrl } from '../../library/collection-share';
import type { LibraryDocumentItem } from '../../library/library.service';
import { GlassPromptModal, GlassConfirmModal } from '../GlassModal';
import { pushToast } from '../../notifications/notification-center';

export default function CollectionsPanel() {
  const [collections, setCollections] = useState<DocumentCollection[]>([]);
  const [activeId, setActiveId] = useState('');
  const [docs, setDocs] = useState<LibraryDocumentItem[]>([]);
  const [askNew, setAskNew] = useState(false);
  const [askRename, setAskRename] = useState<DocumentCollection | null>(null);
  const [askImport, setAskImport] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DocumentCollection | null>(null);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const descSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try { setCollections(await listCollections()); } catch { setCollections([]); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!activeId) { setDocs([]); return; }
    listDocumentsInCollection(activeId).then(setDocs).catch(() => setDocs([]));
  }, [activeId, collections]);

  useEffect(() => {
    const c = collections.find(x => x.id === activeId);
    setDescDraft(c?.description || '');
    setEditingDesc(false);
  }, [activeId, collections]);

  const saveDesc = useCallback(async (id: string, value: string) => {
    await updateCollectionDescription(id, value);
    await reload();
  }, [reload]);

  const onDescChange = (v: string) => {
    setDescDraft(v);
    if (descSaveTimer.current) clearTimeout(descSaveTimer.current);
    if (!activeId) return;
    const id = activeId;
    descSaveTimer.current = setTimeout(() => { void saveDesc(id, v); }, 600);
  };

  const handleShare = async () => {
    if (!activeId) return;
    try {
      const res = await shareCollection(activeId);
      await navigator.clipboard.writeText(res.url);
      pushToast({ title: 'Link copied', body: `${res.docCount} docs`, tone: 'success' });
    } catch (e: any) {
      pushToast({ title: 'Share failed', body: String(e?.message || e), tone: 'error' });
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-[10.5px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)] flex-1">
          Collections ({collections.length})
        </div>
        <button
          onClick={() => setAskImport(true)}
          className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-bold glass-pill text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
        >
          <Download size={11} strokeWidth={2.4} />
          Import
        </button>
        <button
          onClick={() => setAskNew(true)}
          className="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[11px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
        >
          <FolderPlus size={11} strokeWidth={2.6} />
          New collection
        </button>
      </div>

      {collections.length === 0 ? (
        <div className="glass-card p-10 flex flex-col items-center text-center gap-2">
          <Folder size={24} strokeWidth={2} className="text-[var(--text-dim)] opacity-60" />
          <div className="text-[13px] font-black text-[var(--text)]">No collections</div>
          <div className="text-[11.5px] text-[var(--text-dim)] max-w-[360px]">
            Group documents into collections to share or filter.
          </div>
        </div>
      ) : (
        <div className="flex gap-4 min-h-0">
          <div className="w-[260px] flex-shrink-0 space-y-1">
            {collections.map(c => {
              const active = activeId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-[var(--rm)] transition-colors text-left ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text)] hover:bg-[var(--glass-bg-strong)]'
                  }`}
                >
                  <Folder size={13} strokeWidth={2.2} />
                  <div className="flex-1 min-w-0 truncate text-[12.5px] font-bold">{c.name}</div>
                  <div className="text-[10.5px] text-[var(--text-dim)]">{c.documentCount}</div>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-w-0">
            {!activeId ? (
              <div className="py-12 text-center text-[12px] text-[var(--text-dim)]">
                Select a collection.
              </div>
            ) : (() => {
              const c = collections.find(x => x.id === activeId);
              if (!c) return null;
              return (
                <div>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-black text-[var(--text)] truncate">{c.name}</div>
                      <div className="text-[10.5px] text-[var(--text-dim)] mt-0.5">{docs.length} documents</div>
                    </div>
                    <button
                      onClick={() => setAskRename(c)}
                      title="Rename"
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]"
                    >
                      <Pencil size={12} strokeWidth={2.2} />
                    </button>
                    <button
                      onClick={handleShare}
                      title="Share"
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--accent)] hover:bg-[var(--glass-bg-strong)]"
                    >
                      <Share2 size={12} strokeWidth={2.2} />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(c)}
                      title="Delete"
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
                    >
                      <Trash2 size={12} strokeWidth={2.2} />
                    </button>
                  </div>

                  <div className="px-1 mb-3">
                    {editingDesc ? (
                      <div className="relative">
                        <textarea
                          value={descDraft}
                          onChange={e => onDescChange(e.target.value)}
                          onBlur={() => setEditingDesc(false)}
                          autoFocus
                          rows={2}
                          placeholder="Describe this collection…"
                          className="w-full px-3 py-2 bg-transparent outline-none border border-[var(--glass-border)] rounded-[var(--rm)] text-[12px] leading-[1.5] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] resize-y"
                        />
                        <div className="absolute right-2 bottom-2 text-[10px] font-bold text-[var(--text-dim)] flex items-center gap-1 pointer-events-none">
                          <Check size={10} strokeWidth={2.6} />
                          Saved
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingDesc(true)}
                        className="w-full text-left px-3 py-2 rounded-[var(--rm)] text-[12px] leading-[1.5] hover:bg-[var(--glass-bg-strong)] bg-transparent border border-transparent hover:border-[var(--glass-border)]"
                      >
                        {descDraft ? (
                          <span className="text-[var(--text-muted)]">{descDraft}</span>
                        ) : (
                          <span className="text-[var(--text-dim)] italic">+ Add description…</span>
                        )}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {docs.map(d => (
                      <div key={d.id} className="glass-card p-3 flex items-center gap-2 group">
                        <FileText size={12} strokeWidth={2.2} className="text-[var(--text-dim)]" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-bold text-[var(--text)] truncate">{d.title}</div>
                          <div className="text-[10.5px] text-[var(--text-dim)] truncate">{d.source}</div>
                        </div>
                        <button
                          onClick={async () => {
                            await removeDocumentsFromCollection(activeId, [d.id]);
                            await reload();
                            setDocs(prev => prev.filter(x => x.id !== d.id));
                          }}
                          title="Remove from collection"
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)] opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={11} strokeWidth={2.2} />
                        </button>
                      </div>
                    ))}
                    {docs.length === 0 && (
                      <div className="py-8 text-center text-[12px] text-[var(--text-dim)]">
                        Empty collection. Add documents from the Documents tab.
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <GlassPromptModal
        open={askNew}
        title="New collection"
        placeholder="e.g. Research notes"
        confirmLabel="Create"
        onConfirm={async (name) => {
          setAskNew(false);
          await createCollection(name);
          await reload();
        }}
        onCancel={() => setAskNew(false)}
      />

      <GlassPromptModal
        open={!!askRename}
        title="Rename collection"
        defaultValue={askRename?.name || ''}
        confirmLabel="Rename"
        onConfirm={async (name) => {
          const c = askRename;
          setAskRename(null);
          if (!c) return;
          await renameCollection(c.id, name);
          await reload();
        }}
        onCancel={() => setAskRename(null)}
      />

      <GlassPromptModal
        open={askImport}
        title="Import collection"
        subtitle="Paste a share URL"
        placeholder="https://…"
        confirmLabel="Import"
        onConfirm={async (url) => {
          setAskImport(false);
          try {
            const res = await importCollectionFromUrl(url);
            pushToast({ title: 'Imported', body: `${res.imported} docs`, tone: 'success' });
            await reload();
            setActiveId(res.collectionId);
          } catch (e: any) {
            pushToast({ title: 'Import failed', body: String(e?.message || e), tone: 'error' });
          }
        }}
        onCancel={() => setAskImport(false)}
      />

      <GlassConfirmModal
        open={!!confirmDelete}
        title={`Delete "${confirmDelete?.name || ''}"?`}
        message="This removes the collection. Documents themselves remain in your library."
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          const c = confirmDelete;
          setConfirmDelete(null);
          if (!c) return;
          await deleteCollection(c.id);
          if (activeId === c.id) setActiveId('');
          await reload();
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { BookOpen, Search, Brain, FileText, Folder, Share2 } from 'lucide-react';
import MemoryPanel from './knowledge/MemoryPanel';
import DocumentsPanel from './knowledge/DocumentsPanel';
import CollectionsPanel from './knowledge/CollectionsPanel';
import KbSharePanel from './KbSharePanel';

type Tab = 'memory' | 'documents' | 'collections' | 'shared';

const TABS: { id: Tab; label: string; icon: typeof Brain }[] = [
  { id: 'memory',      label: 'Memory',      icon: Brain },
  { id: 'documents',   label: 'Documents',   icon: FileText },
  { id: 'collections', label: 'Collections', icon: Folder },
  { id: 'shared',      label: 'Shared',      icon: Share2 },
];

export default function KnowledgeView() {
  const [tab, setTab] = useState<Tab>('memory');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const searchable = tab === 'memory' || tab === 'documents';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'f') {
        const t = tabRef.current;
        if (t !== 'memory' && t !== 'documents') return;
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative isolate">
      <div className="flex-shrink-0 px-6 pt-5 pb-2 relative z-10">
        <div className="flex items-center gap-3 mb-1">
          <BookOpen size={20} strokeWidth={2.2} className="text-[var(--accent)]" />
          <h1 className="text-[20px] font-black tracking-[-0.4px] text-[var(--text)]">Knowledge</h1>
        </div>
        <p className="text-[12px] text-[var(--text-dim)] mb-3">Memory, documents, collections — yours and what you've shared.</p>

        {searchable && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 relative">
              <Search size={13} strokeWidth={2.2} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={tab === 'memory' ? 'Search memory…' : 'Search documents…'}
                className="w-full pl-8 pr-3 h-[30px] bg-transparent outline-none border border-[var(--glass-border)] rounded-full text-[12px] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
              />
            </div>
          </div>
        )}

        <div className="flex gap-1 border-b border-[var(--glass-border)]">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 h-[32px] text-[12px] font-bold border-b-2 transition-colors -mb-px ${
                  active
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                <Icon size={12} strokeWidth={2.4} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 pt-3 relative z-10">
        {tab === 'memory'      && <MemoryPanel query={query} />}
        {tab === 'documents'   && <DocumentsPanel query={query} />}
        {tab === 'collections' && <CollectionsPanel />}
        {tab === 'shared' && (
          <div className="max-w-[920px] mx-auto">
            <section className="glass-card overflow-hidden">
              <KbSharePanel />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

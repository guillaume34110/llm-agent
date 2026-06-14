import { useEffect, useMemo, useState } from 'react';
import { Inbox as InboxIcon, ArrowRight } from 'lucide-react';
import { fetchInboxItems, type InboxItem, type InboxSection } from '../inbox/inbox-aggregator';
import { dismiss, isDismissed } from '../inbox/inbox-dismissed';
import type { AgentView } from '../types';

interface Props {
  onGoto: (view: AgentView) => void;
}

const KIND_ICON: Record<InboxItem['kind'], string> = {
  inquiry: '🔍',
  match: '🤝',
  task: '✅',
  job: '⚙️',
};

const SECTION_LABEL: Record<InboxSection, string> = {
  social: 'Social',
  agent: 'Agent',
};

const SECTION_ORDER: InboxSection[] = ['social', 'agent'];

export default function InboxView({ onGoto }: Props) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchInboxItems();
        if (cancelled) return;
        setItems(next.filter(it => !isDismissed(it.id)));
        setError('');
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Aggregator down');
        setItems([]);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const grouped = useMemo(() => {
    const out: Record<InboxSection, InboxItem[]> = { social: [], agent: [] };
    for (const it of items || []) out[it.section].push(it);
    return out;
  }, [items]);

  return (
    <div className="flex-1 overflow-y-auto relative isolate">
      <div className="max-w-[760px] mx-auto p-6 relative z-10">
        <div className="flex items-center gap-3 mb-1">
          <InboxIcon size={20} strokeWidth={2.2} className="text-[var(--accent)]" />
          <h1 className="text-[20px] font-black tracking-[-0.4px] text-[var(--text)]">Inbox</h1>
        </div>
        <p className="text-[12px] text-[var(--text-dim)] mb-5">Everything that needs your decision, in one place.</p>

        {items === null ? (
          <div className="py-12 text-center text-[12px] text-[var(--text-dim)]">Loading…</div>
        ) : items.length === 0 ? (
          <div className="glass-card p-10 flex flex-col items-center text-center gap-2 relative isolate overflow-hidden">
            <div className="text-4xl opacity-70 relative z-10 cute-breathe">✨</div>
            <div className="text-[13px] font-black text-[var(--text)] relative z-10">Inbox zero</div>
            <div className="text-[11.5px] text-[var(--text-dim)] max-w-[360px] relative z-10">
              {error || 'Nothing pending. Your agent will surface things here as they arrive.'}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {SECTION_ORDER.map(sec => {
              const list = grouped[sec];
              if (list.length === 0) return null;
              return (
                <section key={sec}>
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-[11px] font-black uppercase tracking-[0.8px] text-[var(--text-muted)]">{SECTION_LABEL[sec]}</h2>
                    <span className="text-[10.5px] text-[var(--text-dim)] font-bold">{list.length}</span>
                  </div>
                  <div className="space-y-2">
                    {list.map(it => (
                      <button
                        key={it.id}
                        onClick={() => {
                          dismiss(it.id);
                          setItems(prev => (prev || []).filter(p => p.id !== it.id));
                          onGoto(it.goto);
                        }}
                        className="w-full text-left p-3.5 glass-card hover:!border-[var(--accent)] transition-colors flex items-center gap-3 group"
                      >
                        <div className="text-[18px] flex-shrink-0">{KIND_ICON[it.kind]}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-bold text-[var(--text)] truncate">{it.title}</div>
                          <div className="text-[11px] text-[var(--text-dim)] truncate mt-0.5">{it.subtitle}</div>
                        </div>
                        <ArrowRight size={14} strokeWidth={2.2} className="text-[var(--text-dim)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

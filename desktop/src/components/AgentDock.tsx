import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send } from 'lucide-react';
import type { AgentView } from '../types';

interface Props {
  view: AgentView;
  onAsk: (text: string) => void;
}

const HINT_BY_VIEW: Partial<Record<AgentView, string>> = {
  inbox:      'Triage my inbox…',
  tasks:      'Add a task to…',
  people:     'Draft a message to…',
  knowledge:  'Summarize my recent notes…',
  background: 'What jobs ran today?',
  settings:   '',
  chats:      '',
};

export default function AgentDock({ view, onAsk }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  if (view === 'chats' || view === 'settings') return null;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAsk(t);
    setText('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Ask agent (⌘J)"
        aria-label="Ask agent"
        className="fixed bottom-5 right-5 z-[9998] w-[44px] h-[44px] rounded-full bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-lg)] flex items-center justify-center hover:scale-105 transition-transform"
      >
        <Sparkles size={18} strokeWidth={2.4} />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-5 right-5 z-[9998] w-[360px] glass-card-strong p-3 flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <Sparkles size={14} strokeWidth={2.4} className="text-[var(--accent)]" />
        <span className="text-[12px] font-black text-[var(--text)] flex-1">Ask agent</span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="w-6 h-6 rounded-full hover:bg-[var(--glass-bg-strong)] flex items-center justify-center text-[var(--text-dim)]"
        >
          <X size={13} strokeWidth={2.4} />
        </button>
      </div>
      <textarea
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
        }}
        rows={3}
        placeholder={HINT_BY_VIEW[view] || 'Ask anything…'}
        className="w-full resize-none bg-transparent outline-none border border-[var(--glass-border)] rounded-[var(--rm)] px-3 py-2 text-[12.5px] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] text-[var(--text-dim)]">Enter to send · jumps to Chats</span>
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="flex items-center gap-1.5 px-3 h-[28px] rounded-full text-[11.5px] font-black bg-[var(--accent)] text-[var(--on-accent)] disabled:opacity-40 hover:opacity-90"
        >
          <Send size={11} strokeWidth={2.6} />
          Send
        </button>
      </div>
    </div>
  );
}

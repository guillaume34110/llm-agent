import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Inbox, MessageSquare, CheckSquare, BookOpen, Users, Activity, Settings as SettingsIcon,
  Sun, Moon, Plus, Search, ArrowRight,
} from 'lucide-react';
import type { AgentView } from '../types';
import { getPreferences, updatePreferences } from '../preferences/preferences-service';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onViewChange: (view: AgentView) => void;
  onNewChat: () => void;
}

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<any>;
  keywords: string;
  run: () => void;
}

export default function CommandPalette({ open, onClose, onViewChange, onNewChat }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commands: Cmd[] = useMemo(() => {
    const go = (v: AgentView) => () => { onViewChange(v); onClose(); };
    const toggleTheme = () => {
      const p = getPreferences();
      updatePreferences({ theme: p.theme === 'dark' ? 'light' : 'dark' });
      onClose();
    };
    return [
      { id: 'inbox',      label: 'Go to Inbox',      hint: '⌘0', icon: Inbox,         keywords: 'inbox pending notifications triage',     run: go('inbox') },
      { id: 'chats',      label: 'Go to Chats',      hint: '⌘1', icon: MessageSquare, keywords: 'chat conversation talk discuss sessions',run: go('chats') },
      { id: 'tasks',      label: 'Go to Tasks',      hint: '⌘2', icon: CheckSquare,   keywords: 'tasks todo agenda reminders schedule',   run: go('tasks') },
      { id: 'people',     label: 'Go to People',     hint: '⌘3', icon: Users,         keywords: 'people friends social inquiries p2p',    run: go('people') },
      { id: 'knowledge',  label: 'Go to Knowledge',  hint: '⌘4', icon: BookOpen,      keywords: 'knowledge library documents kb memory',  run: go('knowledge') },
      { id: 'background', label: 'Go to Background', hint: '⌘5', icon: Activity,      keywords: 'background jobs schedules watchers crons',run: go('background') },
      { id: 'settings',   label: 'Open Settings',    hint: '⌘,', icon: SettingsIcon,  keywords: 'settings preferences config options',    run: go('settings') },
      { id: 'new-chat',   label: 'New Conversation', hint: '⌘N', icon: Plus,          keywords: 'new chat session start fresh',           run: () => { onNewChat(); onClose(); } },
      { id: 'theme',     label: 'Toggle Theme (Light/Dark)',   icon: getPreferences().theme === 'dark' ? Sun : Moon, keywords: 'theme dark light mode toggle appearance', run: toggleTheme },
    ];
  }, [onViewChange, onClose, onNewChat]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => { if (active >= filtered.length) setActive(0); }, [filtered.length, active]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[active];
      if (cmd) cmd.run();
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[10001] flex items-start justify-center pt-[15vh]"
      style={{ background: 'oklch(0% 0 0 / 0.45)', backdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="glass-card-strong w-[560px] max-w-[92vw] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--glass-border)]">
          <Search size={16} strokeWidth={2.2} className="text-[var(--text-dim)] flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent outline-none border-none text-[14px] text-[var(--text)] placeholder:text-[var(--text-dim)]"
          />
          <kbd className="text-[10px] font-bold text-[var(--text-dim)] px-1.5 py-0.5 rounded glass-pill">ESC</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-[var(--text-dim)]">No commands match.</div>
          ) : (
            filtered.map((cmd, idx) => {
              const Icon = cmd.icon;
              const isActive = idx === active;
              return (
                <button
                  key={cmd.id}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => cmd.run()}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isActive ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text)]'
                  }`}
                >
                  <Icon size={15} strokeWidth={2.2} />
                  <span className="flex-1 text-[13px] font-semibold">{cmd.label}</span>
                  {cmd.hint && <kbd className="text-[10px] font-bold text-[var(--text-dim)] px-1.5 py-0.5 rounded glass-pill">{cmd.hint}</kbd>}
                  {isActive && <ArrowRight size={13} strokeWidth={2.4} className="opacity-70" />}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--glass-border)] text-[10.5px] text-[var(--text-dim)]">
          <div className="flex items-center gap-3">
            <span><kbd className="font-bold">↑↓</kbd> navigate</span>
            <span><kbd className="font-bold">↵</kbd> select</span>
          </div>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}

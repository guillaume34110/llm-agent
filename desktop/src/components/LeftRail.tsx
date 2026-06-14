import React from 'react';
import { Inbox, MessageSquare, CheckSquare, Users, BookOpen, Activity, Bot } from 'lucide-react';
import type { AgentView } from '../types';

interface Props {
  view: AgentView;
  onViewChange: (v: AgentView) => void;
  badges?: Partial<Record<AgentView, number>>;
}

interface Entity {
  id: AgentView;
  label: string;
  icon: React.ComponentType<any>;
  hint: string;
}

const ENTITIES: Entity[] = [
  { id: 'inbox',      label: 'Inbox',      icon: Inbox,         hint: '⌘0' },
  { id: 'chats',      label: 'Chats',      icon: MessageSquare, hint: '⌘1' },
  { id: 'tasks',      label: 'Tasks',      icon: CheckSquare,   hint: '⌘2' },
  { id: 'people',     label: 'People',     icon: Users,         hint: '⌘3' },
  { id: 'knowledge',  label: 'Knowledge',  icon: BookOpen,      hint: '⌘4' },
  { id: 'background', label: 'Background', icon: Activity,      hint: '⌘5' },
  { id: 'chatbots',   label: 'Chatbots',   icon: Bot,           hint: '⌘6' },
];

export default function LeftRail({ view, onViewChange, badges = {} }: Props) {
  return (
    <aside
      className="w-[88px] flex-shrink-0 relative flex flex-col"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        borderRight: '1px solid var(--glass-border)',
      }}
    >
      <div className="flex flex-col items-center py-3 gap-1 flex-shrink-0">
      {ENTITIES.map(e => {
        const active = view === e.id;
        const Icon = e.icon;
        const badge = badges[e.id] ?? 0;
        return (
          <button
            key={e.id}
            onClick={() => onViewChange(e.id)}
            title={`${e.label} (${e.hint})`}
            aria-label={e.label}
            className={`relative w-[72px] h-[52px] rounded-[var(--rm)] flex flex-col items-center justify-center gap-0.5 px-1 transition-all ${
              active
                ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-md)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass-bg-strong)]'
            }`}
          >
            <Icon size={18} strokeWidth={2.2} />
            <span className="text-[9.5px] font-bold tracking-wide uppercase opacity-90 leading-none">
              {e.label}
            </span>
            {badge > 0 && (
              <span
                className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full flex items-center justify-center text-[9.5px] font-black text-white"
                style={{ background: 'var(--red)', boxShadow: 'var(--shadow-sm)' }}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}
      </div>
    </aside>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckSquare, Plus, Search, Trash2, Bot, Repeat, AlertCircle } from 'lucide-react';
import type { TaskItem } from '../types';
import { fetchTasksSnapshot, groupTasks } from '../tasks/tasks-aggregator';
import { createTask, deleteTask, subscribeTasksChanged } from '../tasks/task-client';
import InlineTaskEdit from './InlineTaskEdit';
import { GlassPromptModal } from './GlassModal';

type Filter = 'all' | 'today' | 'overdue' | 'upcoming' | 'done' | 'agent';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'today',    label: 'Today' },
  { id: 'overdue',  label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'done',     label: 'Done' },
  { id: 'agent',   label: 'From agent' },
];

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function isOverdue(t: TaskItem): boolean {
  if (t.status !== 'planned') return false;
  const ts = new Date(t.nextRunAt || t.scheduledFor).getTime();
  return Number.isFinite(ts) && ts < Date.now();
}

export default function TasksView() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string>('');
  const [showNew, setShowNew] = useState(false);

  const reload = useCallback(async () => {
    try {
      const snap = await fetchTasksSnapshot();
      setTasks(snap.all);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const unsub = subscribeTasksChanged(() => { void reload(); });
    const id = window.setInterval(() => { void reload(); }, 20_000);
    return () => { unsub(); window.clearInterval(id); };
  }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = tasks;
    if (q) arr = arr.filter(t =>
      t.title.toLowerCase().includes(q) || (t.details || '').toLowerCase().includes(q)
    );
    switch (filter) {
      case 'today': {
        const now = Date.now();
        const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
        return arr.filter(t => {
          if (t.status !== 'planned') return false;
          const ts = new Date(t.nextRunAt || t.scheduledFor).getTime();
          return ts <= dayEnd.getTime() && ts >= (now - 24 * 3600 * 1000);
        });
      }
      case 'overdue':
        return arr.filter(isOverdue);
      case 'upcoming':
        return arr.filter(t => t.status === 'planned');
      case 'done':
        return arr.filter(t => t.status === 'done' || t.status === 'cancelled');
      case 'agent':
        return arr.filter(t => !!t.agentPrompt);
      default:
        return arr;
    }
  }, [tasks, filter, query]);

  const groups = useMemo(() => groupTasks(filtered), [filtered]);

  const handleQuickCreate = async (title: string) => {
    setShowNew(false);
    const when = new Date();
    when.setMinutes(when.getMinutes() + 30);
    try {
      await createTask({
        title,
        scheduledFor: when.toISOString(),
        allDay: false,
        status: 'planned',
        source: 'desktop',
      });
      void reload();
    } catch {}
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative isolate">
      <div className="flex-shrink-0 px-6 pt-5 pb-2 relative z-10">
        <div className="flex items-center gap-3 mb-1">
          <CheckSquare size={20} strokeWidth={2.2} className="text-[var(--accent)]" />
          <h1 className="text-[20px] font-black tracking-[-0.4px] text-[var(--text)] flex-1">Tasks</h1>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-3 h-[30px] rounded-full text-[11.5px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
          >
            <Plus size={13} strokeWidth={2.6} />
            New task
          </button>
        </div>
        <p className="text-[12px] text-[var(--text-dim)] mb-3">What you and the agent are doing.</p>

        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 relative">
            <Search size={13} strokeWidth={2.2} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search tasks…"
              className="w-full pl-8 pr-3 h-[30px] bg-transparent outline-none border border-[var(--glass-border)] rounded-full text-[12px] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(f => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 h-[26px] rounded-full text-[11px] font-bold transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'glass-pill text-[var(--text-dim)] hover:text-[var(--text)]'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 relative z-10">
        <div className="max-w-[760px] mx-auto pt-3">
          {loading && tasks.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-[var(--text-dim)]">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="glass-card p-10 flex flex-col items-center text-center gap-2 relative isolate overflow-hidden">
              <CheckSquare size={26} strokeWidth={2} className="text-[var(--text-dim)] opacity-60 relative z-10 cute-breathe" />
              <div className="text-[13px] font-black text-[var(--text)] relative z-10">No tasks</div>
              <div className="text-[11.5px] text-[var(--text-dim)] max-w-[360px] relative z-10">
                Nothing here. Hit "New task" or ask the agent to create one.
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map(g => (
                <section key={g.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="text-[10.5px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)]">
                      {g.label}
                    </div>
                    <div className="text-[10.5px] text-[var(--text-dim)] opacity-60">({g.items.length})</div>
                    {g.id === 'overdue' && (
                      <AlertCircle size={12} strokeWidth={2.4} className="text-[var(--red)]" />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {g.items.map(task => {
                      const expanded = expandedId === task.id;
                      const isAgent = !!task.agentPrompt;
                      const isRecurring = !!task.recurrence;
                      const overdue = isOverdue(task);
                      return (
                        <div
                          key={task.id}
                          className="glass-card overflow-hidden"
                          style={overdue ? { borderColor: 'var(--red)' } : undefined}
                        >
                          <button
                            onClick={() => setExpandedId(expanded ? '' : task.id)}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--glass-bg-strong)] transition-colors"
                          >
                            <div className="min-w-[88px] text-[11px] tabular-nums text-[var(--text-dim)] font-bold">
                              {formatWhen(task.nextRunAt || task.scheduledFor)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[12.5px] font-bold text-[var(--text)] truncate">
                                {task.title}
                              </div>
                              {task.details && (
                                <div className="text-[11px] text-[var(--text-dim)] truncate mt-0.5">
                                  {task.details}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {isRecurring && (
                                <span title="Recurring" className="w-5 h-5 rounded-full flex items-center justify-center text-[var(--accent-2)]" style={{ background: 'var(--accent-2-soft)' }}>
                                  <Repeat size={10} strokeWidth={2.6} />
                                </span>
                              )}
                              {isAgent && (
                                <span title="Agent task" className="w-5 h-5 rounded-full flex items-center justify-center text-[var(--accent)]" style={{ background: 'var(--accent-soft)' }}>
                                  <Bot size={10} strokeWidth={2.6} />
                                </span>
                              )}
                              {task.status === 'cancelled' && (
                                <span className="px-1.5 h-[16px] rounded text-[9px] font-black text-[var(--red)] border border-[var(--red)]">FAIL</span>
                              )}
                              {task.status === 'done' && (
                                <span className="px-1.5 h-[16px] rounded text-[9px] font-black text-[var(--text-dim)] border border-[var(--glass-border)]">DONE</span>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTask(task.id).then(() => setTasks(prev => prev.filter(t => t.id !== task.id))).catch(() => {});
                              }}
                              title="Delete task"
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
                            >
                              <Trash2 size={11} strokeWidth={2.2} />
                            </button>
                          </button>
                          {expanded && (
                            <div className="px-3.5 pb-3 pt-1 border-t border-[var(--glass-border)]">
                              <InlineTaskEdit
                                task={task}
                                onSaved={updated => setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))}
                                onDelete={() => {
                                  deleteTask(task.id)
                                    .then(() => setTasks(prev => prev.filter(t => t.id !== task.id)))
                                    .catch(() => {});
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <GlassPromptModal
        open={showNew}
        title="New task"
        subtitle="What needs to happen?"
        placeholder="e.g. Review release notes"
        confirmLabel="Create"
        onConfirm={handleQuickCreate}
        onCancel={() => setShowNew(false)}
      />
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { TaskDraft, TaskItem } from '../types';
import { buildMonthGrid, formatMonthLabel, formatTaskMoment, taskDateKey, toDateKey, todayDateKey, WEEKDAY_LABELS } from '../tasks/date-utils';
import { subscribeTasksChanged } from '../tasks/task-client';
import { getEffectiveModelId } from '../preferences/runtime-mode';
import TaskDetailsPanel from './TaskDetailsPanel';

function blankDraft(dateKey: string): TaskDraft {
  return {
    title: '',
    details: '',
    scheduledFor: dateKey,
    endsAt: null,
    allDay: true,
    status: 'planned',
    source: 'user',
    modelId: getEffectiveModelId() || '',
  };
}

export default function TaskCalendarView() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setTasks(await api.getTasks());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    return subscribeTasksChanged(() => { loadTasks().catch(() => {}); });
  }, [loadTasks]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const task of tasks) {
      const key = taskDateKey(task);
      const list = map.get(key) || [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const days = useMemo(() => buildMonthGrid(anchor), [anchor]);

  const openTask = (task: TaskItem) => setDraft({ ...task });
  const createForDate = (dateKey: string) => setDraft(blankDraft(dateKey));

  const saveDraft = async () => {
    if (!draft) return;
    if ((draft.agentPrompt || '').trim() && !draft.modelId) {
      setError(t('tasks.selectModelError'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: any = {
        title: draft.title.trim(),
        details: draft.details || '',
        scheduledFor: draft.scheduledFor,
        endsAt: draft.endsAt || null,
        allDay: !!draft.allDay,
        status: draft.status || 'planned',
        source: draft.source || 'user',
        agentPrompt: draft.agentPrompt ?? null,
        shellCommand: draft.shellCommand ?? null,
        recurrence: draft.recurrence ?? null,
        recurrenceUntil: draft.recurrenceUntil ?? null,
        recurrenceCount: draft.recurrenceCount ?? null,
        mode: draft.mode ?? 'report',
        modelId: draft.modelId || null,
        imageModelId: draft.imageModelId ?? null,
      };
      const saved = draft.id
        ? await api.updateTask(draft.id, payload)
        : await api.createTask(payload);
      setDraft({ ...saved });
      await loadTasks();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeDraft = async () => {
    if (!draft?.id) return;
    setSaving(true);
    setError('');
    try {
      await api.deleteTask(draft.id);
      setDraft(null);
      await loadTasks();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const statusDotColor = (status?: string) => {
    if (status === 'done') return 'var(--accent)';
    if (status === 'in_progress') return 'var(--blue)';
    if (status === 'late' || status === 'failed') return 'var(--red)';
    return 'var(--text-dim)';
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'var(--bg)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--text-muted)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
            >‹</button>
            <button
              onClick={() => setAnchor(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--text-muted)', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
            >›</button>
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.2px' }}>{formatMonthLabel(anchor)}</div>
          <button
            onClick={() => setAnchor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontWeight: 700, fontSize: 12, padding: 0 }}
          >
            {t('tasks.todayButton')}
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => createForDate(todayDateKey())}
            style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 'var(--r)', padding: '7px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }}
          >
            {t('tasks.newTaskButton')}
          </button>
        </div>

        {error && !draft && (
          <div style={{ padding: '10px 20px', color: 'var(--red)', fontWeight: 700, fontSize: 12.5 }}>
            {error}
          </div>
        )}

        <div style={{ padding: '8px 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 0, overflow: 'auto', flex: 1 }}>
          {WEEKDAY_LABELS.map(label => (
            <div key={label} style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dim)', padding: '8px 6px' }}>
              {label}
            </div>
          ))}

          {days.map(day => {
            const dateKey = toDateKey(day);
            const dayTasks = tasksByDate.get(dateKey) || [];
            const isCurrentMonth = day.getMonth() === anchor.getMonth();
            const isToday = dateKey === todayDateKey();
            return (
              <div
                key={dateKey}
                onClick={() => createForDate(dateKey)}
                style={{
                  height: 100,
                  borderTop: '1px solid var(--border)',
                  padding: '6px 6px 4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                  opacity: isCurrentMonth ? 1 : 0.35,
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 22, height: 22, borderRadius: 999,
                    background: isToday ? 'var(--accent)' : 'transparent',
                    color: isToday ? 'white' : 'var(--text)',
                    fontSize: 12, fontWeight: 700,
                  }}>{day.getDate()}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  {dayTasks.slice(0, 3).map(task => {
                    const isDone = task.status === 'done';
                    const isRecurring = !!task.recurrence;
                    const moment = formatTaskMoment(task);
                    return (
                      <button
                        key={task.id}
                        onClick={e => { e.stopPropagation(); openTask(task); }}
                        title={`${task.title}${moment ? ' — ' + moment : ''}${isRecurring ? ` (${t('tasks.recurring')})` : ''}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                          textAlign: 'left',
                          border: isRecurring ? '1px solid var(--accent-2)' : 'none',
                          background: isRecurring ? 'var(--accent-2-soft)' : 'transparent',
                          padding: '1px 2px', cursor: 'pointer', borderRadius: 3,
                          fontFamily: 'Nunito',
                        }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDotColor(task.status), flexShrink: 0 }} />
                        <span style={{
                          fontSize: 11.5, fontWeight: 600,
                          color: isDone ? 'var(--text-dim)' : 'var(--text-muted)',
                          textDecoration: isDone ? 'line-through' : 'none',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          minWidth: 0, flex: 1,
                        }}>
                          {moment && !task.allDay && (
                            <span style={{ color: 'var(--text-dim)', marginRight: 4 }}>{moment}</span>
                          )}
                          {task.title}
                        </span>
                      </button>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 700, padding: '0 2px' }}>
                      +{dayTasks.length - 3}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TaskDetailsPanel
        draft={draft}
        saving={saving}
        error={error}
        onClose={() => { setDraft(null); setError(''); }}
        onSave={saveDraft}
        onDelete={removeDraft}
        onChange={patch => setDraft(prev => prev ? { ...prev, ...patch } : prev)}
      />
    </div>
  );
}

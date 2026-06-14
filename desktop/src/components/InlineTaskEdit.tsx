import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskItem, TaskInput } from '../types';
import { updateTask, previewRecurrence } from '../tasks/task-client';
import { RECURRENCE_PRESETS, matchRecurrencePreset, formatOccurrence } from '../tasks/recurrence-presets';
import { getLocalModelPick, isOnline, subscribeRuntimeMode } from '../preferences/runtime-mode';
import ModelBadge from './ModelBadge';
import Dropdown from './Dropdown';
import ModelPicker from './ModelPicker';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

interface Props {
  task: TaskItem;
  onSaved: (task: TaskItem) => void;
  onDelete: () => void;
}

function normalizeDt(value: string | null | undefined, allDay: boolean) {
  if (!value) return '';
  return allDay ? value.slice(0, 10) : value.slice(0, 16);
}

const inputStyle: React.CSSProperties = {
  borderRadius: 'var(--r)',
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text)',
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'Nunito',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.04em',
}; // Kept inline: dynamic fontSize, color, fontWeight, textTransform, letterSpacing all use runtime CSS vars

export default function InlineTaskEdit({ task, onSaved, onDelete }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<TaskItem>(task);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [onlineMode, setOnlineMode] = useState<boolean>(() => isOnline());
  useEffect(() => subscribeRuntimeMode(() => setOnlineMode(isOnline())), []);
  // Last task snapshot we synced the draft against. Used to detect which fields
  // the user has edited locally vs which fields changed only on the server.
  const lastSyncedRef = useRef<TaskItem>(task);

  // User-editable fields. Anything NOT in this list is considered server-managed
  // (runResult, runHistory, runFinishedAt, runStartedAt, nextRunAt, status, …)
  // and must always reflect the latest server state, even while the card is open.
  const USER_FIELDS = [
    'title', 'scheduledFor', 'endsAt', 'allDay',
    'agentPrompt', 'shellCommand', 'recurrence', 'recurrenceUntil', 'recurrenceCount',
    'mode', 'modelId', 'waChatJid', 'waChatLabel', 'toolMode', 'contextFolder',
    'reportMode', 'reportCondition',
  ] as const;

  useEffect(() => {
    if (!draft.modelId && (draft.agentPrompt || '').trim()) {
      const fallback = getLocalModelPick();
      if (fallback) setDraft(prev => ({ ...prev, modelId: fallback }));
    }
  }, [draft.agentPrompt, draft.modelId]);

  useEffect(() => {
    setDraft(prev => {
      const last = lastSyncedRef.current;
      const merged: any = { ...task };
      for (const k of USER_FIELDS) {
        const userEdited = (prev as any)[k] !== (last as any)[k];
        if (userEdited) merged[k] = (prev as any)[k];
      }
      lastSyncedRef.current = task;
      return merged as TaskItem;
    });
  }, [task]);

  const presetVal = matchRecurrencePreset(draft.recurrence);
  const recurrence = (draft.recurrence || '').trim();

  useEffect(() => {
    let cancelled = false;
    if (!recurrence || draft.allDay) { setPreview([]); return; }
    previewRecurrence({
      recurrence,
      scheduledFor: draft.scheduledFor,
      count: 3,
      recurrenceUntil: draft.recurrenceUntil || null,
      recurrenceCount: draft.recurrenceCount || null,
    })
      .then(items => { if (!cancelled) setPreview(items); })
      .catch(() => { if (!cancelled) setPreview([]); });
    return () => { cancelled = true; };
  }, [recurrence, draft.scheduledFor, draft.recurrenceUntil, draft.recurrenceCount, draft.allDay]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(task), [draft, task]);

  function patch(p: Partial<TaskInput>) {
    setDraft(prev => ({ ...prev, ...p } as TaskItem));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const payload: Partial<TaskInput> = {
        title: draft.title,
        scheduledFor: draft.scheduledFor,
        endsAt: draft.endsAt || null,
        allDay: draft.allDay,
        agentPrompt: draft.agentPrompt ?? null,
        shellCommand: draft.shellCommand ?? null,
        recurrence: draft.recurrence ?? null,
        recurrenceUntil: draft.recurrenceUntil ?? null,
        recurrenceCount: draft.recurrenceCount ?? null,
        mode: draft.mode ?? 'report',
        modelId: draft.modelId ?? null,
        waChatJid: draft.waChatJid ?? null,
        waChatLabel: draft.waChatLabel ?? null,
        toolMode: draft.toolMode ?? null,
        contextFolder: draft.contextFolder ?? null,
        reportMode: draft.reportMode ?? 'always',
        reportCondition: draft.reportCondition ?? null,
      };
      const updated = await updateTask(task.id, payload);
      onSaved(updated);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-[8px] grid gap-[6px] text-[12px]">
      <input
        value={draft.title}
        onChange={e => patch({ title: e.target.value })}
        placeholder={t('tasks.titlePlaceholder')}
        style={inputStyle}
        className="font-black text-[12.5px]"
      />

      <div className="flex gap-[6px]">
        <input
          type={draft.allDay ? 'date' : 'datetime-local'}
          value={normalizeDt(draft.scheduledFor, !!draft.allDay)}
          onChange={e => patch({ scheduledFor: e.target.value })}
          style={inputStyle}
          className="flex-[2]"
        />
        <div className="flex-[1]">
          <Dropdown
            value={presetVal}
            options={RECURRENCE_PRESETS.map(p => ({ value: p.value, label: p.label }))}
            onChange={v => {
              if (v === 'custom') patch({ recurrence: draft.recurrence || 'FREQ=DAILY' });
              else patch({ recurrence: v || null });
            }}
          />
        </div>
      </div>

      {presetVal === 'custom' && (
        <input
          value={draft.recurrence || ''}
          onChange={e => patch({ recurrence: e.target.value || null })}
          placeholder="FREQ=DAILY;INTERVAL=2"
          style={inputStyle}
          className="font-mono"
        />
      )}

      {recurrence && !draft.allDay && (
        <div className="flex gap-[6px]">
          <input
            type="datetime-local"
            value={normalizeDt(draft.recurrenceUntil || '', false)}
            onChange={e => patch({ recurrenceUntil: e.target.value || null })}
            placeholder="Jusqu'au…"
            style={inputStyle}
            className="flex-[2]"
          />
          <input
            type="number"
            min={1}
            value={draft.recurrenceCount || ''}
            onChange={e => patch({ recurrenceCount: e.target.value ? Number(e.target.value) : null })}
            placeholder="Max"
            style={inputStyle}
            className="flex-[1]"
          />
        </div>
      )}

      <textarea
        value={draft.agentPrompt || ''}
        onChange={e => patch({ agentPrompt: e.target.value })}
        rows={2}
        placeholder={t('tasks.agentPromptPlaceholder')}
        style={inputStyle}
        className="resize-vertical"
      />

      <textarea
        value={draft.shellCommand || ''}
        onChange={e => patch({ shellCommand: e.target.value || null } as any)}
        rows={2}
        placeholder={t('tasks.shellCommandPlaceholder')}
        style={inputStyle}
        className="resize-vertical font-mono text-[11px]"
      />

      <div className="flex gap-[6px] items-center">
        <span style={labelStyle} title={t('tasks.reportTitle')}>{t('tasks.reportLabel')}</span>
        <div className="flex-[1]">
          <Dropdown
            value={draft.reportMode || 'always'}
            options={[
              { value: 'always', label: t('tasks.reportAlways') },
              { value: 'conditional', label: t('tasks.reportConditional') },
            ]}
            onChange={v => patch({ reportMode: (v as 'always' | 'conditional') } as any)}
            title={t('tasks.reportTitle')}
          />
        </div>
      </div>
      {draft.reportMode === 'conditional' && (
        <textarea
          value={draft.reportCondition || ''}
          onChange={e => patch({ reportCondition: e.target.value || null } as any)}
          rows={2}
          placeholder={t('tasks.reportConditionPlaceholder')}
          style={inputStyle}
          className="resize-vertical fade-up"
        />
      )}

      {(draft.agentPrompt || '').trim() && (
        <>
          <div className="flex gap-[6px] items-center">
            <span style={labelStyle}>{t('tasks.notifLabel')}</span>
            <div className="flex-[1]">
              <Dropdown
                value={draft.mode || 'report'}
                options={[
                  { value: 'report', label: t('tasks.modeReport') },
                  { value: 'alert', label: t('tasks.modeAlert') },
                ]}
                onChange={v => patch({ mode: v as 'report' | 'alert' })}
                title={t('tasks.modeTitle')}
              />
            </div>
          </div>
          <div className="flex gap-[6px] items-center">
            <span style={labelStyle}>{t('tasks.modelLabel')}</span>
            <div className="flex-[1]">
              {onlineMode ? (
                <ModelBadge width="100%" />
              ) : (
                <ModelPicker
                  value={draft.modelId || ''}
                  onChange={id => patch({ modelId: id })}
                  width="100%"
                />
              )}
            </div>
          </div>
          <div className="grid gap-[6px] mt-[2px]">
            <button
              type="button"
              onClick={() => setShowChat(s => !s)}
              style={labelStyle}
              className="bg-transparent border-none p-0 cursor-pointer text-left flex items-center gap-[4px] uppercase font-bold"
              title={t('tasks.chatTitle')}
            >
              <span className="w-[10px] inline-block">{showChat ? '▾' : '▸'}</span>
              {t('tasks.chatLabel')}
            </button>
            {showChat && (
              <div className="grid gap-[8px] p-[8px] border border-[var(--border)] rounded-[var(--r)]">
          <div className="grid gap-[4px]">
            <span style={labelStyle} title={t('tasks.waChatJidTitle')}>
              {t('tasks.waChatJidLabel')}
            </span>
            <input
              value={draft.waChatJid || ''}
              onChange={e => patch({ waChatJid: e.target.value || null } as any)}
              placeholder={t('tasks.waChatJidPlaceholder')}
              style={inputStyle}
              className="font-mono text-[11px]"
            />
            <input
              value={draft.waChatLabel || ''}
              onChange={e => patch({ waChatLabel: e.target.value || null } as any)}
              placeholder={t('tasks.waChatLabelPlaceholder')}
              style={inputStyle}
            />
          </div>
          <div className="flex gap-[6px] items-center">
            <span style={labelStyle} title={t('tasks.toolModeTitle')}>
              {t('tasks.toolModeLabel')}
            </span>
            <div className="flex-[1]">
              <Dropdown
                value={draft.toolMode || 'full'}
                options={[
                  { value: 'full', label: t('tasks.toolModeFull') },
                  { value: 'chat_search', label: t('tasks.toolModeSearch') },
                  { value: 'chat_only', label: t('tasks.toolModeChat') },
                ]}
                onChange={v => patch({ toolMode: (v as any) || null } as any)}
              />
            </div>
          </div>
          <div className="grid gap-[4px]">
            <span style={labelStyle} title={t('tasks.contextFolderTitle')}>
              {t('tasks.contextFolderLabel')}
            </span>
            <div className="flex gap-[6px]">
              <input
                value={draft.contextFolder || ''}
                onChange={e => patch({ contextFolder: e.target.value || null } as any)}
                placeholder={t('tasks.contextFolderPlaceholder')}
                style={inputStyle}
                className="font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const picked = await openDialog({ directory: true, multiple: false, title: t('tasks.contextFolderDialog') });
                    if (typeof picked === 'string' && picked) patch({ contextFolder: picked } as any);
                  } catch {}
                }}
                style={inputStyle}
                className="w-auto cursor-pointer"
              >
                {t('tasks.contextFolderButton')}
              </button>
            </div>
          </div>
              </div>
            )}
          </div>
        </>
      )}

      {(draft.nextRunAt || preview.length > 0) && (
        <div style={labelStyle}>
          {draft.nextRunAt ? t('tasks.nextRun', { time: formatOccurrence(draft.nextRunAt) }) : ''}
          {preview.length > 1 && (
            <span className="text-[var(--text-dim)] font-semibold normal-case ml-[8px]" style={{ letterSpacing: 0 }}>
              {t('tasks.thenOccurrences', { dates: preview.slice(1).map(formatOccurrence).join(' · ') })}
            </span>
          )}
        </div>
      )}

      {draft.runStartedAt && !draft.runFinishedAt && (draft.runLog?.length ?? 0) > 0 && (
        <div className="border-l-[2px] border-[var(--accent)] pl-[8px] mt-[2px] grid gap-[2px] text-[11px] font-mono max-h-[180px] overflow-auto bg-[var(--bg2)] rounded-[var(--r)] p-[6px_8px]">
          <div style={labelStyle} className="mb-[2px]">{t('tasks.inProgress')}</div>
          {(draft.runLog || []).map((e, i) => (
            <div key={i} className="flex gap-[6px]" style={{ color: e.kind === 'error' ? 'var(--red)' : 'var(--text)' }}>
              <span className="text-[var(--text-dim)] min-w-[50px]">{(e.ts || '').slice(11, 19)}</span>
              <span className="font-bold min-w-[70px]">{e.kind}</span>
              <span className="flex-[1] break-words">
                {e.label}{e.detail ? ` — ${e.detail}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {draft.runResult && (
        <pre className="m-0 whitespace-pre-wrap font-inherit text-[11px] text-[var(--text)] max-h-[120px] overflow-auto">
          {draft.runResult.slice(0, 600)}
        </pre>
      )}

      {draft.runHistory && draft.runHistory.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(s => !s)}
            className="border-none bg-transparent text-[var(--text-dim)] cursor-pointer text-[11px] p-0 font-extrabold"
          >
            {showHistory ? '▾' : '▸'} {t('tasks.historyLabel', { count: draft.runHistory.length })}
          </button>
          {showHistory && (
            <div className="mt-[4px] grid gap-[4px]">
              {[...draft.runHistory].reverse().map((h, i) => (
                <div key={i} className="text-[11px] text-[var(--text-dim)] pl-[6px]" style={{ borderLeft: `2px solid ${h.ok ? 'var(--accent-2)' : 'var(--red)'}` }}>
                  <span className="font-black" style={{ color: h.ok ? 'var(--text)' : 'var(--red)' }}>{h.ok ? t('tasks.historyOk') : t('tasks.historyFailed')}</span>
                  <span className="ml-[6px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatOccurrence(h.finishedAt)}</span>
                  {h.result && <div className="text-[var(--text)]">{h.result.slice(0, 200)}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-[11px] text-[var(--red)] font-bold">{error}</div>}

      <div className="flex gap-[6px]">
        <button
          onClick={onDelete}
          className="border border-[var(--border)] bg-transparent text-[var(--red)] rounded-[var(--r)] px-[8px] py-[4px] cursor-pointer text-[11px] font-extrabold"
        >
          {t('tasks.deleteButton')}
        </button>
        <div className="flex-[1]" />
        <button
          onClick={save}
          disabled={saving || !dirty || !draft.title.trim() || !draft.scheduledFor || (!!(draft.agentPrompt || '').trim() && !draft.modelId) || (draft.reportMode === 'conditional' && !(draft.reportCondition || '').trim())}
          className="border border-[var(--accent)] rounded-[var(--r)] px-[10px] py-[4px] text-[var(--accent)] text-[11px] font-black"
          style={{
            background: dirty ? 'var(--accent-soft)' : 'transparent',
            cursor: saving || !dirty ? 'default' : 'pointer',
            opacity: saving || !dirty ? 0.5 : 1,
          }}
        >
          {saving ? '…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

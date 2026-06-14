import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDraft, TaskStatus } from '../types';
import { formatTaskDetail, todayDateKey } from '../tasks/date-utils';
import Dropdown from './Dropdown';
import ModelPicker from './ModelPicker';
import ModelBadge from './ModelBadge';
import { isOnline, subscribeRuntimeMode } from '../preferences/runtime-mode';
import { previewRecurrence } from '../tasks/task-client';
import { RECURRENCE_PRESETS, matchRecurrencePreset as matchPreset, formatOccurrence } from '../tasks/recurrence-presets';

interface Props {
  draft: TaskDraft | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onChange: (patch: Partial<TaskDraft>) => void;
}

function normalizeInput(value?: string | null, allDay?: boolean) {
  if (!value) return '';
  return allDay ? value.slice(0, 10) : value.slice(0, 16);
}

export default function TaskDetailsPanel({ draft, saving, error, onClose, onSave, onDelete, onChange }: Props) {
  const { t } = useTranslation();
  const STATUS_OPTIONS: Array<{ value: TaskStatus; label: string }> = [
    { value: 'planned', label: t('tasks.statusPlanned') },
    { value: 'done', label: t('tasks.statusDone') },
    { value: 'cancelled', label: t('tasks.statusCancelled') },
  ];
  const [preview, setPreview] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string>('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [onlineMode, setOnlineMode] = useState<boolean>(() => isOnline());
  useEffect(() => subscribeRuntimeMode(() => setOnlineMode(isOnline())), []);
  const recurrence = (draft?.recurrence || '').trim();
  const scheduledFor = draft?.scheduledFor || '';
  const recurrenceUntil = draft?.recurrenceUntil || '';
  const recurrenceCount = draft?.recurrenceCount || null;
  useEffect(() => {
    let cancelled = false;
    if (!recurrence || !scheduledFor || draft?.allDay) {
      setPreview([]); setPreviewError(''); return;
    }
    previewRecurrence({
      recurrence, scheduledFor, count: 3,
      recurrenceUntil: recurrenceUntil || null,
      recurrenceCount: recurrenceCount || null,
    })
      .then(items => { if (!cancelled) { setPreview(items); setPreviewError(''); } })
      .catch(err => { if (!cancelled) { setPreview([]); setPreviewError(String(err.message || err)); } });
    return () => { cancelled = true; };
  }, [recurrence, scheduledFor, recurrenceUntil, recurrenceCount, draft?.allDay]);

  if (!draft) {
    return (
      <aside style={{
        width: 340,
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg2)',
        padding: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>
          {t('tasks.emptyPanel')}
        </p>
      </aside>
    );
  }

  return (
    <aside style={{
      width: 340,
      flexShrink: 0,
      borderLeft: '1px solid var(--border)',
      background: 'var(--bg2)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ padding: 18, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>
            {draft.id ? t('tasks.panelEdit') : t('tasks.panelNew')}
          </div>
          {draft.createdAt && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
              {formatTaskDetail(draft.createdAt, false)}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{t('tasks.titleLabel')}</span>
          <input
            value={draft.title}
            onChange={e => onChange({ title: e.target.value })}
            placeholder={t('tasks.titleExamplePlaceholder')}
            style={{
              borderRadius: 'var(--r)',
              border: '1px solid var(--border)',
              background: 'var(--bg3)',
              color: 'var(--text)',
              padding: '10px 12px',
              fontSize: 13,
              fontFamily: 'Nunito',
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{t('tasks.detailsLabel')}</span>
          <textarea
            value={draft.details || ''}
            onChange={e => onChange({ details: e.target.value })}
            rows={5}
            style={{
              borderRadius: 'var(--r)',
              border: '1px solid var(--border)',
              background: 'var(--bg3)',
              color: 'var(--text)',
              padding: '10px 12px',
              fontSize: 13,
              resize: 'vertical',
              fontFamily: 'Nunito',
            }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 700 }}>
          <input
            type="checkbox"
            checked={!!draft.allDay}
            onChange={e => {
              const nextAllDay = e.target.checked;
              const currentStart = normalizeInput(draft.scheduledFor, draft.allDay);
              const currentEnd = normalizeInput(draft.endsAt || '', draft.allDay);
              onChange({
                allDay: nextAllDay,
                scheduledFor: nextAllDay
                  ? (currentStart.slice(0, 10) || todayDateKey())
                  : `${(currentStart.slice(0, 10) || todayDateKey())}T09:00`,
                endsAt: currentEnd
                  ? (nextAllDay ? currentEnd.slice(0, 10) : `${currentEnd.slice(0, 10)}T09:30`)
                  : null,
              });
            }}
          />
          {t('tasks.allDayLabel')}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            {draft.allDay ? t('tasks.dateLabel') : t('tasks.startLabel')}
          </span>
          <input
            type={draft.allDay ? 'date' : 'datetime-local'}
            value={normalizeInput(draft.scheduledFor, draft.allDay)}
            onChange={e => onChange({ scheduledFor: e.target.value })}
            style={{
              borderRadius: 'var(--r)',
              border: '1px solid var(--border)',
              background: 'var(--bg3)',
              color: 'var(--text)',
              padding: '10px 12px',
              fontSize: 13,
              fontFamily: 'Nunito',
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            {draft.allDay ? t('tasks.endLabel') : t('tasks.endOptionalLabel')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={draft.allDay ? 'date' : 'datetime-local'}
              value={normalizeInput(draft.endsAt || '', draft.allDay)}
              onChange={e => onChange({ endsAt: e.target.value || null })}
              style={{
                flex: 1,
                borderRadius: 'var(--r)',
                border: '1px solid var(--border)',
                background: 'var(--bg3)',
                color: 'var(--text)',
                padding: '10px 12px',
                fontSize: 13,
                fontFamily: 'Nunito',
              }}
            />
            <button
              onClick={() => onChange({ endsAt: null })}
              style={{
                padding: '0 10px',
                borderRadius: 'var(--r)',
                border: '1px solid var(--border)',
                background: 'var(--bg3)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {t('tasks.clearButton')}
            </button>
          </div>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{t('tasks.statusLabel')}</span>
          <Dropdown
            value={draft.status || 'planned'}
            onChange={v => onChange({ status: v as TaskStatus })}
            options={STATUS_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            fontSize={13}
            buttonPadding="10px 12px"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            {t('tasks.agentPromptLabel')}
          </span>
          <textarea
            value={draft.agentPrompt || ''}
            onChange={e => onChange({ agentPrompt: e.target.value })}
            rows={3}
            placeholder={t('tasks.agentPromptExamplePlaceholder')}
            style={{
              borderRadius: 'var(--r)',
              border: '1px solid var(--border)',
              background: 'var(--bg3)',
              color: 'var(--text)',
              padding: '10px 12px',
              fontSize: 13,
              resize: 'vertical',
              fontFamily: 'Nunito',
            }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            {t('tasks.shellCommandLabel')}
          </span>
          <textarea
            value={draft.shellCommand || ''}
            onChange={e => onChange({ shellCommand: e.target.value || null })}
            rows={3}
            placeholder={t('tasks.shellCommandPlaceholder')}
            style={{
              borderRadius: 'var(--r)',
              border: '1px solid var(--border)',
              background: 'var(--bg3)',
              color: 'var(--text)',
              padding: '10px 12px',
              fontSize: 12,
              resize: 'vertical',
              fontFamily: 'monospace',
            }}
          />
        </label>

        {(draft.agentPrompt || '').trim() && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
              {t('tasks.modelPinnedLabel')}
            </span>
            {onlineMode ? (
              <ModelBadge width="100%" />
            ) : (
              <>
                <ModelPicker
                  value={draft.modelId || ''}
                  onChange={id => onChange({ modelId: id })}
                  width="100%"
                />
                {!draft.modelId && (
                  <span style={{ fontSize: 11, color: 'var(--red)' }}>
                    {t('tasks.modelRequiredError')}
                  </span>
                )}
              </>
            )}
          </label>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }} title={t('tasks.reportTitle')}>
            {t('tasks.reportLabel')}
          </span>
          <Dropdown
            value={draft.reportMode || 'always'}
            onChange={v => onChange({ reportMode: v as 'always' | 'conditional' })}
            options={[
              { value: 'always', label: t('tasks.reportAlways') },
              { value: 'conditional', label: t('tasks.reportConditional') },
            ]}
            fontSize={13}
            buttonPadding="10px 12px"
            title={t('tasks.reportTitle')}
          />
          {draft.reportMode === 'conditional' && (
            <textarea
              value={draft.reportCondition || ''}
              onChange={e => onChange({ reportCondition: e.target.value || null })}
              rows={2}
              placeholder={t('tasks.reportConditionPlaceholder')}
              className="fade-up"
              style={{
                borderRadius: 'var(--r)',
                border: '1px solid var(--border)',
                background: 'var(--bg3)',
                color: 'var(--text)',
                padding: '10px 12px',
                fontSize: 13,
                resize: 'vertical',
                fontFamily: 'Nunito',
              }}
            />
          )}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            {t('tasks.recurrenceLabel')}
          </span>
          <Dropdown
            value={matchPreset(draft.recurrence)}
            onChange={v => {
              if (v === 'custom') {
                onChange({ recurrence: draft.recurrence || 'FREQ=DAILY' });
              } else {
                onChange({ recurrence: v || null });
              }
            }}
            options={RECURRENCE_PRESETS.map(p => ({ value: p.value, label: p.label }))}
            fontSize={13}
            buttonPadding="10px 12px"
          />
          {matchPreset(draft.recurrence) === 'custom' && (
            <input
              value={draft.recurrence || ''}
              onChange={e => onChange({ recurrence: e.target.value || null })}
              placeholder="FREQ=DAILY;INTERVAL=2"
              style={{
                borderRadius: 'var(--r)',
                border: '1px solid var(--border)',
                background: 'var(--bg3)',
                color: 'var(--text)',
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            />
          )}
          {draft.allDay && recurrence && (
            <span style={{ fontSize: 11, color: 'var(--red)' }}>
              {t('tasks.recurrenceAllDayError')}
            </span>
          )}
          {previewError && (
            <span style={{ fontSize: 11, color: 'var(--red)' }}>{previewError}</span>
          )}
          {preview.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 800, marginBottom: 2 }}>{t('tasks.nextOccurrencesLabel')}</div>
              {preview.map((o, i) => <div key={i}>· {formatOccurrence(o)}</div>)}
            </div>
          )}
          {recurrence && !draft.allDay && (
            <>
              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{t('tasks.untilLabel')}</span>
                  <input
                    type="datetime-local"
                    value={(draft.recurrenceUntil || '').slice(0, 16)}
                    onChange={e => onChange({ recurrenceUntil: e.target.value || null })}
                    style={{
                      borderRadius: 'var(--r)', border: '1px solid var(--border)',
                      background: 'var(--bg3)', color: 'var(--text)', padding: '6px 8px',
                      fontSize: 12, fontFamily: 'Nunito',
                    }}
                  />
                </label>
                <label style={{ width: 90, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{t('tasks.maxRunsLabel')}</span>
                  <input
                    type="number"
                    min={1}
                    value={draft.recurrenceCount || ''}
                    onChange={e => {
                      const v = e.target.value ? Number(e.target.value) : null;
                      onChange({ recurrenceCount: v });
                    }}
                    style={{
                      borderRadius: 'var(--r)', border: '1px solid var(--border)',
                      background: 'var(--bg3)', color: 'var(--text)', padding: '6px 8px',
                      fontSize: 12, fontFamily: 'Nunito',
                    }}
                  />
                </label>
              </div>
            </>
          )}
        </label>

        {draft.runHistory && draft.runHistory.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={() => setHistoryOpen(o => !o)}
              style={{
                border: '1px solid var(--border)', background: 'var(--bg3)',
                color: 'var(--text-muted)', borderRadius: 'var(--r)', padding: '8px 10px',
                cursor: 'pointer', fontSize: 12, fontWeight: 700, textAlign: 'left',
              }}
            >
              {historyOpen ? '▾' : '▸'} {t('tasks.historyLabel', { count: draft.runHistory.length })}
            </button>
            {historyOpen && (
              <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {[...draft.runHistory].reverse().map((h, i) => (
                  <div key={i} style={{
                    border: '1px solid var(--border)', borderRadius: 'var(--r)',
                    background: 'var(--bg3)', padding: '6px 8px', fontSize: 11,
                    color: 'var(--text-dim)',
                  }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, color: h.ok ? 'var(--text)' : 'var(--red)' }}>
                        {h.ok ? t('tasks.historyOk') : t('tasks.historyFailed')}
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {h.finishedAt ? formatOccurrence(h.finishedAt) : ''}
                      </span>
                    </div>
                    {h.result && (
                      <pre style={{
                        margin: '4px 0 0 0', whiteSpace: 'pre-wrap',
                        fontFamily: 'inherit', fontSize: 11, color: 'var(--text)',
                      }}>{h.result.slice(0, 400)}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          Source: {draft.source || 'user'}
          {draft.nextRunAt && (
            <span style={{ marginLeft: 10 }}>
              · Prochain : {formatOccurrence(draft.nextRunAt)}
            </span>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ padding: 18, borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
        {draft.id && (
          <button
            onClick={onDelete}
            disabled={saving}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--r)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--red)',
              cursor: saving ? 'default' : 'pointer',
              fontSize: 12.5,
              fontWeight: 800,
              fontFamily: 'Nunito',
            }}
          >
            {t('tasks.deleteButton')}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onSave}
          disabled={saving || !draft.title.trim() || !draft.scheduledFor || (!!(draft.agentPrompt || '').trim() && !draft.modelId) || (draft.reportMode === 'conditional' && !(draft.reportCondition || '').trim())}
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--r)',
            border: '1px solid var(--accent)',
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            cursor: saving ? 'default' : 'pointer',
            fontSize: 12.5,
            fontWeight: 800,
            fontFamily: 'Nunito',
          }}
        >
          {saving ? t('tasks.savingLabel') : t('tasks.saveButton')}
        </button>
      </div>
    </aside>
  );
}

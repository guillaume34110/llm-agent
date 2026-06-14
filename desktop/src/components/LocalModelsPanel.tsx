// Settings panel: download/manage on-device models.
// Each installed model auto-registers as an agent tool (sidecar handles wiring).

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listLocalModels,
  downloadLocalModel,
  uninstallLocalModel,
  loadLocalModel,
  unloadLocalModel,
  type LocalModel,
  type DownloadEvent,
} from '../local-models/local-models.service';

const TASK_ORDER = [
  'features', 'ner', 'embed', 'rerank', 'classify', 'sentiment', 'lang',
  'asr', 'tts', 'ocr', 'image_features', 'image_classify', 'image_gen', 'image_to_3d',
] as const;

const TASK_LABEL = (t: any): Record<string, string> => ({
  features: t('localModels.taskFeatures'),
  ner: t('localModels.taskNer'),
  embed: t('localModels.taskEmbed'),
  rerank: t('localModels.taskRerank'),
  classify: t('localModels.taskClassify'),
  sentiment: t('localModels.taskSentiment'),
  lang: t('localModels.taskLang'),
  asr: t('localModels.taskAsr'),
  tts: t('localModels.taskTts', 'Synthese vocale (TTS)'),
  ocr: t('localModels.taskOcr'),
  image_features: t('localModels.taskImageFeatures'),
  image_classify: t('localModels.taskImageClassify'),
  image_gen: t('localModels.taskImageGen', "Generation d'images"),
  image_to_3d: t('localModels.taskImageTo3d', 'Conversion 2D -> 3D'),
});

function fmtSize(mb: number): string {
  if (!Number.isFinite(mb)) return '?';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

interface RowState {
  busy?: boolean;
  progress?: { percent: number; bytes: number; total: number };
  error?: string;
  abort?: AbortController;
}

export default function LocalModelsPanel() {
  const { t } = useTranslation();
  const [models, setModels] = useState<LocalModel[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const list = await listLocalModels();
      setModels(list);
    } catch (e: any) {
      console.error('list local models failed', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function patchRow(id: string, patch: RowState) {
    setRowState(s => ({ ...s, [id]: { ...s[id], ...patch } }));
  }

  async function handleInstall(m: LocalModel) {
    if (m.runtime === 'system') {
      patchRow(m.id, { error: t('localModels.systemBinaryError') });
      return;
    }
    const ctrl = new AbortController();
    patchRow(m.id, { busy: true, error: undefined, progress: { percent: 0, bytes: 0, total: 0 }, abort: ctrl });
    try {
      await downloadLocalModel(m.id, (ev: DownloadEvent) => {
        if (ev.event === 'progress') {
          patchRow(m.id, {
            progress: { percent: ev.percent ?? 0, bytes: ev.bytes ?? 0, total: ev.total ?? 0 },
          });
        } else if (ev.event === 'done') {
          patchRow(m.id, { busy: false, progress: undefined, abort: undefined });
          refresh();
        } else if (ev.event === 'error') {
          patchRow(m.id, { busy: false, error: ev.message || 'download failed', progress: undefined, abort: undefined });
        } else if (ev.event === 'skipped') {
          patchRow(m.id, { busy: false, progress: undefined, abort: undefined });
          refresh();
        }
      }, ctrl.signal);
    } catch (e: any) {
      const aborted = e?.name === 'AbortError' || ctrl.signal.aborted;
      patchRow(m.id, {
        busy: false,
        error: aborted ? undefined : String(e?.message || e),
        progress: undefined,
        abort: undefined,
      });
      if (aborted) {
        // SSE server-side keeps running snapshot_download in its thread; uninstall
        // wipes the partial directory so the next install restarts cleanly.
        try { await uninstallLocalModel(m.id); } catch {}
        refresh();
      }
    }
  }

  function handleCancel(m: LocalModel) {
    const ctrl = rowState[m.id]?.abort;
    if (ctrl) ctrl.abort();
  }

  async function handleUninstall(m: LocalModel) {
    if (!confirm(t('localModels.uninstallConfirm', { label: m.label }))) return;
    patchRow(m.id, { busy: true });
    await uninstallLocalModel(m.id);
    patchRow(m.id, { busy: false });
    refresh();
  }

  const grouped = useMemo(() => {
    const map: Record<string, LocalModel[]> = {};
    for (const m of models) {
      (map[m.task] ||= []).push(m);
    }
    return map;
  }, [models]);

  const orderedTasks = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of TASK_ORDER) if (grouped[t]) { out.push(t); seen.add(t); }
    for (const t of Object.keys(grouped)) if (!seen.has(t)) out.push(t);
    return out;
  }, [grouped]);

  const taskLabels = useMemo(() => TASK_LABEL(t), [t]);

  return (
    <div className="p-[18px] grid gap-[14px]">
      <div>
        <div className="text-[13.5px] font-[900] text-[var(--text)]">{t('localModels.title')}</div>
        <div className="mt-[4px] text-[11.5px] text-[var(--text-dim)] leading-[1.5]">
          {t('localModels.description')}
        </div>
      </div>

      {loading && <div className="text-[12px] text-[var(--text-dim)]">{t('common.loading')}</div>}

      {!loading && models.length === 0 && (
        <div className="text-[12px] text-[var(--text-dim)]">
          {t('localModels.noCatalog')}
        </div>
      )}

      {orderedTasks.map(task => (
        <div key={task} className="grid gap-[8px]">
          <div className="text-[11px] font-[800] text-[var(--text-muted)] uppercase tracking-[0.5px]">
            {taskLabels[task] || task}
          </div>
          <div className="grid gap-[8px]">
            {grouped[task].map(m => {
              const rs = rowState[m.id] || {};
              const installed = m.installed;
              return (
                <div
                  key={m.id}
                  className="border border-[var(--border)] rounded-[var(--r)] p-[10px_12px] bg-[var(--bg2)] grid gap-[6px]"
                >
                  <div className="flex items-center gap-[10px] flex-wrap">
                    <div className="font-[800] text-[13px] text-[var(--text)]">{m.label}</div>
                    <div className="text-[10px] text-[var(--text-dim)]">{m.id}</div>
                    {installed && (
                      <span className="text-[10px] font-[700] text-[#10b981] border border-[#10b981] rounded-[4px] px-[6px] py-[1px]">
                        {t('localModels.installed')}
                      </span>
                    )}
                    <div className="ml-auto flex gap-[6px]">
                      {!installed && !rs.busy && (
                        <button
                          onClick={() => handleInstall(m)}
                          className="border border-[var(--border)] bg-[var(--accent)] text-[var(--accent-fg,white)] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px]"
                        >
                          {m.runtime === 'system' ? t('localModels.check') : t('localModels.install', { size: fmtSize(m.size_mb) })}
                        </button>
                      )}
                      {!installed && rs.busy && (
                        <button
                          onClick={() => handleCancel(m)}
                          className="border border-[#ef4444] bg-transparent text-[#ef4444] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px]"
                        >
                          {t('common.cancel')}
                        </button>
                      )}
                      {installed && m.runtime !== 'system' && (
                        <button
                          disabled={rs.busy}
                          onClick={() => handleUninstall(m)}
                          className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[10px] py-[5px] font-[700] text-[11.5px]"
                          style={{ cursor: rs.busy ? 'wait' : 'pointer' }}
                        >
                          {t('common.delete')}
                        </button>
                      )}
                      {installed && m.runtime !== 'system' && (
                        <>
                          <button
                            onClick={() => loadLocalModel(m.id)}
                            className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px]"
                          >
                            {t('localModels.preload')}
                          </button>
                          <button
                            onClick={() => unloadLocalModel(m.id)}
                            className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px]"
                          >
                            {t('localModels.unload')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">{m.description}</div>
                  <div className="flex gap-[10px] text-[10.5px] text-[var(--text-dim)] flex-wrap">
                    <span>tool: <code>{m.tool_name}</code></span>
                    <span>{m.license}</span>
                    <span>{m.languages.join('/') || '—'}</span>
                    <span>{m.runtime}</span>
                  </div>
                  {rs.progress && (
                    <div className="grid gap-[4px]">
                      <div className="h-[6px] bg-[var(--bg3)] rounded-[3px] overflow-hidden">
                        <div style={{ height: '100%', width: `${Math.max(2, rs.progress.percent)}%` }} className="bg-[var(--accent)]" />
                      </div>
                      <div className="text-[10px] text-[var(--text-dim)]">
                        {rs.progress.percent.toFixed(0)}%{rs.progress.total ? ` (${(rs.progress.bytes / 1e6).toFixed(1)} / ${(rs.progress.total / 1e6).toFixed(1)} MB)` : ''}
                      </div>
                    </div>
                  )}
                  {rs.error && (
                    <div className="text-[11px] text-[#ef4444]">{t('localModels.error')}: {rs.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

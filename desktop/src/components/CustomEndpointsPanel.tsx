import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listEndpoints,
  addEndpoint,
  updateEndpoint,
  deleteEndpoint,
  discoverModels,
  type CustomEndpoint,
} from '../custom-endpoints/custom-endpoints.service';
import { api } from '../api';

const PRESETS_BY_KIND: Record<string, Array<{ label: string; baseUrl: string; hint: string }>> = {
  chat: [
    { label: 'LM Studio', baseUrl: 'http://localhost:1234', hint: 'LM Studio local server' },
    { label: 'OpenAI-compatible', baseUrl: 'http://localhost:8000', hint: 'vLLM, llama.cpp server…' },
  ],
  image: [
    { label: 'A1111 WebUI', baseUrl: 'http://localhost:7860', hint: 'stable-diffusion-webui' },
    { label: 'ComfyUI', baseUrl: 'http://localhost:8188', hint: 'ComfyUI server' },
    { label: 'OpenAI image', baseUrl: 'http://localhost:8000', hint: 'OpenAI-compatible /v1/images' },
  ],
  music: [
    { label: 'OpenAI audio', baseUrl: 'http://localhost:8000', hint: '/v1/audio/speech' },
  ],
  video: [
    { label: 'OpenAI video', baseUrl: 'http://localhost:8000', hint: '/v1/videos/generations' },
  ],
};

function getInputClassName(): string {
  return 'px-[10px] py-[8px] bg-[var(--bg2)] border border-[var(--border)] rounded-[var(--r)] text-[var(--text)] text-[12.5px] font-Nunito';
}

function getBtnClassName(variant: 'primary' | 'ghost' | 'danger' = 'ghost'): string {
  const base = 'px-[12px] py-[6px] rounded-[var(--r)] text-[12px] font-[800] font-Nunito cursor-pointer border border-[var(--border)]';
  if (variant === 'primary') return `${base} bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]`;
  if (variant === 'danger') return `${base} bg-transparent text-[oklch(70%_0.16_25)] border-[oklch(40%_0.12_25)]`;
  return `${base} bg-[var(--bg2)] text-[var(--text-muted)]`;
}

export default function CustomEndpointsPanel() {
  const { t } = useTranslation();
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>(() => listEndpoints());
  const [showAdd, setShowAdd] = useState(false);
  const [kind, setKind] = useState<'chat' | 'image' | 'music' | 'video'>('chat');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => setEndpoints(listEndpoints());

  const getProtocolFromPreset = (preset: (typeof PRESETS_BY_KIND)[string][number]): string | undefined => {
    const label = preset.label.toLowerCase();
    if (label.includes('a1111')) return 'a1111';
    if (label.includes('comfyui')) return 'comfyui';
    return undefined; // default to 'openai' in sidecar
  };

  const pickPreset = (p: (typeof PRESETS_BY_KIND)[string][number]) => {
    setLabel(p.label);
    setBaseUrl(p.baseUrl);
  };

  const onAdd = async () => {
    setErr(null);
    if (!label.trim() || !baseUrl.trim()) {
      setErr(t('customEndpoints.labelAndUrlRequired'));
      return;
    }
    setBusy('add');
    try {
      const presets = PRESETS_BY_KIND[kind] || [];
      const pickedPreset = presets.find(p => p.label === label);
      const protocol = pickedPreset ? getProtocolFromPreset(pickedPreset) : undefined;

      const ep = await addEndpoint({ label, baseUrl, apiKey, kind, protocol });

      // For non-chat kinds, add single model if user provided text
      if (kind !== 'chat' && modelInput.trim()) {
        const modelId = modelInput.trim();
        const patch = {
          models: [{ id: modelId, name: modelId }],
        };
        await updateEndpoint(ep.id, patch);
      }

      setLabel(''); setBaseUrl(''); setApiKey(''); setModelInput(''); setShowAdd(false);
      refresh();
      // Auto-discover only for chat
      if (kind === 'chat') {
        await discoverModels(ep.id);
        refresh();
      }
      api.getModels().catch(() => {});
    } catch (e: any) {
      setErr(e?.message || t('customEndpoints.addError'));
    } finally {
      setBusy(null);
    }
  };

  const onDiscover = async (id: string) => {
    const ep = endpoints.find(e => e.id === id);
    if (!ep || ep.kind !== 'chat') {
      setErr('Discovery only for chat endpoints');
      return;
    }
    setBusy(`discover-${id}`); setErr(null);
    try {
      await discoverModels(id);
      refresh();
      api.getModels().catch(() => {});
    } catch (e: any) {
      setErr(`${id}: ${e?.message || 'discovery failed'}`);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm(t('customEndpoints.deleteConfirm', { id }))) return;
    await deleteEndpoint(id);
    refresh();
    api.getModels().catch(() => {});
  };

  const onToggleKey = async (ep: CustomEndpoint) => {
    const next = prompt(t('customEndpoints.apiKeyPrompt', { label: ep.label }), ep.apiKey || '');
    if (next === null) return;
    await updateEndpoint(ep.id, { apiKey: next.trim() || undefined });
    refresh();
  };

  return (
    <div className="p-[18px]">
      <div className="flex items-center justify-between gap-[12px]">
        <div>
          <div className="text-[13.5px] font-[900] text-[var(--text)]">{t('customEndpoints.title')}</div>
          <div className="mt-[4px] text-[11.5px] text-[var(--text-dim)]">
            {t('customEndpoints.description')}
          </div>
        </div>
        {!showAdd && (
          <button className={getBtnClassName('primary')} onClick={() => setShowAdd(true)}>+ {t('customEndpoints.add')}</button>
        )}
      </div>

      {showAdd && (
        <div className="mt-[14px] p-[14px] border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg2)] grid gap-[10px]">
          <div>
            <div className="text-[11px] font-[700] text-[var(--text-muted)] mb-[6px]">{t('customEndpoints.type')}</div>
            <div className="flex gap-[6px] flex-wrap">
              {(['chat', 'image', 'music', 'video'] as const).map(k => (
                <button
                  key={k}
                  className={getBtnClassName(kind === k ? 'primary' : 'ghost')}
                  onClick={() => { setKind(k); setLabel(''); setBaseUrl(''); setModelInput(''); }}
                >
                  {t(`customEndpoints.type_${k}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-[8px] flex-wrap">
            {(PRESETS_BY_KIND[kind] || []).map(p => (
              <button key={p.label} className={getBtnClassName('ghost')} onClick={() => pickPreset(p)} title={p.hint}>
                {p.label}
              </button>
            ))}
          </div>
          <input className={getInputClassName()} placeholder={t('customEndpoints.labelPlaceholder')} value={label} onChange={e => setLabel(e.target.value)} />
          <input className={getInputClassName()} placeholder={t('customEndpoints.urlPlaceholder')} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
          <input className={getInputClassName()} placeholder={t('customEndpoints.apiKeyPlaceholder')} value={apiKey} onChange={e => setApiKey(e.target.value)} type="password" />
          {kind !== 'chat' && (
            <input className={getInputClassName()} placeholder={t(`customEndpoints.modelPlaceholder_${kind}`)} value={modelInput} onChange={e => setModelInput(e.target.value)} />
          )}
          {err && <div className="text-[12px] text-[oklch(70%_0.16_25)]">{err}</div>}
          <div className="flex gap-[8px] justify-end">
            <button className={getBtnClassName('ghost')} onClick={() => { setShowAdd(false); setErr(null); }}>{t('common.cancel')}</button>
            <button className={getBtnClassName('primary')} disabled={busy === 'add'} onClick={onAdd}>
              {busy === 'add' ? t('customEndpoints.adding') : kind === 'chat' ? t('customEndpoints.addAndDetect') : t('customEndpoints.add')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-[14px] grid gap-[10px]">
        {endpoints.length === 0 && !showAdd && (
          <div className="text-[12px] text-[var(--text-dim)] py-[12px]">{t('customEndpoints.noEndpoints')}</div>
        )}
        {endpoints.map(ep => (
          <div key={ep.id} className="p-[12px] border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg2)]">
            <div className="flex items-center justify-between gap-[8px]">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-[800] text-[var(--text)] flex gap-[8px] items-center">
                  {ep.label}
                  <span className="text-[10px] px-[6px] py-[2px] bg-[var(--bg3)] border border-[var(--border)] rounded-[3px] text-[var(--text-muted)] font-[400]">
                    {ep.kind || 'chat'}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-dim)] overflow-hidden text-ellipsis whitespace-nowrap">
                  {ep.baseUrl} · {ep.apiKey ? t('customEndpoints.keyPresent') : t('customEndpoints.noKey')} · {ep.models.length} {t(ep.models.length > 1 ? 'customEndpoints.modelsPlural' : 'customEndpoints.modelsSingular')}
                </div>
              </div>
              <div className="flex gap-[6px]">
                {(ep.kind || 'chat') === 'chat' && (
                  <button className={getBtnClassName('ghost')} disabled={busy === `discover-${ep.id}`} onClick={() => onDiscover(ep.id)}>
                    {busy === `discover-${ep.id}` ? '…' : t('customEndpoints.rediscover')}
                  </button>
                )}
                <button className={getBtnClassName('ghost')} onClick={() => onToggleKey(ep)}>{t('customEndpoints.key')}</button>
                <button className={getBtnClassName('danger')} onClick={() => onDelete(ep.id)}>{t('common.delete')}</button>
              </div>
            </div>
            {ep.models.length > 0 && (
              <div className="mt-[8px] flex flex-wrap gap-[5px]">
                {ep.models.slice(0, 12).map(m => (
                  <span key={m.id} className="text-[10.5px] px-[7px] py-[3px] bg-[var(--bg3)] border border-[var(--border)] rounded-[4px] text-[var(--text-muted)]">
                    {m.id}
                  </span>
                ))}
                {ep.models.length > 12 && (
                  <span className="text-[10.5px] text-[var(--text-dim)]">+{ep.models.length - 12}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {err && !showAdd && <div className="mt-[10px] text-[12px] text-[oklch(70%_0.16_25)]">{err}</div>}
    </div>
  );
}

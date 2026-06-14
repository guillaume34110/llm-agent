import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getModelFamily, groupModelsByFamily, pickBestInFamily } from '../agent/model-routing';
import { api } from '../api';
import type { ModelInfo } from '../types';

interface Props {
  value: string;
  onChange: (id: string) => void;
  width?: number | string;
  placeholder?: string;
}

function CapIcon({ kind }: { kind: 'text' | 'vision' | 'audio' | 'tools' }) {
  const sz = 12;
  const common = { width: sz, height: sz, viewBox: '0 0 24 24' as const };
  const fill = 'currentColor';
  const stroke = 'currentColor';
  const titles = { text: 'text', vision: 'vision', audio: 'audio', tools: 'tools' };
  if (kind === 'text') {
    return (
      <svg {...common} aria-label={titles.text}>
        <path fill={fill} fillOpacity="0.35" d="M5 3h10l4 4v14H5z" />
        <path fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" d="M15 3v4h4M8 12h8M8 16h6" />
      </svg>
    );
  }
  if (kind === 'vision') {
    return (
      <svg {...common} aria-label={titles.vision}>
        <path fill={fill} fillOpacity="0.35" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
        <circle cx="12" cy="12" r="3.2" fill={fill} />
      </svg>
    );
  }
  if (kind === 'audio') {
    return (
      <svg {...common} aria-label={titles.audio}>
        <rect x="9" y="2" width="6" height="12" rx="3" fill={fill} fillOpacity="0.35" />
        <path fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-label={titles.tools}>
      <path fill={fill} fillOpacity="0.35" d="M14.7 6.3a4 4 0 0 1 5 5L17 14l-7 7-4-4 7-7z" />
      <path fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a4 4 0 0 1 5 5L17 14l-7 7-4-4 7-7zM4 20l3-3" />
    </svg>
  );
}

export default function ModelPicker({ value, onChange, width = 172, placeholder = 'Modèle' }: Props) {
  const { t } = useTranslation();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [showModels, setShowModels] = useState(false);
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const [supplyByModel, setSupplyByModel] = useState<Map<string, { supply: number; queue: number; ratio: number }>>(new Map());
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.getModels().then(setModels).catch(() => {}); }, []);

  useEffect(() => {
    if (!showModels) return;
    api.getMatchmakingDemand().then(rows => {
      const m = new Map<string, { supply: number; queue: number; ratio: number }>();
      for (const r of rows) m.set(r.modelId, { supply: r.supplyOnline, queue: r.queueDepth, ratio: r.ratio });
      setSupplyByModel(m);
    }).catch(() => {});
  }, [showModels]);

  useEffect(() => {
    if (!showModels) return;
    const handler = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setShowModels(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModels]);

  const RECOMMENDED_IDS = [
    'qwen3:8b',
    'phi-4-mini:3.8b',
    'mistral-small-3.1:24b',
  ];
  const recommended = useMemo(() => {
    for (const id of RECOMMENDED_IDS) {
      const m = models.find(mm => mm.id === id);
      if (m) return m;
    }
    return models.find(m => m.supportsTools !== false && (m.inputCostPer1MTokensCents ?? 99000) < 50000) || null;
  }, [models]);

  const families = useMemo(() => {
    const map = new Map<string, typeof models>();
    if (recommended) map.set(t('modelPicker.recommended'), [recommended]);
    const grouped = groupModelsByFamily(models);
    for (const [k, v] of grouped) map.set(k, v);
    const free = models.filter(m => m.inputCostPer1MTokensCents === 0);
    if (free.length > 0) map.set(t('modelPicker.free'), free);
    return map;
  }, [models, recommended, t]);

  const selectedInfo = models.find(m => m.id === value);
  const missing = !!value && !selectedInfo;

  const openSelector = () => { setActiveFamily(null); setShowModels(v => !v); };

  return (
    <div ref={selectorRef} className="relative" style={{ width }}>
      <button
        onClick={openSelector}
        title={selectedInfo?.id || value || placeholder}
        className={`w-full px-[10px] py-[7px] rounded-[var(--r)] text-[11.5px] font-[700] font-['Nunito'] whitespace-nowrap overflow-hidden text-ellipsis transition-all duration-150 flex items-center justify-between gap-1 cursor-pointer ${
          showModels ? 'bg-[var(--bg4)] border-[var(--accent)]' : 'bg-[var(--bg3)] border-[var(--border)]'
        } ${missing ? 'border-[var(--red)]' : ''} border-[1px] ${showModels ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
      >
        <span className="overflow-hidden text-ellipsis flex-1 text-left">
          {selectedInfo ? selectedInfo.name : (value || placeholder)}
        </span>
        <span className="flex-shrink-0">{showModels ? '▴' : '▾'}</span>
      </button>
      {showModels && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 w-[260px] max-h-[320px] overflow-y-auto bg-[var(--bg3)] border-[1px] border-[var(--border)] rounded-[var(--rm)] shadow-[var(--shadow-strong)] z-100" style={{ scrollbarWidth: 'thin' }}>
          {activeFamily === null && (
            <>
              <div className="px-[10px] py-[8px] flex flex-wrap gap-[5px] border-b-[1px] border-b-[var(--border)] bg-[var(--bg4)]">
                {(['Qwen', 'Mistral', 'Phi', 'global'] as const).map(fam => {
                  const label = fam === 'global' ? t('modelPicker.autoGlobal') || 'Auto' : `${fam} Auto`;
                  return (
                    <button
                      key={fam}
                      onMouseDown={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        const best = pickBestInFamily(models, fam === 'global' ? 'global' : fam);
                        if (best) {
                          onChange(best.id);
                          setShowModels(false);
                          setActiveFamily(null);
                        }
                      }}
                      className="px-[8px] py-[4px] rounded-[6px] text-[10.5px] font-['Nunito'] font-[700] border-[1px] border-[var(--border)] bg-[var(--bg3)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer transition-colors"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {families.size === 0 && (
                <div className="px-[14px] py-[12px] text-[12px] text-[var(--text-dim)]">{t('modelPicker.noModels')}</div>
              )}
              {[...families.entries()].map(([family, fmodels]) => {
                const hasSelected = fmodels.some(m => m.id === value);
                return (
                  <button
                    key={family}
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setActiveFamily(family); }}
                    className={`w-full text-left px-[12px] py-[9px] flex items-center justify-between border-b-[1px] border-b-[var(--border)] cursor-pointer font-['Nunito'] ${
                      hasSelected ? 'bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'bg-transparent'
                    }`}
                  >
                    <span className={`text-[12.5px] font-[700] ${hasSelected ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
                      {family}
                    </span>
                    <span className="text-[10.5px] text-[var(--text-dim)] flex items-center gap-1">
                      <span className="opacity-60">{fmodels.length}</span>
                      <span>›</span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
          {activeFamily !== null && (
            <>
              <button
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setActiveFamily(null); }}
                className="w-full text-left px-[12px] py-[8px] flex items-center gap-[6px] bg-transparent border-b-[1px] border-b-[var(--border)] cursor-pointer font-['Nunito'] text-[var(--accent)] font-[700] text-[12px]"
              >
                <span>‹</span>
                <span className="text-[11px] tracking-[0.05em] uppercase">{activeFamily}</span>
              </button>
              {(families.get(activeFamily) || []).map(m => (
                <button
                  key={m.id}
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange(m.id); setShowModels(false); setActiveFamily(null); }}
                  className={`w-full text-left px-[12px] py-[8px] flex items-center justify-between cursor-pointer font-['Nunito'] font-[600] text-[12.5px] transition-all duration-100 ${
                    m.id === value ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-l-[2px] border-l-[var(--accent)]' : 'bg-transparent text-[var(--text-muted)] border-l-[2px] border-l-transparent'
                  }`}
                >
                  <span className="flex flex-col min-w-0 flex-1 gap-[2px]">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {m.name.replace(new RegExp(`^${activeFamily}[\\s/:-]*`, 'i'), '') || m.name}
                    </span>
                    <span className={`flex gap-[5px] items-center ${m.id === value ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                      <CapIcon kind="text" />
                      {m.supportsVision && <CapIcon kind="vision" />}
                      {m.supportsAudioInput && <CapIcon kind="audio" />}
                      {m.supportsTools && <CapIcon kind="tools" />}
                      {(() => {
                        const s = supplyByModel.get(m.id);
                        if (!s) return null;
                        const color = s.supply === 0 ? '#888' : s.ratio < 1 ? '#3bd16f' : s.ratio < 3 ? '#e0b040' : '#e07070';
                        const title = s.supply === 0
                          ? 'No provider online'
                          : `${s.supply} online • queue ${s.queue} • ratio ${s.ratio.toFixed(1)}`;
                        return <span title={title} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: color, marginLeft: 2 }} />;
                      })()}
                    </span>
                  </span>
                  <span className="flex flex-col items-end flex-shrink-0 ml-[6px] gap-[1px]">
                    <span className="text-[9.5px] text-[var(--text-dim)] opacity-70">
                      {getModelFamily(m)}
                    </span>
                    {m.inputCostPer1MTokensCents != null && (
                      <span className="text-[10px] text-[var(--text-dim)]">
                        {m.inputCostPer1MTokensCents === 0 ? t('modelPicker.free') : `$${(m.inputCostPer1MTokensCents / 100).toFixed(2)}/M`}
                      </span>
                    )}
                    {m.tokensPerSecond != null && (
                      <span className="text-[9.5px] text-[var(--text-dim)] opacity-70">
                        {m.tokensPerSecond}t/s
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

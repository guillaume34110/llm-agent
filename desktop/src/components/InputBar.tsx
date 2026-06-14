import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Mic, MicOff } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getModelFamily, groupModelsByFamily } from '../agent/model-routing';
import { api } from '../api';
import { loadDroppedAttachments, pickAttachments } from '../attachments/attachment-service';
import { pushToast } from '../notifications/notification-center';
import { fetchTranscribeModels, startDictation, voiceInputSupported, type DictationHandle, type TranscribeModelOption } from '../voice/speech';
import type { ComposerAttachment, ModelInfo } from '../types';
import { listProviders } from '../p2p/matchmaking-client';
import {
  getChatProviderChoice,
  parseChatProviderChoice,
  setChatProviderChoice,
  type ChatProviderChoice,
} from '../preferences/provider-choice';
import Dropdown, { type DropdownOption } from './Dropdown';
import ModelBadge from './ModelBadge';
import LocalRuntimeToggle from './LocalRuntimeToggle';
import { getLocalModelPick, setLocalModelPick, isOnline, subscribeRuntimeMode } from '../preferences/runtime-mode';
import { updatePreferences } from '../preferences/preferences-service';
import { getCurrentAnimal, subscribe as subscribeAnimal } from '../animals/animal-service';
import { estimateCostCents, formatCostBadge } from '../agent/pricing';
import { findByGgufFile } from '../models/catalog';
import { canonicalModelId, resolveModelIdAlias } from '../models/model-id-alias';
import { saveDraft, loadDraft, clearDraft } from './input-draft';
import { pushHistory, getHistory } from './input-history';

interface Props {
  onSend: (payload: {
    text: string;
    attachments: ComposerAttachment[];
    modelId: string;
    imageModelId: string;
    imageSize: string;
    musicModelId: string;
    videoModelId: string;
    providerMode: 'local' | 'friend';
    providerUserId?: string;
  }) => void;
  onStop?: () => void;
  loading: boolean;
  defaultText?: string;
  autoSpeak: boolean;
  onAutoSpeakChange: (value: boolean) => void;
  voiceInputLocale: string;
  voiceInputModel: string;
  onVoiceInputModelChange: (id: string) => void;
  imageModelId: string;
  imageSize: string;
  musicModelId: string;
  videoModelId: string;
  preferredModelId?: string;
  preferredModelFamily?: string;
  sessionUsage?: { promptTokens: number; completionTokens: number; lastTokPerSec: number };
  activeModelId?: string;
  compact?: boolean;
}

export default function InputBar({
  onSend,
  onStop,
  loading,
  defaultText = '',
  autoSpeak,
  onAutoSpeakChange,
  voiceInputLocale,
  voiceInputModel,
  onVoiceInputModelChange,
  imageModelId,
  imageSize,
  musicModelId,
  videoModelId,
  preferredModelId = '',
  preferredModelFamily = '',
  sessionUsage,
  activeModelId = '',
  compact = false,
}: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => loadDraft() || defaultText);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const draftBeforeHistory = useRef('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [onlineMode, setOnlineMode] = useState(isOnline());
  useEffect(() => subscribeRuntimeMode(() => {
    setOnlineMode(isOnline());
    setSelectedModelState(canonicalModelId(getLocalModelPick() || preferredModelId));
  }), []);
  const [selectedModel, setSelectedModelState] = useState(() => canonicalModelId(getLocalModelPick() || preferredModelId));
  const setSelectedModel = (id: string) => {
    const normalizedId = canonicalModelId(id);
    setSelectedModelState(normalizedId);
    if (!onlineMode) setLocalModelPick(id);
  };
  const pickModelByUser = (id: string) => {
    setSelectedModel(id);
    const normalizedId = canonicalModelId(id);
    const info = models.find(m => m.id === normalizedId);
    if (info) updatePreferences({ primaryAgentModelId: normalizedId, agentModelFamily: getModelFamily(info) });
  };
  const [animalName, setAnimalName] = useState(() => getCurrentAnimal().displayName);
  useEffect(() => subscribeAnimal(a => {
    setSelectedModelState(canonicalModelId(getLocalModelPick() || preferredModelId));
    setAnimalName(a.displayName);
  }), []);
  const [focused, setFocused] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [transcribeModels, setTranscribeModels] = useState<TranscribeModelOption[]>([]);
  const [providerChoice, setProviderChoiceState] = useState<ChatProviderChoice>(() => getChatProviderChoice());
  const [providerOptions, setProviderOptions] = useState<DropdownOption[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);

  useEffect(() => { fetchTranscribeModels().then(setTranscribeModels); }, []);
  useEffect(() => {
    if (!voiceInputModel && transcribeModels.length > 0) {
      onVoiceInputModelChange(transcribeModels[0].value);
    }
  }, [voiceInputModel, transcribeModels, onVoiceInputModelChange]);
  const [showOptions, setShowOptions] = useState(false);
  const [combinedOpen, setCombinedOpen] = useState(false);
  const [combinedPos, setCombinedPos] = useState<{ left: number; bottom: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const combinedRef = useRef<HTMLDivElement>(null);
  const combinedBtnRef = useRef<HTMLButtonElement>(null);
  const combinedPopoverRef = useRef<HTMLDivElement>(null);
  const dictationRef = useRef<DictationHandle | null>(null);
  const voicePrefixRef = useRef('');

  useEffect(() => {
    if (!showOptions) return;
    const handler = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) setShowOptions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOptions]);

  useEffect(() => {
    if (!combinedOpen) {
      setCombinedPos(null);
      return;
    }
    const compute = () => {
      const btn = combinedBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setCombinedPos({
        left: Math.round(r.left),
        bottom: Math.round(window.innerHeight - r.top + 6),
      });
    };
    compute();
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (combinedRef.current?.contains(t)) return;
      if (combinedPopoverRef.current?.contains(t)) return;
      setCombinedOpen(false);
    };
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    document.addEventListener('mousedown', handler);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
      document.removeEventListener('mousedown', handler);
    };
  }, [combinedOpen]);

  useEffect(() => { if (defaultText) setText(defaultText); }, [defaultText]);

  // Persist draft — only when not browsing history.
  useEffect(() => { if (historyIdx === -1) saveDraft(text); }, [text, historyIdx]);

  const setProviderChoice = (value: string) => {
    const next = (value === 'local' ? 'local' : `friend:${value.slice('friend:'.length)}`) as ChatProviderChoice;
    setProviderChoiceState(next);
    setChatProviderChoice(next);
  };

  useEffect(() => {
    api.getModels().then(list => {
      setModels(list);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!models.length) return;
    if (getLocalModelPick()) return; // P2P explicit pick — don't override
    const withTools = models.filter(model => model.supportsTools !== false);
    const availableIds = withTools.map(model => model.id);
    const resolvedSelectedModel = resolveModelIdAlias(selectedModel, availableIds);
    const resolvedPreferredModelId = resolveModelIdAlias(preferredModelId, availableIds);
    const familyMap = groupModelsByFamily(withTools);
    const familyModels = preferredModelFamily && familyMap.has(preferredModelFamily)
      ? familyMap.get(preferredModelFamily)!
      : withTools;
    const currentInfo = models.find(model => model.id === resolvedSelectedModel);
    const currentFamily = currentInfo ? getModelFamily(currentInfo) : '';
    const next =
      familyModels.find(model => model.id === resolvedPreferredModelId) ||
      withTools.find(model => model.id === resolvedPreferredModelId) ||
      familyModels[0] ||
      withTools[0] ||
      models[0];
    if (
      next &&
      (
        !resolvedSelectedModel ||
        !currentInfo ||
        (preferredModelFamily && currentFamily !== preferredModelFamily) ||
        resolvedSelectedModel !== selectedModel
      )
    ) {
      setSelectedModel(next.id);
    }
  }, [models, preferredModelFamily, preferredModelId, selectedModel]);

  useEffect(() => {
    if (!models.length) return;
    if (getLocalModelPick()) return; // P2P explicit pick — don't override
    let cancelled = false;
    invoke<{ modelPath: string } | null>('llama_runtime_info')
      .then(info => {
        if (cancelled || !info?.modelPath) return;
        const file = info.modelPath.split(/[\\/]/).pop() || '';
        const runningCatalogModel = findByGgufFile(file);
        if (!runningCatalogModel) return;
        const resolvedRunningModel = resolveModelIdAlias(runningCatalogModel.id, models.map(model => model.id));
        if (resolvedRunningModel && resolvedRunningModel !== selectedModel) {
          setSelectedModel(resolvedRunningModel);
        }
        if (resolvedRunningModel && canonicalModelId(preferredModelId) !== canonicalModelId(resolvedRunningModel)) {
          const runningInfo = models.find(model => model.id === resolvedRunningModel);
          updatePreferences({
            primaryAgentModelId: resolvedRunningModel,
            agentModelFamily: runningInfo ? getModelFamily(runningInfo) : preferredModelFamily,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [models, preferredModelFamily, preferredModelId, selectedModel]);

  useEffect(() => {
    const localOption: DropdownOption = {
      value: 'local',
      label: t('inputBar.providerLocal'),
      hint: t('inputBar.providerLocalHint'),
    };
    let cancelled = false;
    setProvidersLoading(true);
    listProviders(selectedModel)
      .then(({ providers }) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const friendOptions: DropdownOption[] = [];
        for (const provider of providers) {
          if (!provider.userId || seen.has(provider.userId)) continue;
          seen.add(provider.userId);
          friendOptions.push({
            value: `friend:${provider.userId}`,
            label: t('inputBar.providerFriend', { id: provider.userId.slice(0, 12) }),
            hint: t('inputBar.providerFriendHint'),
          });
        }
        const nextOptions = [localOption, ...friendOptions];
        setProviderOptions(nextOptions);
        if (!nextOptions.some(option => option.value === providerChoice)) {
          setProviderChoice('local');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setProviderOptions([localOption]);
        if (providerChoice !== 'local') setProviderChoice('local');
      })
      .finally(() => {
        if (!cancelled) setProvidersLoading(false);
      });
    return () => { cancelled = true; };
  }, [providerChoice, selectedModel, t]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
  }, [text]);

  const selectedInfo = models.find(m => m.id === selectedModel);
  const availableIds = models.map(m => m.id);
  const resolvedActiveId = activeModelId ? resolveModelIdAlias(activeModelId, availableIds) : '';
  const activeInfo = resolvedActiveId ? models.find(m => m.id === resolvedActiveId) : undefined;
  const badgeModelName = activeInfo?.name
    || selectedInfo?.name
    || activeInfo?.id
    || selectedInfo?.id
    || resolvedActiveId
    || activeModelId
    || selectedModel;

  const canSend = (!!text.trim() || attachments.length > 0) && !loading;

  const attachFiles = async () => {
    try {
      const picked = await pickAttachments();
      if (!picked.length) return;
      setAttachments(prev => [...prev, ...picked]);
    } catch (error) {
      pushToast({ title: t('inputBar.attachments'), body: error instanceof Error ? error.message : String(error), tone: 'error' });
    }
  };

  const toggleVoice = async () => {
    if (voiceActive) {
      dictationRef.current?.stop();
      setVoiceActive(false);
      return;
    }
    voicePrefixRef.current = text.trim();
    setVoiceError('');
    const handle = await startDictation({
      model: voiceInputModel,
      language: (voiceInputLocale || 'fr-FR').slice(0, 2),
      onText: transcript => {
        const prefix = voicePrefixRef.current.trim();
        setText([prefix, transcript].filter(Boolean).join(prefix ? ' ' : ''));
      },
      onState: state => {
        if (state === 'recording') setVoiceActive(true);
        if (state === 'uploading') { setVoiceActive(false); setVoiceUploading(true); }
        if (state === 'done' || state === 'idle' || state === 'error') {
          setVoiceActive(false);
          setVoiceUploading(false);
        }
      },
      onError: message => {
        setVoiceError(message);
        setVoiceActive(false);
        setVoiceUploading(false);
      },
    });
    if (!handle) return;
    dictationRef.current = handle;
  };

  const send = () => {
    if ((!text.trim() && attachments.length === 0) || loading) return;
    const provider = parseChatProviderChoice(providerChoice);
    if (text.trim()) pushHistory(text.trim());
    onSend({
      text: text.trim() || t('inputBar.defaultAttachmentMessage'),
      attachments,
      modelId: selectedModel,
      imageModelId,
      imageSize,
      musicModelId,
      videoModelId,
      providerMode: provider.providerMode,
      providerUserId: provider.providerUserId,
    });
    setText('');
    clearDraft();
    setHistoryIdx(-1);
    setAttachments([]);
    setVoiceActive(false);
    dictationRef.current?.cancel();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); return; }
    if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0) {
      const history = getHistory();
      if (!history.length) return;
      e.preventDefault();
      if (historyIdx === -1) draftBeforeHistory.current = text;
      const nextIdx = historyIdx + 1;
      if (nextIdx < history.length) {
        setHistoryIdx(nextIdx);
        setText(history[nextIdx]);
      }
      return;
    }
    if (e.key === 'ArrowDown' && historyIdx >= 0) {
      e.preventDefault();
      const nextIdx = historyIdx - 1;
      if (nextIdx < 0) {
        setHistoryIdx(-1);
        setText(draftBeforeHistory.current);
      } else {
        setHistoryIdx(nextIdx);
        setText(getHistory()[nextIdx]);
      }
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
      setHistoryIdx(-1);
    }
  };

  return (
    <div
      className={`shrink-0 ${compact ? 'border-t-0 bg-transparent py-1 px-0' : 'py-3 px-4'}`}
      style={compact ? undefined : {
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        borderTop: '1px solid var(--glass-border)',
      }}
      onDragOver={event => {
        event.preventDefault();
        setDraggingFiles(true);
      }}
      onDragLeave={event => {
        if ((event.currentTarget as HTMLDivElement).contains(event.relatedTarget as Node)) return;
        setDraggingFiles(false);
      }}
      onDrop={async event => {
        event.preventDefault();
        setDraggingFiles(false);
        try {
          const dropped = await loadDroppedAttachments(event.dataTransfer.files);
          if (dropped.length) setAttachments(prev => [...prev, ...dropped]);
        } catch (error) {
          pushToast({ title: t('inputBar.attachments'), body: error instanceof Error ? error.message : String(error), tone: 'error' });
        }
      }}
    >
      {(attachments.length > 0 || draggingFiles || voiceError) && (
        <div className={`mb-2.5 rounded-[var(--rm)] grid gap-2 p-3 ${draggingFiles ? 'border border-dashed border-[var(--accent)] bg-[var(--accent-soft)]' : 'border border-solid border-[var(--glass-border)] bg-[var(--glass-bg-strong)]'}`}>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map(attachment => (
                <div key={attachment.id} className="flex items-center gap-2 max-w-[260px] rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-2.5 py-1.5 text-[var(--text)]">
                  <span className="overflow-hidden overflow-ellipsis whitespace-nowrap text-[11.5px] font-bold">
                    {attachment.name}
                  </span>
                  <span className="text-[10.5px] text-[var(--text-dim)]">{attachment.kind}</span>
                  <button
                    onClick={() => setAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                    aria-label={t('inputBar.removeAttachment')}
                    className="border-none bg-transparent text-[var(--text-dim)] cursor-pointer text-[14px] leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {draggingFiles && (
            <div className="text-[11.5px] font-black text-[var(--accent)]">
              {t('inputBar.dropFilesMessage')}
            </div>
          )}
          {voiceError && (
            <div className="text-[11.5px] font-bold text-[var(--red)]">
              {voiceError}
            </div>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        {compact ? null : (
          /* Full mode: stacked column — model badge/picker + provider select + usage */
          <div className="flex flex-col gap-1 shrink-0 self-end">
            <ModelBadge modelName={badgeModelName} loading={loading} />
            <div className="w-[172px]">
              <Dropdown
                value={providerChoice}
                onChange={setProviderChoice}
                options={providerOptions}
                placeholder={providersLoading ? t('inputBar.providerLoading') : t('inputBar.provider')}
                title={t('inputBar.provider')}
                width="100%"
                menuWidth={260}
                direction="up"
                fontSize={11.5}
                buttonPadding="6px 10px"
              />
            </div>
            {(() => {
              const u = sessionUsage;
              if (!u || (u.promptTokens === 0 && u.completionTokens === 0)) return null;
              const inCents = selectedInfo?.inputCostPer1MTokensCents ?? 0;
              const outCents = selectedInfo?.outputCostPer1MTokensCents ?? inCents;
              const cost = (u.promptTokens * inCents + u.completionTokens * outCents) / 1_000_000 / 100;
              const tps = u.lastTokPerSec || 0;
              return (
                <div
                  title={`prompt ${u.promptTokens} · completion ${u.completionTokens}`}
                  className="rounded-full border border-[var(--glass-border)] bg-[var(--bg3)] px-2 py-[2px] w-[172px] overflow-hidden overflow-ellipsis whitespace-nowrap text-center text-[10.5px] font-bold text-[var(--text-dim)]"
                >
                  {tps > 0 ? `${tps.toFixed(1)} tok/s` : '—'} · ${cost.toFixed(4)}
                </div>
              );
            })()}
          </div>
        )}
        <div className={`flex-1 flex gap-2 rounded-[var(--rm)] transition-[border-color,background] duration-200 ${compact
          ? `items-center ${focused ? 'border border-[var(--accent)] bg-[var(--bg2)]' : 'border border-transparent bg-[var(--bg2-alt,var(--bg2))]'} px-1.5 py-1`
          : `items-end ${focused ? 'border border-[var(--accent)]' : 'border border-[var(--glass-border)]'} bg-[var(--glass-bg-strong)] px-3 py-2`
        }`}>
          <div ref={optionsRef} className={`relative ${compact ? 'self-center' : 'self-end'}`}>
            {(() => {
              const active = attachments.length > 0 || voiceActive || autoSpeak;
              return (
                <button
                  onClick={() => setShowOptions(v => !v)}
                  title={t('inputBar.inputOptions')}
                  aria-label={t('inputBar.openInputOptions')}
                  className={`w-[28px] h-[28px] rounded-full cursor-pointer font-black text-[15px] leading-none ${active || showOptions ? 'border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}
                >⋯</button>
              );
            })()}
            {showOptions && (
              <div className="absolute left-0 bottom-[calc(100%+6px)] z-[100] w-[220px] overflow-hidden rounded-[var(--rm)] glass-card-strong font-[Nunito]">
                <button
                  onMouseDown={e => { e.preventDefault(); attachFiles(); setShowOptions(false); }}
                  className={`w-full flex items-center justify-between gap-2 border-b border-[var(--glass-border)] px-3 py-2.5 text-left cursor-pointer font-bold font-[Nunito] text-[12.5px] ${attachments.length > 0 ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-transparent text-[var(--text)]'}`}
                >
                  <span>{t('inputBar.attachments')}</span>
                  <span className="text-[11px] text-[var(--text-dim)]">
                    {attachments.length > 0 ? `${attachments.length}` : '+'}
                  </span>
                </button>
                <button
                  onMouseDown={e => { e.preventDefault(); if (voiceInputSupported()) { toggleVoice(); setShowOptions(false); } }}
                  disabled={!voiceInputSupported()}
                  className={`w-full flex items-center justify-between gap-2 border-b border-[var(--glass-border)] px-3 py-2.5 text-left font-bold font-[Nunito] text-[12.5px] ${voiceInputSupported() ? 'cursor-pointer opacity-100' : 'cursor-not-allowed opacity-45'} ${voiceActive ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-transparent text-[var(--text)]'}`}
                >
                  <span>{t('inputBar.dictation')}</span>
                  <span className={`text-[11px] ${voiceActive ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'}`}>
                    {voiceActive ? t('inputBar.stop') : voiceUploading ? t('inputBar.transcribing') : voiceInputSupported() ? t('inputBar.configure') : 'N/A'}
                  </span>
                </button>
                <div className="flex flex-col gap-1 border-b border-[var(--glass-border)] px-3 py-2">
                  <span className="text-[10.5px] font-bold uppercase text-[var(--text-dim)] tracking-[0.5px]">
                    {t('inputBar.dictationModel')}
                  </span>
                  <Dropdown
                    value={voiceInputModel}
                    onChange={onVoiceInputModelChange}
                    options={transcribeModels.length === 0
                      ? [{ value: voiceInputModel, label: voiceInputModel || t('inputBar.loading') }]
                      : transcribeModels.map(o => ({ value: o.value, label: o.label, hint: o.hint }))}
                    placeholder={t('inputBar.dictationModel')}
                    menuWidth={260}
                    direction="up"
                  />
                </div>
                <button
                  onMouseDown={e => { e.preventDefault(); onAutoSpeakChange(!autoSpeak); }}
                  className={`w-full flex items-center justify-between gap-2 border-none px-3 py-2.5 text-left cursor-pointer font-bold font-[Nunito] text-[12.5px] ${autoSpeak ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-transparent text-[var(--text)]'}`}
                >
                  <span>{t('inputBar.voiceOutput')}</span>
                  <span className="text-[11px] text-[var(--text-dim)]">{autoSpeak ? t('inputBar.on') : t('inputBar.off')}</span>
                </button>
              </div>
            )}
          </div>
          <textarea
            ref={textareaRef}
            placeholder={t('inputBar.messagePrompt', { animal: animalName })}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            className="flex-1 bg-none border-none outline-none resize-none text-[13.5px] text-[var(--text)] font-[Nunito] font-medium leading-[1.5] p-0"
          />
          {selectedInfo?.inputCostPer1MTokensCents != null && (
            <span
              title={t('inputBar.costEstimate')}
              className="ml-2 text-[10.5px] text-[var(--text-dim)] opacity-70"
            >
              ~{formatCostBadge(estimateCostCents(text, selectedInfo))}
            </span>
          )}
          {voiceInputSupported() && (
            <button
              onClick={toggleVoice}
              disabled={loading || voiceUploading}
              title={voiceActive ? t('inputBar.stop') : t('inputBar.dictation')}
              aria-label={voiceActive ? t('inputBar.stop') : t('inputBar.dictation')}
              aria-pressed={voiceActive}
              className={`shrink-0 w-[30px] h-[30px] rounded-full flex items-center justify-center transition-all duration-150 ${
                voiceActive
                  ? 'border-none bg-[var(--red)] text-white cursor-pointer animate-pulse shadow-[0_2px_8px_color-mix(in_srgb,var(--red)_30%,transparent)]'
                  : voiceUploading
                    ? 'border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-[var(--accent)] cursor-wait'
                    : 'border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)] cursor-pointer'
              } ${compact ? 'self-center' : 'self-end'}`}
            >
              {voiceActive ? <MicOff size={14} strokeWidth={2.5} /> : <Mic size={14} strokeWidth={2.5} />}
            </button>
          )}
          {loading && onStop ? (
            <button
              onClick={onStop}
              title={t('inputBar.stop')}
              aria-label={t('inputBar.stopGeneration', { animal: animalName })}
              className={`shrink-0 w-[30px] h-[30px] rounded-full border-none bg-[var(--red)] text-white cursor-pointer text-[14px] font-black flex items-center justify-center transition-all duration-150 shadow-[0_2px_8px_color-mix(in_srgb,var(--red)_30%,transparent)] ${compact ? 'self-center' : 'self-end'}`}
            >
              <span className="inline-block w-[9px] h-[9px] rounded bg-white" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!canSend}
              aria-label={t('inputBar.sendMessage')}
              className={`shrink-0 w-[30px] h-[30px] rounded-full border-none text-[16px] font-bold flex items-center justify-center transition-all duration-150 ${canSend ? 'bg-[var(--accent)] text-[var(--on-accent)] cursor-pointer shadow-[0_2px_8px_var(--accent-glow)]' : 'bg-[var(--glass-bg-strong)] text-[var(--text-dim)] cursor-not-allowed shadow-none'} ${compact ? 'self-center' : 'self-end'}`}
            >
              {loading ? <span className="dot inline-block w-[6px] h-[6px] rounded-full bg-[var(--text-dim)]" /> : '↑'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

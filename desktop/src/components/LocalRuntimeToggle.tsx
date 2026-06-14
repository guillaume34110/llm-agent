import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getRuntimeMode,
  subscribeRuntimeMode,
  getLocalModelPick,
} from '../preferences/runtime-mode';
import { type AutoProgress } from '../llama/auto-runtime';
import {
  getLocalBusy,
  getLocalProgress,
  subscribeLocalRuntime,
  toggleLocalRuntime,
} from '../llama/local-runtime';
import { getPreferences } from '../preferences/preferences-service';
import { pushToast } from '../notifications/notification-center';

interface Props {
  size?: number;
}

const RING_CIRC = 2 * Math.PI * 16;

export default function LocalRuntimeToggle({ size = 42 }: Props) {
  const { t } = useTranslation();
  const [runtimeMode, setRuntimeModeState] = useState(getRuntimeMode());
  useEffect(() => subscribeRuntimeMode(() => setRuntimeModeState(getRuntimeMode())), []);
  const localOn = runtimeMode === 'local';
  const [localBusy, setLocalBusyState] = useState<boolean>(() => getLocalBusy());
  const [localProgress, setLocalProgressState] = useState<AutoProgress | null>(() => getLocalProgress());
  useEffect(() => subscribeLocalRuntime(() => {
    setLocalBusyState(getLocalBusy());
    setLocalProgressState(getLocalProgress());
  }), []);

  const toggle = async () => {
    if (localBusy) return;
    const wasOn = localOn;
    try {
      const pick = getLocalModelPick() || getPreferences().primaryAgentModelId || undefined;
      await toggleLocalRuntime({ preferModelId: pick, mode: 'shared' });
    } catch (e) {
      pushToast({
        title: t(wasOn ? 'topBar.localStopFailed' : 'topBar.localStartFailed', {
          defaultValue: wasOn ? 'Stop failed' : 'Start failed',
        }),
        body: e instanceof Error ? e.message : String(e),
        tone: 'error',
      });
    }
  };

  const tooltip = (() => {
    if (localBusy && localProgress) {
      const p = localProgress;
      if (p.phase === 'downloading') return t('topBar.localDownloading', { pct: p.pct ?? 0 });
      if (p.phase === 'verifying') return t('topBar.localVerifying');
      if (p.phase === 'probing' || p.phase === 'cleaning' || p.phase === 'starting') {
        return t('topBar.localStarting');
      }
    }
    if (localBusy && localOn) return t('topBar.localStopping');
    return localOn ? t('topBar.disableLocal') : t('topBar.enableLocal');
  })();

  const downloadPct = localProgress?.phase === 'downloading'
    ? Math.max(0, Math.min(100, localProgress.pct ?? 0))
    : 0;

  const svgSize = Math.round(size * (32 / 42));

  return (
    <button
      onClick={toggle}
      disabled={localBusy}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={localOn}
      aria-busy={localBusy}
      className={`relative shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ${
        localBusy ? 'cursor-wait' : 'cursor-pointer hover:scale-105 active:scale-95'
      }`}
      style={{
        width: size,
        height: size,
        background: localOn
          ? 'radial-gradient(circle at 35% 30%, var(--accent-glow), var(--accent-2-soft) 70%, transparent 100%), var(--glass-bg-strong)'
          : localBusy
            ? 'radial-gradient(circle at 50% 50%, var(--accent-soft), transparent 80%), var(--glass-bg-strong)'
            : 'var(--glass-bg-strong)',
        border: `1px solid ${
          localOn ? 'var(--accent)'
            : localBusy ? 'color-mix(in srgb, var(--accent) 65%, transparent)'
            : 'var(--glass-border)'
        }`,
        boxShadow: localOn
          ? '0 0 16px var(--accent-glow), 0 0 32px var(--accent-2-glow), inset 0 0 8px color-mix(in srgb, var(--accent) 20%, transparent)'
          : localBusy
            ? '0 0 10px var(--accent-glow)'
            : 'inset 0 1px 0 color-mix(in srgb, white 4%, transparent)',
      }}
    >
      <svg width={svgSize} height={svgSize} viewBox="0 0 44 44" fill="none" aria-hidden="true" className="overflow-visible">
        <defs>
          <radialGradient id="lcCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.85" />
            <stop offset="55%" stopColor="var(--accent-2)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent-3)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lcRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="50%" stopColor="var(--accent-2)" />
            <stop offset="100%" stopColor="var(--accent-3)" />
          </linearGradient>
          <linearGradient id="lcGlyph" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>

        {!localOn && !localBusy && (
          <g>
            <circle cx="22" cy="22" r="15" stroke="var(--text-dim)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 3" fill="none" />
            <circle cx="33" cy="33" r="3" fill="var(--red)" opacity="0.9" />
            <circle cx="33" cy="33" r="3" fill="none" stroke="var(--bg)" strokeWidth="1.3" />
          </g>
        )}

        {localBusy && (
          <g>
            <circle cx="22" cy="22" r="18" fill="url(#lcCore)" opacity="0.5">
              <animate attributeName="opacity" values="0.35;0.7;0.35" dur="1.4s" repeatCount="indefinite" />
            </circle>
            <circle cx="22" cy="22" r="16" stroke="var(--accent)" strokeOpacity="0.18" strokeWidth="2.4" fill="none" />
            {localProgress?.phase === 'downloading' ? (
              <circle
                cx="22" cy="22" r="16"
                stroke="url(#lcRing)" strokeWidth="2.8" strokeLinecap="round" fill="none"
                strokeDasharray={`${(downloadPct / 100) * RING_CIRC} ${RING_CIRC}`}
                transform="rotate(-90 22 22)"
                style={{ transition: 'stroke-dasharray 250ms ease-out' }}
              />
            ) : (
              <>
                <circle cx="22" cy="22" r="16" stroke="url(#lcRing)" strokeWidth="2.8" strokeLinecap="round" fill="none" strokeDasharray="26 75.4">
                  <animateTransform attributeName="transform" type="rotate" from="0 22 22" to="360 22 22" dur="1.1s" repeatCount="indefinite" />
                </circle>
                <circle cx="22" cy="22" r="10" stroke="var(--accent-2)" strokeWidth="1.8" strokeLinecap="round" fill="none" strokeDasharray="14 49" opacity="0.75">
                  <animateTransform attributeName="transform" type="rotate" from="360 22 22" to="0 22 22" dur="1.6s" repeatCount="indefinite" />
                </circle>
              </>
            )}
            <circle cx="33" cy="33" r="3" fill="var(--accent-2)">
              <animate attributeName="opacity" values="1;0.4;1" dur="0.9s" repeatCount="indefinite" />
            </circle>
            <circle cx="33" cy="33" r="3" fill="none" stroke="var(--bg)" strokeWidth="1.3" />
          </g>
        )}

        {localOn && !localBusy && (
          <g>
            <circle cx="22" cy="22" r="20" fill="url(#lcCore)">
              <animate attributeName="opacity" values="0.85;1;0.85" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx="22" cy="22" r="14" stroke="var(--accent)" strokeWidth="1.8" fill="none">
              <animate attributeName="r" values="14;22;14" dur="3.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.85;0;0.85" dur="3.2s" repeatCount="indefinite" />
              <animate attributeName="stroke-width" values="1.8;0.4;1.8" dur="3.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="22" cy="22" r="14" stroke="var(--accent-2)" strokeWidth="1.4" fill="none">
              <animate attributeName="r" values="14;22;14" dur="3.2s" begin="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0;0.7" dur="3.2s" begin="1.6s" repeatCount="indefinite" />
              <animate attributeName="stroke-width" values="1.4;0.3;1.4" dur="3.2s" begin="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx="22" cy="22" r="14" stroke="var(--accent-3)" strokeWidth="1" fill="none">
              <animate attributeName="r" values="14;22;14" dur="3.2s" begin="0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0;0.6" dur="3.2s" begin="0.8s" repeatCount="indefinite" />
            </circle>
            <circle cx="22" cy="22" r="15" stroke="url(#lcRing)" strokeWidth="1.4" fill="none" strokeDasharray="4 5" strokeOpacity="0.9">
              <animateTransform attributeName="transform" type="rotate" from="0 22 22" to="360 22 22" dur="14s" repeatCount="indefinite" />
            </circle>
            <g>
              <circle cx="22" cy="6" r="2" fill="var(--accent-2)" />
              <animateTransform attributeName="transform" type="rotate" from="0 22 22" to="360 22 22" dur="5s" repeatCount="indefinite" />
            </g>
            <g>
              <circle cx="22" cy="38" r="1.5" fill="var(--accent-3)" opacity="0.9" />
              <animateTransform attributeName="transform" type="rotate" from="0 22 22" to="-360 22 22" dur="7s" repeatCount="indefinite" />
            </g>
            <g>
              <circle cx="6" cy="22" r="1.2" fill="var(--accent)" opacity="0.8" />
              <animateTransform attributeName="transform" type="rotate" from="0 22 22" to="360 22 22" dur="3.5s" repeatCount="indefinite" />
            </g>
            <circle cx="33" cy="33" r="3.2" fill="var(--accent)">
              <animate attributeName="opacity" values="1;0.55;1" dur="1.4s" repeatCount="indefinite" />
            </circle>
            <circle cx="33" cy="33" r="3.2" fill="none" stroke="var(--bg)" strokeWidth="1.3" />
          </g>
        )}

        <g
          stroke={localOn ? 'url(#lcGlyph)' : 'var(--text-dim)'}
          strokeOpacity={localBusy ? 0.95 : localOn ? 1 : 0.7}
          strokeWidth={localBusy ? 2.6 : 2.2}
          strokeLinecap="round"
          fill="none"
          style={{
            opacity: localOn ? 0 : 1,
            transform: localOn ? 'rotate(180deg) scale(0.2)' : 'rotate(0deg) scale(1)',
            transformOrigin: '22px 22px',
            transformBox: 'view-box',
            transition: 'opacity 450ms ease, transform 600ms cubic-bezier(0.45, 0, 0.2, 1.1), stroke 300ms ease, stroke-width 300ms ease',
          }}
        >
          <path d="M 26.5 16 A 6.5 6.5 0 1 1 17.5 16">
            {localBusy && (
              <animate attributeName="stroke-opacity" values="0.7;1;0.7" dur="1.4s" repeatCount="indefinite" />
            )}
          </path>
          <line x1="22" y1="12.5" x2="22" y2="18.5">
            {localBusy && (
              <animate attributeName="stroke-opacity" values="0.7;1;0.7" dur="1.4s" repeatCount="indefinite" />
            )}
          </line>
        </g>

        <g
          stroke="url(#lcGlyph)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          style={{
            opacity: localOn ? 1 : 0,
            transform: localOn ? 'rotate(0deg) scale(1)' : 'rotate(-180deg) scale(0.2)',
            transformOrigin: '22px 22px',
            transformBox: 'view-box',
            transition: 'opacity 450ms ease 60ms, transform 600ms cubic-bezier(0.45, 0, 0.2, 1.1) 60ms',
          }}
        >
          <rect x="15" y="15" width="14" height="14" rx="2" />
          <rect x="19" y="19" width="6" height="6">
            <animate attributeName="stroke-width" values="2;2.6;2" dur="1.8s" repeatCount="indefinite" />
          </rect>
          <path d="M 18 13 v 2 M 26 13 v 2" />
          <path d="M 18 29 v 2 M 26 29 v 2" />
          <path d="M 13 18 h 2 M 13 26 h 2" />
          <path d="M 29 18 h 2 M 29 26 h 2" />
        </g>
      </svg>
    </button>
  );
}

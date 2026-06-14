import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getWidgetMode, subscribeWidgetMode, toggleWidgetMode, type WidgetMode } from '../widget/widget-mode';

const SIZE = 28;

export default function CornerExpandButton() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<WidgetMode>(getWidgetMode());
  useEffect(() => subscribeWidgetMode(setMode), []);

  const isWidget = mode === 'widget';
  const title = isWidget ? t('cornerExpand.expand') : t('cornerExpand.collapse');

  return (
    <>
      <style>{`
        @keyframes corner-glow {
          0%, 100% { filter: drop-shadow(2px 3px 4px rgba(0,0,0,.55)) drop-shadow(0 0 4px var(--accent-glow)); }
          50%      { filter: drop-shadow(2px 3px 5px rgba(0,0,0,.6))  drop-shadow(0 0 9px var(--accent-glow)); }
        }
        .corner-tri {
          position: fixed;
          top: 0;
          right: 0;
          z-index: 9999;
          width: ${SIZE}px;
          height: ${SIZE}px;
          border: none;
          background: transparent;
          padding: 0;
          cursor: pointer;
          -webkit-app-region: no-drag;
          animation: corner-glow 2.4s ease-in-out infinite;
          transition: transform 0.15s ease;
        }
        .corner-tri:hover { transform: scale(1.08); transform-origin: top right; }
        .corner-tri:active { transform: scale(0.94); transform-origin: top right; }
        .corner-tri svg { display: block; }
        .corner-tri .icon {
          position: absolute;
          top: 4px;
          right: 4px;
          color: var(--bg);
          pointer-events: none;
        }
      `}</style>
      <button
        type="button"
        className="corner-tri"
        title={title}
        aria-label={title}
        onClick={() => { void toggleWidgetMode(); }}
      >
        <svg width={SIZE} height={SIZE} viewBox="0 0 28 28" fill="none">
          <defs>
            <linearGradient id="ctri-body" x1="28" y1="0" x2="4" y2="24" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="var(--accent)"/>
              <stop offset="55%"  stopColor="var(--accent)"/>
              <stop offset="100%" stopColor="#000" stopOpacity="0.55"/>
            </linearGradient>
            <clipPath id="ctri-clip">
              <path d="M28 0 L28 28 C 28 28, 16 19, 10 13 C 6 9, 2 3, 0 0 Z"/>
            </clipPath>
          </defs>
          <path
            d="M28 0 L28 28 C 28 28, 16 19, 10 13 C 6 9, 2 3, 0 0 Z"
            fill="url(#ctri-body)"
          />
          <g clipPath="url(#ctri-clip)">
            {/* dark inner shadow hugging the curved edge */}
            <path
              d="M10 13 C 6 9, 2 3, 0 0 L 0 5 C 5 8, 9 12, 13 16 Z"
              fill="#000"
              fillOpacity="0.45"
            />
            {/* subtle bottom-left vignette */}
            <path
              d="M28 28 L 10 13 C 14 19, 20 25, 28 28 Z"
              fill="#000"
              fillOpacity="0.2"
            />
          </g>
        </svg>
        <span className="icon">
          {isWidget ? (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6M20 4l-8 8"/>
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10V4h-6M14 10l6-6"/>
            </svg>
          )}
        </span>
      </button>
    </>
  );
}

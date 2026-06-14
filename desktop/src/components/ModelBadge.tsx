import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  width?: number | string;
  modelName?: string;
  loading?: boolean;
}

export default function ModelBadge({ width = 172, modelName, loading = false }: Props) {
  const { t } = useTranslation();
  const hasModel = !!modelName && modelName.trim().length > 0;
  const label = hasModel
    ? modelName!
    : t('inputBar.waitingModel', { defaultValue: 'Waiting…' });

  const boltAnim = loading
    ? 'modelbadge-bolt-pulse 0.9s ease-in-out infinite'
    : hasModel
      ? 'none'
      : 'modelbadge-bolt-wait 1.6s ease-in-out infinite';

  return (
    <>
      <style>{`
        @keyframes modelbadge-bolt-pulse {
          0%, 100% { opacity: 0.55; transform: scale(1); filter: drop-shadow(0 0 0 var(--accent, #f5c518)); }
          50%      { opacity: 1;    transform: scale(1.25); filter: drop-shadow(0 0 4px var(--accent, #f5c518)); }
        }
        @keyframes modelbadge-bolt-wait {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 1; }
        }
        @keyframes modelbadge-sweep {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(220%); }
        }
      `}</style>
      <div
        title={hasModel
          ? t('inputBar.runningModel', { defaultValue: 'Active model: {{name}}', name: modelName })
          : t('inputBar.autoRoutedHint', { defaultValue: 'Routed automatically by the P2P matchmaker' })}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          width,
          padding: '4px 10px',
          borderRadius: 8,
          border: `1px solid ${loading ? 'var(--accent, #f5c518)' : 'var(--border, #ccc)'}`,
          background: 'var(--bg3, #2a2a2a)',
          color: 'var(--text, #eee)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'default',
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            color: loading ? 'var(--accent, #f5c518)' : undefined,
            animation: boltAnim,
          }}
        >
          ⚡
        </span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        {loading && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '40%',
              height: '100%',
              background:
                'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent, #f5c518) 22%, transparent) 50%, transparent 100%)',
              animation: 'modelbadge-sweep 1.2s linear infinite',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </>
  );
}

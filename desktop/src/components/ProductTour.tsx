import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ProductTour({ open, onClose }: Props) {
  const { t } = useTranslation();

  const TIPS = [
    { icon: '💬', titleKey: 'tour.tip1Title', bodyKey: 'tour.tip1Body' },
    { icon: '🧠', titleKey: 'tour.tip2Title', bodyKey: 'tour.tip2Body' },
    { icon: '📚', titleKey: 'tour.tip3Title', bodyKey: 'tour.tip3Body' },
    { icon: '⚙️', titleKey: 'tour.tip4Title', bodyKey: 'tour.tip4Body' },
  ];

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('tour.title')}
      onClick={onClose}
      className="fixed inset-0 bg-black/55 flex items-center justify-center z-9999"
      style={{ padding: '20px' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full bg-[var(--bg2)] border border-[var(--border)] rounded-lg shadow-lg"
        style={{
          maxWidth: '420px',
          padding: '22px',
          boxShadow: 'var(--shadow-strong)'
        }}
      >
        <div className="font-black text-[var(--text)]" style={{ fontSize: '15px', marginBottom: '4px' }}>{t('tour.title')}</div>
        <div className="text-xs text-[var(--text-dim)]" style={{ marginBottom: '16px' }}>{t('tour.subtitle')}</div>
        <div className="grid gap-2.5">
          {TIPS.map(tip => (
            <div key={tip.titleKey} className="flex gap-2.5 items-start">
              <div style={{ fontSize: '20px', lineHeight: '1' }}>{tip.icon}</div>
              <div className="flex-1">
                <div className="font-extrabold text-[var(--text)]" style={{ fontSize: '13px' }}>{t(tip.titleKey)}</div>
                <div className="text-[var(--text-muted)]" style={{ fontSize: '11.5px', marginTop: '2px' }}>{t(tip.bodyKey)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end" style={{ marginTop: '18px' }}>
          <button
            onClick={onClose}
            className="rounded border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-extrabold cursor-pointer"
            style={{
              padding: '8px 18px',
              fontSize: '12.5px',
              fontFamily: 'Nunito'
            }}
          >
            {t('tour.cta')}
          </button>
        </div>
      </div>
    </div>
  );
}

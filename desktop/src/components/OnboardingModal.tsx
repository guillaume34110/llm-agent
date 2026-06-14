import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentAnimal, subscribe as subscribeAnimal } from '../animals/animal-service';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function OnboardingModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [animalName, setAnimalName] = useState(() => getCurrentAnimal().displayName);
  useEffect(() => subscribeAnimal(a => setAnimalName(a.displayName)), []);
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const buildCards = (name: string): Array<[string, string]> => [
    [t('onboarding.card1.title'), t('onboarding.card1.desc')],
    [t('onboarding.card2.title', { name }), t('onboarding.card2.desc')],
    [t('onboarding.card3.title'), t('onboarding.card3.desc')],
    [t('onboarding.card4.title'), t('onboarding.card4.desc')],
    [t('onboarding.card5.title'), t('onboarding.card5.desc')],
    [t('onboarding.card6.title'), t('onboarding.card6.desc')],
    [t('onboarding.card7.title'), t('onboarding.card7.desc')],
    [t('onboarding.card8.title'), t('onboarding.card8.desc')],
  ];
  const cards = buildCards(animalName);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bienvenue MonkeyAgent"
      className="fixed inset-0 z-60 bg-black/60 flex items-center justify-center p-7"
      style={{ padding: '28px' }}
    >
      <div
        className="w-full max-h-screen overflow-auto rounded-3xl border border-[var(--border)] bg-gradient-to-b from-[var(--bg2)] to-[var(--bg)]"
        style={{
          maxWidth: '920px',
          maxHeight: '90vh',
          boxShadow: '0 28px 80px rgba(0, 0, 0, 0.42)'
        }}
      >
        <div className="border-b border-[var(--border)]" style={{ padding: '26px 28px 18px' }}>
          <div className="text-xs text-[var(--accent)] font-black uppercase" style={{ letterSpacing: '0.08em' }}>
            {t('onboarding.welcome', { name: animalName })}
          </div>
          <div className="mt-2.5 text-2xl font-black text-[var(--text)]" style={{ letterSpacing: '-0.03em' }}>
            {t('onboarding.headline')}
          </div>
          <p className="mt-2.5 leading-relaxed text-[var(--text-muted)]" style={{ fontSize: '13.5px', maxWidth: '720px' }}>
            {t('onboarding.description')}
          </p>
        </div>

        <div className="grid gap-3.5" style={{ padding: '28px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {cards.map(([title, body]) => (
            <div key={title} className="border border-[var(--border)] rounded-lg bg-[var(--bg3)]" style={{ padding: '16px 16px 14px' }}>
              <div className="text-sm text-[var(--text)] font-black">{title}</div>
              <div className="mt-2 leading-relaxed text-[var(--text-muted)]" style={{ fontSize: '12.5px' }}>{body}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-3.5" style={{ padding: '0 28px 26px', gridTemplateColumns: '1fr 1fr' }}>
          <div className="border border-[var(--border)] rounded-lg bg-[var(--bg3)] p-4">
            <div className="text-xs text-[var(--text-dim)] font-extrabold uppercase" style={{ letterSpacing: '0.06em' }}>
              {t('onboarding.examples.title')}
            </div>
            <div className="mt-2.5 leading-relaxed text-[var(--text)]" style={{ fontSize: '12.5px' }}>
              {t('onboarding.examples.content')}
            </div>
          </div>
          <div className="border border-[var(--border)] rounded-lg bg-[var(--bg3)] p-4">
            <div className="text-xs text-[var(--text-dim)] font-extrabold uppercase" style={{ letterSpacing: '0.06em' }}>
              {t('onboarding.trust.title')}
            </div>
            <div className="mt-2.5 leading-relaxed text-[var(--text)]" style={{ fontSize: '12.5px' }}>
              {t('onboarding.trust.content', { name: animalName })}
            </div>
          </div>
        </div>

        <div className="flex justify-end" style={{ padding: '0 28px 28px' }}>
          <button
            onClick={onClose}
            className="rounded border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] cursor-pointer font-black"
            style={{ padding: '12px 16px', fontFamily: 'Nunito' }}
          >
            {t('onboarding.start')}
          </button>
        </div>
      </div>
    </div>
  );
}

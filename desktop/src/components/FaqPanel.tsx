import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openExternal } from '@tauri-apps/plugin-shell';

const SUPPORT_URL = 'https://progsoft.eu/support';

export default function FaqPanel() {
  const { t } = useTranslation();

  const FAQ: Array<[string, React.ReactNode]> = [
    [t('faq.q1'), t('faq.a1')],
    [t('faq.q2'), t('faq.a2')],
    [t('faq.q3'), t('faq.a3')],
    [t('faq.q4'), t('faq.a4')],
    [t('faq.q5'), t('faq.a5')],
    [t('faq.q6'), t('faq.a6')],
  ];

  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {FAQ.map(([q, a], i) => {
        const expanded = openIdx === i;
        return (
          <div key={i} className="border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)]">
            <button
              type="button"
              onClick={() => setOpenIdx(expanded ? null : i)}
              className="w-full text-left px-3 py-2 text-[12px] font-bold text-[var(--text)] flex items-center justify-between font-[Nunito]"
            >
              <span>{q}</span>
              <span className="text-[var(--text-dim)] opacity-70">{expanded ? '−' : '+'}</span>
            </button>
            {expanded && (
              <div className="px-3 pb-2.5 text-[11.5px] text-[var(--text-muted)] leading-relaxed">{a}</div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => { openExternal(SUPPORT_URL).catch(() => {}); }}
        className="mt-2 self-start px-3 py-1.5 rounded-[var(--r)] border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] text-[12px] font-bold font-[Nunito] cursor-pointer"
      >
        {t('faq.supportButton')}
      </button>
    </div>
  );
}

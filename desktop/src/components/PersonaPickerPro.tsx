import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PRO_LIST, type ProPersona } from '../personas/registry';
import { getCurrentPro, setCurrentPro, subscribe } from '../personas/persona-service';

export default function PersonaPickerPro() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<ProPersona | null>(getCurrentPro());
  useEffect(() => subscribe(p => setCurrent(p)), []);

  return (
    <section className="w-full box-border min-w-0 border-[1px] border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
      <div className="flex items-baseline gap-[10px]">
        <div className="text-[13.5px] font-[900] text-[var(--text)]">{t('persona.title')}</div>
        <div className="text-[10.5px] text-[var(--accent)] font-[800] uppercase tracking-[0.04em]">{t('persona.b2b')}</div>
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
        {t('persona.subtitle')}
      </div>

      <div className="mt-[14px] grid gap-[10px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        <button
          onClick={() => setCurrentPro(null)}
          className={`text-left rounded-[var(--r)] p-3 cursor-pointer font-['Nunito'] grid gap-[6px] min-w-0 overflow-hidden text-[var(--text)] ${
            current === null
              ? 'border-[1px] border-[var(--accent)] bg-[var(--bg3)] shadow-[0_0_0_1px_var(--accent)]'
              : 'border-[1px] border-[var(--border)] bg-[var(--bg2)]'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[22px] leading-none flex-shrink-0">🧠</span>
            <span className="font-[800] text-[13px] flex-1 min-w-0">{t('persona.none')}</span>
            {current === null && <span className="text-[10.5px] text-[var(--accent)] font-[800]">{t('persona.active')}</span>}
          </div>
          <div className="text-[11.5px] text-[var(--text-dim)]">{t('persona.noneDescription')}</div>
        </button>

        {PRO_LIST.map(p => {
          const selected = current?.id === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setCurrentPro(p.id)}
              className="text-left rounded-[var(--r)] p-3 cursor-pointer font-['Nunito'] grid gap-[6px] min-w-0 overflow-hidden text-[var(--text)]"
              style={{
                border: `1px solid ${selected ? p.accent || 'var(--accent)' : 'var(--border)'}`,
                borderLeft: `4px solid ${p.accent || 'var(--accent)'}`,
                background: selected ? 'var(--bg3)' : 'var(--bg2)',
                boxShadow: selected ? `0 0 0 1px ${p.accent || 'var(--accent)'}` : 'none',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[22px] leading-none flex-shrink-0">{p.emoji}</span>
                <span className="font-[800] text-[13px] flex-1 min-w-0 break-words">{p.displayName}</span>
                {selected && <span className="text-[10.5px] font-[800] flex-shrink-0" style={{ color: p.accent || 'var(--accent)' }}>{t('persona.active')}</span>}
              </div>
              <div className="text-[11.5px] text-[var(--text-dim)] break-words">{p.tagline}</div>
              {p.skills.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.skills.slice(0, 6).map(s => (
                    <span key={s} className="text-[10px] px-[6px] py-[2px] rounded-full bg-[var(--bg2)] border-[1px] border-[var(--border)] text-[var(--text-muted)] font-[700]">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-[var(--text-muted)] font--['monospace'] mt-[2px]">
                packs: {p.packs.join(' · ')}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

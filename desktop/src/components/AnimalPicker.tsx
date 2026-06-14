import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANIMAL_LIST, CODER_PROFILE, VANILLA_PROFILE, type AnimalProfile } from '../animals/registry';
import { getCurrentAnimal, hydrateOwnedAnimals, setCurrentAnimal, subscribe, isVanillaMode, setVanillaMode, isCoderMode, setCoderMode } from '../animals/animal-service';

export default function AnimalPicker() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<AnimalProfile>(getCurrentAnimal());
  const [error, setError] = useState<string>('');

  const [, force] = useState(0);
  useEffect(() => {
    const unsub = subscribe(a => setCurrent(a));
    void hydrateOwnedAnimals().then(() => force(n => n + 1));
    const onFocus = () => { void hydrateOwnedAnimals().then(() => force(n => n + 1)); };
    window.addEventListener('focus', onFocus);
    return () => { unsub(); window.removeEventListener('focus', onFocus); };
  }, []);

  const animalColor = (a: AnimalProfile) => {
    if (a.id === VANILLA_PROFILE.id) return '#6B3E1F';
    if (a.id === CODER_PROFILE.id) return '#5BFF9E';
    return a.accent ?? `oklch(70% 0.17 ${a.hue})`;
  };

  const onClick = (animal: AnimalProfile) => {
    setError('');
    if (animal.id === VANILLA_PROFILE.id) {
      setVanillaMode(true);
      return;
    }
    if (animal.id === CODER_PROFILE.id) {
      setCoderMode(true);
      return;
    }
    if (isVanillaMode()) setVanillaMode(false);
    if (isCoderMode()) setCoderMode(false);
    try { setCurrentAnimal(animal.id); } catch (e: any) { setError(String(e?.message || e)); }
  };

  return (
    <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
      <div className="text-[13.5px] font-black text-[var(--text)]">{t('animalPicker.title')}</div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
        {t('animalPicker.subtitle')}
      </div>

      {(() => {
        const monkeyIdx = ANIMAL_LIST.findIndex(a => a.id === 'monkey');
        const extras = [...ANIMAL_LIST];
        extras.splice(monkeyIdx + 1, 0,
          { ...VANILLA_PROFILE, tagline: 'Neutre, sans personnalité ni skin.' },
          { ...CODER_PROFILE, tagline: 'Terminal vert. Pour coder, sec et sans bestiaire.' },
        );

        const renderCard = (animal: AnimalProfile) => {
          const isVanillaCard = animal.id === VANILLA_PROFILE.id;
          const isCoderCard = animal.id === CODER_PROFILE.id;
          const selected = isVanillaCard
            ? isVanillaMode()
            : isCoderCard
              ? isCoderMode()
              : (!isVanillaMode() && !isCoderMode() && current.id === animal.id);
          const color = animalColor(animal);
          return (
            <button
              key={animal.id}
              onClick={() => onClick(animal)}
              className="text-left rounded-[var(--r)] p-3 font-[Nunito] grid gap-[6px] min-w-0 overflow-hidden text-[var(--text)]"
              style={{
                border: `1px solid ${color}`,
                borderLeft: `4px solid ${color}`,
                background: selected ? 'var(--bg3)' : 'var(--bg2)',
                boxShadow: selected ? `0 0 0 1px ${color}` : 'none',
                cursor: 'pointer',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[22px] leading-none flex-shrink-0">{animal.emoji}</span>
                <span className="font-black text-[13px] flex-1 min-w-0 break-words" style={{ color }}>{animal.displayName}</span>
                {selected && (
                  <span className="text-[10.5px] font-black flex-shrink-0" style={{ color }}>{t('animalPicker.active')}</span>
                )}
              </div>
              <div className="text-[11.5px] text-[var(--text-dim)] break-words">{animal.tagline}</div>
            </button>
          );
        };

        return (
          <div className="mt-[14px] grid gap-[10px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
            {extras.map(renderCard)}
          </div>
        );
      })()}

      {error && (
        <div className="mt-3 text-[12px] text-[var(--red)] font-bold">{error}</div>
      )}
    </section>
  );
}

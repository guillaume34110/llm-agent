import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchAvailability,
  updateAvailability,
  AVAILABILITY_MODES,
  AVAILABILITY_TAGS,
  MAX_USER_TAGS,
  type AvailabilitySettings,
  type AvailabilityMode,
  type AvailabilityTag,
} from '../social/availability-client';

const MODE_LABELS: Record<AvailabilityMode, { fr: string; en: string }> = {
  find_collab: { fr: 'Trouver collaborateurs', en: 'Find collaborators' },
  find_mate: { fr: 'Trouver coéquipiers', en: 'Find teammates' },
  find_worker: { fr: 'Trouver freelancer', en: 'Find worker' },
  find_opinion: { fr: 'Donner avis', en: 'Give opinion' },
  find_review: { fr: 'Reviewer projet', en: 'Review project' },
  find_expertise: { fr: 'Partager expertise', en: 'Share expertise' },
};

export default function AvailabilityPanel() {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';
  const [data, setData] = useState<AvailabilitySettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchAvailability()
      .then((s) => { if (!cancelled) setData(s); })
      .catch((e) => { if (!cancelled) setError(String(e.message || e)); });
    return () => { cancelled = true; };
  }, []);

  async function patch(p: Parameters<typeof updateAvailability>[0]) {
    if (!data) return;
    setSaving(true); setError('');
    try {
      const next = await updateAvailability(p);
      setData(next);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">
          {lang === 'fr' ? 'Disponibilité' : 'Availability'}
        </div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Erreur de chargement : ' : 'Load error: '}{error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">
          {lang === 'fr' ? 'Disponibilité' : 'Availability'}
        </div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Chargement…' : 'Loading…'}
        </div>
      </div>
    );
  }

  const tagsSelected = new Set(data.acceptedTags);
  const modesSelected = new Set(data.acceptedModes);
  const tagsAtCap = tagsSelected.size >= MAX_USER_TAGS;

  function toggleMode(m: AvailabilityMode) {
    const next = modesSelected.has(m)
      ? data!.acceptedModes.filter((x) => x !== m)
      : [...data!.acceptedModes, m];
    patch({ acceptedModes: next });
  }

  function toggleTag(t: AvailabilityTag) {
    if (!tagsSelected.has(t) && tagsAtCap) return;
    const next = tagsSelected.has(t)
      ? data!.acceptedTags.filter((x) => x !== t)
      : [...data!.acceptedTags, t];
    patch({ acceptedTags: next });
  }

  return (
    <div className="p-[18px]">
      <div className="text-[13.5px] font-black text-[var(--text)] flex items-center gap-1.5">
        {lang === 'fr' ? 'Disponibilité collab' : 'Collaboration availability'}
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
        {lang === 'fr'
          ? 'Quand activé, ton agent peut répondre aux demandes de match d\'autres users sur les topics choisis. Aucune donnée privée n\'est partagée — juste un oui/non si ton agent juge la collab pertinente.'
          : 'When on, your agent can answer match requests from other users on chosen topics. No private data shared — just a yes/no if your agent judges the collab worthwhile.'}
      </div>

      <label className="mt-4 flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={data.acceptInquiries}
          onChange={(e) => patch({ acceptInquiries: e.target.checked })}
          disabled={saving}
        />
        <span className="text-[12.5px] text-[var(--text)]">
          {lang === 'fr' ? 'Je suis disponible pour matcher' : 'I am available for matching'}
        </span>
      </label>

      {data.acceptInquiries && (
        <>
          <div className="mt-4 text-[12px] font-black text-[var(--text)]">
            {lang === 'fr' ? 'Types de demandes acceptées' : 'Accepted request types'}
          </div>
          <div className="mt-2 flex flex-wrap gap-[6px]">
            {AVAILABILITY_MODES.map((m) => {
              const on = modesSelected.has(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMode(m)}
                  disabled={saving}
                  className={`px-[10px] py-[5px] rounded-full text-[11.5px] border ${
                    on
                      ? 'bg-[var(--accent)] text-[var(--accent-text)] border-[var(--accent)]'
                      : 'bg-[var(--bg)] text-[var(--text-dim)] border-[var(--border)]'
                  }`}
                >
                  {MODE_LABELS[m][lang]}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-[12px] font-black text-[var(--text)]">
              {lang === 'fr' ? 'Topics' : 'Topics'}
            </div>
            <div className="text-[11px] text-[var(--text-dim)]">
              {tagsSelected.size}/{MAX_USER_TAGS}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-[6px]">
            {AVAILABILITY_TAGS.map((t) => {
              const on = tagsSelected.has(t);
              const dim = !on && tagsAtCap;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  disabled={saving || dim}
                  className={`px-[8px] py-[3px] rounded-full text-[11px] border ${
                    on
                      ? 'bg-[var(--accent)] text-[var(--accent-text)] border-[var(--accent)]'
                      : dim
                      ? 'bg-[var(--bg)] text-[var(--text-dim)] border-[var(--border)] opacity-40'
                      : 'bg-[var(--bg)] text-[var(--text-dim)] border-[var(--border)]'
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>

          <div className="mt-4">
            <label className="text-[12px] font-black text-[var(--text)] block">
              {lang === 'fr' ? 'Max demandes par jour' : 'Max requests per day'}
            </label>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={data.maxPerDay}
                onChange={(e) => patch({ maxPerDay: Number(e.target.value) })}
                disabled={saving}
                className="flex-1"
              />
              <div className="text-[12px] text-[var(--text)] w-8 text-right">{data.maxPerDay}</div>
            </div>
          </div>

          {typeof data.responseRate30d === 'number' && (
            <div className="mt-4 text-[11.5px] text-[var(--text-dim)]">
              {lang === 'fr' ? 'Taux de réponse 30j : ' : '30d response rate: '}
              {Math.round((data.responseRate30d || 0) * 100)}%
            </div>
          )}
        </>
      )}

      {error && (
        <div className="mt-3 text-[11.5px]" style={{ color: '#e07070' }}>
          {error}
        </div>
      )}
    </div>
  );
}

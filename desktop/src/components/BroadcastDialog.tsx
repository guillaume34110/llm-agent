import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  broadcastInquiry,
  sha256Hex,
  type BroadcastResult,
} from '../social/inquiry-client';
import {
  AVAILABILITY_MODES,
  AVAILABILITY_TAGS,
  type AvailabilityMode,
  type AvailabilityTag,
} from '../social/availability-client';
import { signConsent } from '../social/consent-signer';

type Stage = 'compose' | 'reconsent' | 'sending' | 'done' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  onSent?: (result: BroadcastResult) => void;
}

const MODE_LABELS: Record<AvailabilityMode, { fr: string; en: string }> = {
  find_collab: { fr: 'Trouver collaborateurs', en: 'Find collaborators' },
  find_mate: { fr: 'Trouver coéquipiers', en: 'Find teammates' },
  find_worker: { fr: 'Trouver freelancer', en: 'Find worker' },
  find_opinion: { fr: 'Donner avis', en: 'Give opinion' },
  find_review: { fr: 'Reviewer projet', en: 'Review project' },
  find_expertise: { fr: 'Partager expertise', en: 'Share expertise' },
};

export default function BroadcastDialog({ open, onClose, onSent }: Props) {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';

  const [stage, setStage] = useState<Stage>('compose');
  const [mode, setMode] = useState<AvailabilityMode>('find_collab');
  const [tags, setTags] = useState<AvailabilityTag[]>([]);
  const [question, setQuestion] = useState('');
  const [fanout, setFanout] = useState(5);
  const [digestPreview, setDigestPreview] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BroadcastResult | null>(null);

  if (!open) return null;

  const reset = () => {
    setStage('compose');
    setMode('find_collab');
    setTags([]);
    setQuestion('');
    setFanout(5);
    setDigestPreview('');
    setError('');
    setResult(null);
  };

  const handleClose = () => {
    if (stage === 'sending') return; // don't allow close mid-send
    reset();
    onClose();
  };

  const toggleTag = (t: AvailabilityTag) => {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const goToReconsent = async () => {
    setError('');
    const q = question.trim();
    if (q.length < 8) {
      setError(lang === 'fr' ? 'Question trop courte (8+ caractères)' : 'Question too short (8+ chars)');
      return;
    }
    if (tags.length === 0) {
      setError(lang === 'fr' ? 'Sélectionne au moins un topic' : 'Select at least one topic');
      return;
    }
    const digest = await sha256Hex(q);
    setDigestPreview(digest);
    setStage('reconsent');
  };

  const handleSign = async () => {
    setStage('sending');
    setError('');
    try {
      const summary =
        lang === 'fr'
          ? `Broadcast P2P "${MODE_LABELS[mode].fr}" — ${tags.join(', ')} — fanout ${fanout}`
          : `P2P broadcast "${MODE_LABELS[mode].en}" — ${tags.join(', ')} — fanout ${fanout}`;
      const consent = await signConsent('inquiry.broadcast', summary, {
        mode,
        tags: [...tags].sort(),
        fanout,
        questionDigest: digestPreview,
      });
      const r = await broadcastInquiry({ mode, tags, question, fanout, consent });
      setResult(r);
      setStage('done');
      onSent?.(r);
    } catch (e: any) {
      setError(String(e?.message || e));
      setStage('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[min(560px,92vw)] max-h-[88vh] overflow-auto bg-[var(--bg3)] border border-[var(--border)] rounded-[var(--rm)] p-[18px]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[14px] font-black text-[var(--text)]">
            {lang === 'fr' ? 'Broadcast P2P' : 'P2P Broadcast'}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-[12px] text-[var(--text-dim)] hover:text-[var(--text)]"
            disabled={stage === 'sending'}
          >
            ✕
          </button>
        </div>

        {stage === 'compose' && (
          <>
            <div className="text-[11.5px] text-[var(--text-dim)] leading-relaxed mb-3">
              {lang === 'fr'
                ? 'Étape 1/2 — compose ta demande. Le texte est haché côté client : seul le hash atteint le serveur de matchmaking. Tu confirmeras avec une signature à l\'étape suivante.'
                : 'Step 1/2 — compose your inquiry. The text is hashed client-side: only the digest reaches the matchmaking server. You will confirm with a signature at the next step.'}
            </div>

            <label className="block text-[12px] font-black text-[var(--text)] mb-1">
              {lang === 'fr' ? 'Mode' : 'Mode'}
            </label>
            <div className="flex flex-wrap gap-[6px] mb-3">
              {AVAILABILITY_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-[10px] py-[5px] rounded-full text-[11.5px] border ${
                    mode === m
                      ? 'bg-[var(--accent)] text-[var(--accent-text)] border-[var(--accent)]'
                      : 'bg-[var(--bg)] text-[var(--text-dim)] border-[var(--border)]'
                  }`}
                >
                  {MODE_LABELS[m][lang]}
                </button>
              ))}
            </div>

            <label className="block text-[12px] font-black text-[var(--text)] mb-1">
              {lang === 'fr' ? 'Topics' : 'Topics'} ({tags.length})
            </label>
            <div className="flex flex-wrap gap-[6px] mb-3 max-h-[120px] overflow-auto">
              {AVAILABILITY_TAGS.map((t) => {
                const on = tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={`px-[8px] py-[3px] rounded-full text-[11px] border ${
                      on
                        ? 'bg-[var(--accent)] text-[var(--accent-text)] border-[var(--accent)]'
                        : 'bg-[var(--bg)] text-[var(--text-dim)] border-[var(--border)]'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>

            <label className="block text-[12px] font-black text-[var(--text)] mb-1">
              {lang === 'fr' ? 'Question' : 'Question'}
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                lang === 'fr'
                  ? 'Décris ce que tu cherches. Le texte reste local ; seul son hash sera diffusé.'
                  : 'Describe what you need. Text stays local; only its hash is broadcast.'
              }
              className="w-full p-2 rounded-[var(--rm)] bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] text-[12px] leading-relaxed focus:outline-none focus:border-[var(--accent)]"
              rows={4}
            />

            <label className="block text-[12px] font-black text-[var(--text)] mt-3 mb-1">
              {lang === 'fr' ? 'Fanout (recipients max)' : 'Fanout (max recipients)'}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={25}
                step={1}
                value={fanout}
                onChange={(e) => setFanout(Number(e.target.value))}
                className="flex-1"
              />
              <div className="text-[12px] text-[var(--text)] w-8 text-right">{fanout}</div>
            </div>

            {error && (
              <div className="mt-3 text-[11.5px]" style={{ color: '#e07070' }}>
                {error}
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg3)]"
              >
                {lang === 'fr' ? 'Annuler' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={goToReconsent}
                className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90"
              >
                {lang === 'fr' ? 'Continuer →' : 'Continue →'}
              </button>
            </div>
          </>
        )}

        {(stage === 'reconsent' || stage === 'sending') && (
          <>
            <div className="text-[11.5px] text-[var(--text-dim)] leading-relaxed mb-3">
              {lang === 'fr'
                ? 'Étape 2/2 — re-consentement signé. Cette action contacte jusqu\'à N autres agents. Pour éviter qu\'un tool automatisé broadcast en ton nom, ta clé locale signe le résumé ci-dessous. La signature est conservée dans ton journal d\'audit.'
                : 'Step 2/2 — signed re-consent. This action contacts up to N other agents. To prevent an automated tool from broadcasting on your behalf, your local key signs the summary below. The signature is kept in your audit log.'}
            </div>

            <div className="rounded-[var(--rm)] bg-[var(--bg)] border border-[var(--border)] p-3 text-[12px] text-[var(--text)] mb-3 space-y-1">
              <div>
                <span className="text-[var(--text-dim)]">{lang === 'fr' ? 'Mode : ' : 'Mode: '}</span>
                {MODE_LABELS[mode][lang]}
              </div>
              <div>
                <span className="text-[var(--text-dim)]">{lang === 'fr' ? 'Topics : ' : 'Topics: '}</span>
                {tags.join(', ')}
              </div>
              <div>
                <span className="text-[var(--text-dim)]">{lang === 'fr' ? 'Fanout : ' : 'Fanout: '}</span>
                {fanout}
              </div>
              <div className="font-mono text-[10.5px] text-[var(--text-dim)] break-all">
                <span>digest: </span>
                {digestPreview.slice(0, 24)}…
              </div>
            </div>

            <div className="text-[11px] text-[var(--text-dim)] leading-relaxed mb-3">
              {lang === 'fr'
                ? 'En cliquant "Je confirme et signe", tu produis une signature ECDSA P-256 locale et déclenches le broadcast. Pas de signature → pas de broadcast.'
                : 'By clicking "I confirm & sign", you produce a local ECDSA P-256 signature and trigger the broadcast. No signature → no broadcast.'}
            </div>

            {error && (
              <div className="mb-3 text-[11.5px]" style={{ color: '#e07070' }}>
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStage('compose')}
                disabled={stage === 'sending'}
                className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg3)] disabled:opacity-50"
              >
                {lang === 'fr' ? '← Retour' : '← Back'}
              </button>
              <button
                type="button"
                onClick={handleSign}
                disabled={stage === 'sending'}
                className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50"
              >
                {stage === 'sending'
                  ? lang === 'fr' ? 'Signature…' : 'Signing…'
                  : lang === 'fr' ? 'Je confirme et signe' : 'I confirm & sign'}
              </button>
            </div>
          </>
        )}

        {stage === 'done' && result && (
          <>
            <div className="text-[12px] text-[var(--text)] leading-relaxed mb-3">
              {lang === 'fr'
                ? `Broadcast envoyé à ${result.fanout} recipient(s). Expire le ${new Date(result.expiresAt).toLocaleString()}.`
                : `Broadcast sent to ${result.fanout} recipient(s). Expires at ${new Date(result.expiresAt).toLocaleString()}.`}
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="w-full px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90"
            >
              {lang === 'fr' ? 'Fermer' : 'Close'}
            </button>
          </>
        )}

        {stage === 'error' && (
          <>
            <div className="text-[12px] mb-3" style={{ color: '#e07070' }}>
              {error}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg3)]"
              >
                {lang === 'fr' ? 'Fermer' : 'Close'}
              </button>
              <button
                type="button"
                onClick={() => setStage('reconsent')}
                className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90"
              >
                {lang === 'fr' ? 'Réessayer' : 'Retry'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

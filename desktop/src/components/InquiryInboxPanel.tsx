import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchInquiryInbox,
  getInquiry,
  respondToInquiry,
  closeInquiry,
  type InquiryRecord,
  type InquiryWithResponses,
} from '../social/inquiry-client';
import type { AvailabilityMode } from '../social/availability-client';

const MODE_LABELS: Record<AvailabilityMode, { fr: string; en: string }> = {
  find_collab: { fr: 'Trouver collaborateurs', en: 'Find collaborators' },
  find_mate: { fr: 'Trouver coéquipiers', en: 'Find teammates' },
  find_worker: { fr: 'Trouver freelancer', en: 'Find worker' },
  find_opinion: { fr: 'Donner avis', en: 'Give opinion' },
  find_review: { fr: 'Reviewer projet', en: 'Review project' },
  find_expertise: { fr: 'Partager expertise', en: 'Share expertise' },
};

interface ConsentDialogProps {
  inquiry: InquiryRecord | null;
  inquiryWithResponses: InquiryWithResponses | null;
  loading: boolean;
  loadError: string;
  onClose: () => void;
  onRefresh: () => void;
  lang: 'fr' | 'en';
}

function ConsentDialog({ inquiry, inquiryWithResponses, loading, loadError, onClose, onRefresh, lang }: ConsentDialogProps) {
  const [phase, setPhase] = useState<'choice' | 'compose'>('choice');
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!inquiry) {
      setPhase('choice');
      setAnswer('');
      setError('');
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inquiry, onClose, submitting]);

  if (!inquiry) return null;

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleAcceptAndRespond = async () => {
    const trimmed = answer.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError('');
    try {
      await respondToInquiry(inquiry.id, {
        answer: { text: trimmed },
        guardPassed: true,
      });
      setAnswer('');
      setPhase('choice');
      onClose();
      onRefresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  const modeLabel = MODE_LABELS[inquiry.mode]?.[lang] || inquiry.mode;
  const tags = inquiry.filters.tags || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleClose}
    >
      <div
        className="w-[min(520px,90vw)] bg-[var(--bg3)] border border-[var(--border)] rounded-[var(--rm)] p-[18px]"
        style={{ backgroundColor: 'var(--bg3)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[14px] font-black text-[var(--text)] mb-3">
          {lang === 'fr' ? 'Demande P2P reçue' : 'P2P Inquiry Received'}
        </div>

        {loading ? (
          <div className="text-[12px] text-[var(--text-dim)]">
            {lang === 'fr' ? 'Chargement…' : 'Loading…'}
          </div>
        ) : loadError ? (
          <>
            <div className="text-[12px] mb-3" style={{ color: '#e07070' }}>
              {lang === 'fr' ? 'Erreur de chargement : ' : 'Load error: '}{loadError}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg3)]"
              >
                {lang === 'fr' ? 'Fermer' : 'Close'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-[12px] text-[var(--text-dim)] leading-relaxed mb-4">
              {lang === 'fr'
                ? `Une demande P2P a été reçue pour le mode "${modeLabel}" sur les topics: ${tags.join(', ') || 'général'}. Tu n'as pas vu le contenu du prompt — seulement son hash. Veux-tu y répondre ?`
                : `A P2P inquiry was received for mode "${modeLabel}" on topics: ${tags.join(', ') || 'general'}. You did not see the prompt content — only its hash. Do you want to respond?`}
            </div>

            {phase === 'choice' && (
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={submitting}
                  className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg3)] disabled:opacity-50"
                >
                  {lang === 'fr' ? 'Refuser' : 'Decline'}
                </button>
                <button
                  type="button"
                  onClick={() => setPhase('compose')}
                  disabled={submitting}
                  className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50"
                >
                  {lang === 'fr' ? 'Accepter & répondre' : 'Accept & answer'}
                </button>
              </div>
            )}

            {phase === 'compose' && (
              <div className="mb-4">
                <textarea
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value);
                    setError('');
                  }}
                  placeholder={lang === 'fr' ? 'Ta réponse à la question reçue…' : 'Your answer to the inquiry…'}
                  className="w-full p-2 rounded-[var(--rm)] bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] text-[12px] leading-relaxed focus:outline-none focus:border-[var(--accent)]"
                  rows={4}
                  disabled={submitting}
                />
                {error && (
                  <div className="mt-2 text-[11px]" style={{ color: '#e07070' }}>
                    {error}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setPhase('choice'); setAnswer(''); setError(''); }}
                    disabled={submitting}
                    className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg3)] disabled:opacity-50"
                  >
                    {lang === 'fr' ? 'Annuler' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAcceptAndRespond}
                    disabled={submitting || !answer.trim()}
                    className="flex-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50"
                  >
                    {submitting ? (lang === 'fr' ? 'Envoi…' : 'Sending…') : lang === 'fr' ? 'Envoyer' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function InquiryInboxPanel() {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';

  const [inquiries, setInquiries] = useState<InquiryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedInquiry, setSelectedInquiry] = useState<InquiryWithResponses | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchInquiryInbox()
      .then((data) => {
        if (!cancelled) {
          setInquiries(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e?.message || e));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleOpen = async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setDetailError('');
    try {
      const detail = await getInquiry(id);
      setSelectedInquiry(detail);
    } catch (e: any) {
      setDetailError(String(e?.message || e));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDialogClose = () => {
    setSelectedId(null);
    setSelectedInquiry(null);
    setDetailError('');
  };

  const handleRefresh = async () => {
    try {
      const data = await fetchInquiryInbox();
      setInquiries(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const formatTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();
    if (diffMs <= 0) return lang === 'fr' ? 'Expiré' : 'Expired';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) {
      return lang === 'fr' ? `Expire dans ${hours}h` : `Expires in ${hours}h`;
    }
    return lang === 'fr' ? `Expire dans ${minutes}m` : `Expires in ${minutes}m`;
  };

  if (error && !inquiries.length) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">
          {lang === 'fr' ? 'Demandes reçues' : 'Inbox'}
        </div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Erreur de chargement : ' : 'Load error: '}{error}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">
          {lang === 'fr' ? 'Demandes reçues' : 'Inbox'}
        </div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Chargement…' : 'Loading…'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-[18px]">
      <div className="text-[13.5px] font-black text-[var(--text)]">
        {lang === 'fr' ? 'Demandes reçues' : 'Inbox'}
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
        {lang === 'fr'
          ? 'Inquiries P2P reçues. Ton agent voit seulement le hash de la question, pas le texte. Tu vois mode + topics et décides si tu réponds.'
          : 'P2P inquiries received. Your agent sees only the hash of the question, not the text. You see mode + topics and decide whether to respond.'}
      </div>

      {inquiries.length === 0 ? (
        <div className="mt-6 flex flex-col items-center justify-center text-center py-10 gap-2">
          <div className="text-4xl opacity-70">📥</div>
          <div className="text-[12.5px] font-bold text-[var(--text-muted)]">
            {lang === 'fr' ? 'Inbox vide' : 'Inbox empty'}
          </div>
          <div className="text-[11.5px] text-[var(--text-dim)] max-w-[320px] leading-relaxed">
            {lang === 'fr'
              ? 'Les demandes P2P qui matchent ton profil arriveront ici.'
              : 'P2P inquiries matching your profile will land here.'}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {inquiries.map((inq) => {
            const modeLabel = MODE_LABELS[inq.mode]?.[lang] || inq.mode;
            const tags = inq.filters.tags || [];
            const statusColor = inq.status === 'open' ? 'var(--accent)' : 'var(--text-dim)';

            return (
              <div
                key={inq.id}
                className="p-3 rounded-[var(--rm)] bg-[var(--bg)] border border-[var(--border)] text-[12px]"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <div className="text-[var(--text)] font-semibold">{modeLabel}</div>
                    <div className="text-[var(--text-dim)] text-[11px] mt-1">
                      {tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded-full bg-[var(--bg3)] text-[var(--text-dim)]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div>{lang === 'fr' ? 'Général' : 'General'}</div>
                      )}
                    </div>
                    <div className="text-[var(--text-dim)] text-[11px] mt-2">
                      {lang === 'fr' ? 'Fanout: ' : 'Fanout: '}
                      {inq.fanout} | {formatTimeRemaining(inq.expiresAt)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span
                      className="px-2 py-1 rounded text-[11px] font-semibold"
                      style={{ color: statusColor }}
                    >
                      {inq.status === 'open' && (lang === 'fr' ? 'Ouvert' : 'Open')}
                      {inq.status === 'closed' && (lang === 'fr' ? 'Fermé' : 'Closed')}
                      {inq.status === 'expired' && (lang === 'fr' ? 'Expiré' : 'Expired')}
                    </span>
                    {inq.status === 'open' && (
                      <button
                        type="button"
                        onClick={() => handleOpen(inq.id)}
                        className="px-3 py-1 rounded-[var(--rm)] text-[11.5px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90"
                      >
                        {lang === 'fr' ? 'Ouvrir' : 'Open'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mt-3 text-[11.5px]" style={{ color: '#e07070' }}>
          {error}
        </div>
      )}

      <ConsentDialog
        inquiry={selectedId ? inquiries.find((i) => i.id === selectedId) || null : null}
        inquiryWithResponses={selectedInquiry}
        loading={loadingDetail}
        loadError={detailError}
        onClose={handleDialogClose}
        onRefresh={handleRefresh}
        lang={lang}
      />
    </div>
  );
}

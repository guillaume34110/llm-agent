import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import {
  createFriendInvite,
  revokeFriendInvite,
  type FriendInvite,
} from '../social/friendship-client';

interface Props {
  onClose: () => void;
}

export default function FriendInviteDialog({ onClose }: Props) {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [invite, setInvite] = useState<FriendInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  function buildUrl(token: string) {
    return `progsoft://friend?t=${encodeURIComponent(token)}`;
  }

  async function generate() {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const inv = await createFriendInvite();
      setInvite(inv);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    generate();
  }, []);

  useEffect(() => {
    if (invite && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, buildUrl(invite.token), {
        width: 220,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => {});
    }
  }, [invite]);

  async function handleCopy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  async function handleRevoke() {
    if (!invite) return;
    if (!window.confirm(lang === 'fr' ? 'Révoquer ce code ?' : 'Revoke this code?')) return;
    setRevoking(true);
    try {
      await revokeFriendInvite(invite.token);
      await generate();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setRevoking(false);
    }
  }

  const expiresLabel = invite
    ? new Date(invite.expiresAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')
    : '';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[360px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-black text-[var(--text)]">
            {lang === 'fr' ? 'Inviter un ami' : 'Invite a friend'}
          </div>
          <button
            onClick={onClose}
            className="text-[14px] text-[var(--text-dim)] hover:text-[var(--text)]"
            aria-label="close"
          >
            ✕
          </button>
        </div>

        <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
          {lang === 'fr'
            ? 'Un usage unique, valable 24 h. Partage le code OU scanne le QR.'
            : 'Single-use, valid 24 h. Share the code OR scan the QR.'}
        </div>

        {loading && (
          <div className="mt-4 text-[12px] text-[var(--text-dim)]">
            {lang === 'fr' ? 'Génération…' : 'Generating…'}
          </div>
        )}

        {error && (
          <div className="mt-3 text-[11.5px]" style={{ color: '#e07070' }}>
            {error}
          </div>
        )}

        {invite && !loading && (
          <>
            <div className="mt-4 flex justify-center">
              <div className="rounded bg-white p-2">
                <canvas ref={canvasRef} />
              </div>
            </div>

            <div className="mt-4">
              <div className="text-[10.5px] text-[var(--text-dim)] uppercase tracking-wide font-bold">
                {lang === 'fr' ? 'Code' : 'Code'}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 px-2 py-2 rounded border border-[var(--border)] bg-[var(--bg)] text-[12px] font-mono text-[var(--text)] tracking-wider text-center">
                  {invite.token}
                </code>
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 rounded text-[11px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent)]"
                >
                  {copied
                    ? lang === 'fr'
                      ? 'Copié'
                      : 'Copied'
                    : lang === 'fr'
                    ? 'Copier'
                    : 'Copy'}
                </button>
              </div>
            </div>

            <div className="mt-3 text-[10.5px] text-[var(--text-dim)]">
              {lang === 'fr' ? 'Expire le ' : 'Expires '}{expiresLabel}
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="px-3 py-2 rounded text-[11px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)] hover:text-[#e07070] hover:border-[#e07070] disabled:opacity-50"
              >
                {revoking
                  ? lang === 'fr'
                    ? 'Révocation…'
                    : 'Revoking…'
                  : lang === 'fr'
                  ? 'Révoquer & régénérer'
                  : 'Revoke & regenerate'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded text-[11px] border border-[var(--border)] bg-[var(--accent)] text-[var(--bg)] font-bold"
              >
                {lang === 'fr' ? 'Fermer' : 'Close'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

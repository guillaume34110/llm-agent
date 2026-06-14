import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listFriends,
  removeFriend,
  getReputation,
  redeemFriendInvite,
  type Friend,
} from '../social/friendship-client';
import FriendInviteDialog from './FriendInviteDialog';

export default function FriendsListPanel() {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [reputation, setReputation] = useState<{ earned: number; score: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [removeError, setRemoveError] = useState<Record<string, string>>({});
  const [showInvite, setShowInvite] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState('');
  const [redeemMsg, setRedeemMsg] = useState('');

  function extractToken(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    if (s.startsWith('progsoft://friend')) {
      try {
        const url = new URL(s);
        return (url.searchParams.get('t') || '').trim();
      } catch {
        return '';
      }
    }
    return s;
  }

  async function refreshFriends() {
    try {
      const f = await listFriends();
      setFriends(f);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function handleRedeem() {
    const token = extractToken(redeemCode);
    if (!token) {
      setRedeemError(lang === 'fr' ? 'Code vide' : 'Empty code');
      return;
    }
    setRedeeming(true);
    setRedeemError('');
    setRedeemMsg('');
    try {
      const r = await redeemFriendInvite(token);
      setRedeemCode('');
      setRedeemMsg(
        r.already
          ? lang === 'fr'
            ? 'Déjà ami.'
            : 'Already friends.'
          : lang === 'fr'
          ? 'Ami ajouté.'
          : 'Friend added.',
      );
      await refreshFriends();
    } catch (e: any) {
      setRedeemError(String(e?.message || e));
    } finally {
      setRedeeming(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([listFriends(), getReputation()])
      .then(([f, r]) => {
        if (!cancelled) {
          setFriends(f);
          setReputation(r);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function handleRemove(friendId: string) {
    if (!window.confirm(lang === 'fr' ? 'Confirmer la suppression ?' : 'Confirm removal?')) {
      return;
    }
    setRemoving((s) => new Set([...s, friendId]));
    setRemoveError((e) => ({ ...e, [friendId]: '' }));
    try {
      await removeFriend(friendId);
      setFriends((f) => f?.filter((x) => x.friendId !== friendId) ?? null);
    } catch (e: any) {
      setRemoveError((err) => ({ ...err, [friendId]: String(e?.message || e) }));
    } finally {
      setRemoving((s) => {
        const next = new Set(s);
        next.delete(friendId);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">
          {lang === 'fr' ? 'Amis' : 'Friends'}
        </div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Chargement…' : 'Loading…'}
        </div>
      </div>
    );
  }

  if (error && !reputation) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">
          {lang === 'fr' ? 'Amis' : 'Friends'}
        </div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Erreur de chargement : ' : 'Load error: '}{error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-[18px]">
      <div className="text-[13.5px] font-black text-[var(--text)]">
        {lang === 'fr' ? 'Amis' : 'Friends'}
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
        {lang === 'fr'
          ? 'Liste des users avec qui tu as un double-consent confirmé.'
          : 'List of users with whom you have confirmed double-consent.'}
      </div>

      {reputation && (
        <div className="mt-4 p-3 rounded border border-[var(--border)] bg-[var(--bg)]">
          <div className="text-[11.5px] text-[var(--text-dim)] font-black">
            {lang === 'fr' ? 'Réputation' : 'Reputation'}
          </div>
          <div className="mt-2 text-[28px] font-black text-[var(--accent)]">
            {reputation.score}
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-dim)]">
            {reputation.earned}{' '}
            {lang === 'fr' ? 'collabs réussies' : 'successful collabs'}
          </div>
        </div>
      )}

      <div className="mt-4 p-3 rounded border border-[var(--border)] bg-[var(--bg)]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11.5px] font-black text-[var(--text)]">
            {lang === 'fr' ? 'Ajouter un ami' : 'Add a friend'}
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="px-3 py-1.5 rounded text-[11px] border border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)] font-bold"
          >
            {lang === 'fr' ? 'Mon code / QR' : 'My code / QR'}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={redeemCode}
            onChange={(e) => setRedeemCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !redeeming) handleRedeem();
            }}
            placeholder={lang === 'fr' ? 'Coller FRND-XXXX-XXXX-XX' : 'Paste FRND-XXXX-XXXX-XX'}
            className="flex-1 px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--card)] text-[12px] font-mono text-[var(--text)]"
          />
          <button
            onClick={handleRedeem}
            disabled={redeeming || !redeemCode.trim()}
            className="px-3 py-1.5 rounded text-[11px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-50"
          >
            {redeeming
              ? lang === 'fr'
                ? 'Ajout…'
                : 'Adding…'
              : lang === 'fr'
              ? 'Ajouter'
              : 'Add'}
          </button>
        </div>
        {redeemError && (
          <div className="mt-2 text-[11px]" style={{ color: '#e07070' }}>
            {redeemError}
          </div>
        )}
        {redeemMsg && (
          <div className="mt-2 text-[11px] text-[var(--accent)]">{redeemMsg}</div>
        )}
      </div>

      <div className="mt-4">
        {!friends || friends.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-10 gap-2">
            <div className="text-4xl opacity-70">🫂</div>
            <div className="text-[12.5px] font-bold text-[var(--text-muted)]">
              {lang === 'fr' ? 'Aucun ami pour le moment' : 'No friends yet'}
            </div>
            <div className="text-[11.5px] text-[var(--text-dim)] max-w-[320px] leading-relaxed">
              {lang === 'fr'
                ? 'Tes premiers collabs apparaîtront ici après acceptation mutuelle.'
                : 'Your first collabs will appear here after mutual acceptance.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {friends.map((f) => {
              const removing_state = removing.has(f.friendId);
              const errMsg = removeError[f.friendId];
              const createdDate = new Date(f.createdAt).toLocaleDateString(
                lang === 'fr' ? 'fr-FR' : 'en-US'
              );
              return (
                <div
                  key={f.friendId}
                  className="p-3 rounded border border-[var(--border)] bg-[var(--bg)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[11.5px] font-mono text-[var(--text)] truncate"
                        title={f.friendId}
                      >
                        {f.friendId.slice(0, 8)}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--text-dim)]">
                        {lang === 'fr' ? 'depuis ' : 'since '}{createdDate}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(f.friendId)}
                      disabled={removing_state}
                      className="px-[10px] py-[5px] rounded text-[11px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)] hover:text-[#e07070] hover:border-[#e07070] disabled:opacity-50 whitespace-nowrap"
                    >
                      {removing_state
                        ? lang === 'fr'
                          ? 'Suppression…'
                          : 'Removing…'
                        : lang === 'fr'
                        ? 'Supprimer'
                        : 'Remove'}
                    </button>
                  </div>
                  {errMsg && (
                    <div className="mt-2 text-[11px]" style={{ color: '#e07070' }}>
                      {errMsg}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 text-[11.5px]" style={{ color: '#e07070' }}>
          {error}
        </div>
      )}

      {showInvite && <FriendInviteDialog onClose={() => setShowInvite(false)} />}
    </div>
  );
}

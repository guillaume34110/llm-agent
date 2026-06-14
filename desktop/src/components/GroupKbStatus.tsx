// Status panel for a group thread KB bundle. Server-side bundles expire after
// 1 hour — this is intentional: the bundle is a *presence signal*. While the
// owner is online they republish on a ~50min cadence; when they go offline the
// bundle is auto-evicted within the hour. This component shows the live TTL,
// explains the contract, and lets the owner re-publish manually or enable
// auto-republish.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchGroupKb,
  publishGroupKb,
  type GroupKbBundle,
} from '../social/group-client';

interface Props {
  threadId: string;
  // Authenticated user id — used to detect "am I owner of any bundle".
  currentUserId: string;
  // Callback that returns the ciphertext to publish (caller owns encryption).
  // Returning null cancels the publish.
  prepareCiphertext: (modelId: string) => Promise<{ modelId: string; ciphertext: string } | null>;
  // Initial model the owner is sharing (lets parent control).
  ownedModelId?: string;
}

const TTL_MS = 60 * 60 * 1000; // matches server-side group KB TTL
const REPUBLISH_BEFORE_EXPIRY_MS = 10 * 60 * 1000; // republish 10 min before
const AUTO_KEY_PREFIX = 'group_kb_auto_v1:';

export default function GroupKbStatus({ threadId, currentUserId, prepareCiphertext, ownedModelId }: Props) {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';

  const [bundles, setBundles] = useState<GroupKbBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [autoRepublish, setAutoRepublish] = useState(() => {
    try { return localStorage.getItem(AUTO_KEY_PREFIX + threadId) === '1'; } catch { return false; }
  });
  const autoTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await fetchGroupKb(threadId);
      setBundles(list);
      setError('');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    refresh().catch(() => {});
    const poll = window.setInterval(() => { if (!cancelled) refresh(); }, 30_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [refresh]);

  const myBundle = bundles.find((b) => b.ownerId === currentUserId) || null;

  const doPublish = useCallback(async (modelHint?: string) => {
    const modelId = modelHint || myBundle?.modelId || ownedModelId;
    if (!modelId) {
      setError(lang === 'fr' ? 'Pas de modèle sélectionné' : 'No model selected');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const prepared = await prepareCiphertext(modelId);
      if (!prepared) { setBusy(false); return; }
      await publishGroupKb(threadId, prepared.modelId, prepared.ciphertext);
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [myBundle?.modelId, ownedModelId, prepareCiphertext, threadId, refresh, lang]);

  // Auto-republish loop: when enabled and I own a bundle, schedule a republish
  // ~10 min before expiry. Don't preemptively re-publish if no bundle yet —
  // the user must publish once explicitly to "go online" for this thread.
  useEffect(() => {
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (!autoRepublish || !myBundle) return;
    const expiresAt = new Date(myBundle.expiresAt).getTime();
    const fireAt = Math.max(expiresAt - REPUBLISH_BEFORE_EXPIRY_MS, Date.now() + 1000);
    const delay = fireAt - Date.now();
    autoTimerRef.current = window.setTimeout(() => {
      doPublish().catch(() => {});
    }, delay);
    return () => {
      if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    };
  }, [autoRepublish, myBundle, doPublish]);

  const toggleAuto = (on: boolean) => {
    setAutoRepublish(on);
    try { localStorage.setItem(AUTO_KEY_PREFIX + threadId, on ? '1' : '0'); } catch {}
  };

  const myExpiresMs = myBundle ? new Date(myBundle.expiresAt).getTime() : null;
  const myRemainingMs = myExpiresMs ? Math.max(0, myExpiresMs - now) : null;
  const myMinutesLeft = myRemainingMs !== null ? Math.floor(myRemainingMs / 60_000) : null;
  const mySecondsLeft = myRemainingMs !== null ? Math.floor((myRemainingMs % 60_000) / 1000) : null;
  const pct = myRemainingMs !== null ? Math.max(0, Math.min(100, (myRemainingMs / TTL_MS) * 100)) : 0;

  return (
    <div className="rounded-[var(--rm)] bg-[var(--bg)] border border-[var(--border)] p-3 text-[12px] text-[var(--text)]">
      <div className="text-[12.5px] font-black mb-1">
        {lang === 'fr' ? 'Partage de KB au groupe' : 'Group KB sharing'}
      </div>
      <div className="text-[11px] text-[var(--text-dim)] leading-relaxed mb-3">
        {lang === 'fr'
          ? 'Ta KB reste visible au groupe pendant 1 heure après chaque publication. Si tu te déconnectes et ne ré-uploades pas, le groupe perd l\'accès — c\'est un signal de présence, pas un partage permanent. Tant que tu es co, ta KB est là.'
          : 'Your KB stays visible to the group for 1 hour after each publish. If you go offline and do not re-upload, the group loses access — this is a presence signal, not a permanent share. While you are online, your KB is there.'}
      </div>

      {loading ? (
        <div className="text-[11.5px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Chargement…' : 'Loading…'}
        </div>
      ) : myBundle ? (
        <>
          <div className="flex items-center justify-between text-[11.5px] mb-1">
            <span className="text-[var(--text-dim)]">
              {lang === 'fr' ? 'Modèle partagé : ' : 'Shared model: '}
              <span className="text-[var(--text)] font-semibold">{myBundle.modelId}</span>
            </span>
            <span className="font-mono">
              {myMinutesLeft}m {String(mySecondsLeft).padStart(2, '0')}s
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[var(--bg3)] overflow-hidden mb-3">
            <div
              className="h-full"
              style={{
                width: `${pct}%`,
                background:
                  pct > 30 ? 'var(--accent)' : pct > 10 ? '#e0a070' : '#e07070',
                transition: 'width 1s linear',
              }}
            />
          </div>
          {pct <= 20 && !autoRepublish && (
            <div className="text-[11px] mb-2" style={{ color: '#e0a070' }}>
              {lang === 'fr'
                ? 'TTL bientôt atteint — re-publie ou active le rafraîchissement auto.'
                : 'TTL almost reached — re-publish or enable auto-refresh.'}
            </div>
          )}
        </>
      ) : (
        <div className="text-[11.5px] text-[var(--text-dim)] mb-3">
          {lang === 'fr'
            ? 'Tu n\'as encore rien publié dans ce groupe. Publie pour rendre ta KB accessible aux membres pendant 1h.'
            : 'You have not published anything in this group yet. Publish to make your KB accessible to members for 1h.'}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => doPublish()}
          disabled={busy}
          className="px-3 py-1.5 rounded-[var(--rm)] text-[11.5px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? lang === 'fr' ? 'Publication…' : 'Publishing…'
            : myBundle
            ? lang === 'fr' ? 'Re-publier maintenant' : 'Re-publish now'
            : lang === 'fr' ? 'Publier' : 'Publish'}
        </button>
        <label className="flex items-center gap-2 text-[11.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={autoRepublish}
            onChange={(e) => toggleAuto(e.target.checked)}
          />
          <span className="text-[var(--text-dim)]">
            {lang === 'fr' ? 'Auto-rafraîchir (10 min avant expiration)' : 'Auto-refresh (10 min before expiry)'}
          </span>
        </label>
      </div>

      {bundles.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="text-[11px] text-[var(--text-dim)] mb-1">
            {lang === 'fr' ? 'Membres actuellement co' : 'Members currently online'}
            {' '}({bundles.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {bundles.map((b) => {
              const remMs = Math.max(0, new Date(b.expiresAt).getTime() - now);
              const remMin = Math.floor(remMs / 60_000);
              return (
                <span
                  key={b.id}
                  className="px-2 py-0.5 rounded-full bg-[var(--bg3)] text-[11px] text-[var(--text-dim)] border border-[var(--border)]"
                  title={`${b.modelId} · ${remMin}m`}
                >
                  {b.ownerId === currentUserId
                    ? (lang === 'fr' ? 'toi' : 'you')
                    : b.ownerId.slice(0, 6)}
                  {' · '}
                  {remMin}m
                </span>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2 text-[11px]" style={{ color: '#e07070' }}>
          {error}
        </div>
      )}
    </div>
  );
}

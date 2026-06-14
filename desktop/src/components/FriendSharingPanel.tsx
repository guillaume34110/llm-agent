// Friend-graph LLM sharing (Spec A).
// Top: runtime status (Live/Off) + stop button if running, hint to P2P Provider tab if not.
// Middle: list of locally installed LLMs (read-only — shared atomically when ACL is ON for a friend).
// Bottom: list of mutual friends with per-friend toggle + bulk actions (share all / revoke all).
// Row exists in ProviderAcl ⇔ that friend may consume my compute. Default OFF.

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Share2, Cpu, Check, X, Loader2, Power, ArrowRight, Users, AlertTriangle } from 'lucide-react';
import { listFriends, type Friend } from '../social/friendship-client';
import { listAcl, grantAcl, revokeAcl } from '../sharing/sharing-client';
import { CATALOG } from '../models/catalog';
import AuthGate from './AuthGate';
import { isGuestMode } from '../auth/guest-mode';

interface Status { running: boolean; pid: number | null }

interface Props {
  onSwitchTab?: (tab: 'jobs' | 'provider' | 'sharing' | 'activity') => void;
}

function resolveLabel(filename: string): string {
  const lower = filename.toLowerCase();
  const hit = CATALOG.find((m) => m.ggufFile.toLowerCase() === lower);
  return hit ? hit.displayName : filename.replace(/\.gguf$/i, '');
}

export default function FriendSharingPanel({ onSwitchTab }: Props) {
  const [installed, setInstalled] = useState<string[] | null>(null);
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [grants, setGrants] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ running: false, pid: null });
  const [bulkBusy, setBulkBusy] = useState<'share' | 'revoke' | null>(null);
  const [bulkError, setBulkError] = useState('');
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState('');

  useEffect(() => {
    if (isGuestMode()) { setLoading(false); return; }
    let cancelled = false;
    Promise.all([
      invoke<string[]>('llama_runtime_list_installed_models').catch(() => [] as string[]),
      listFriends().catch((e) => { throw e; }),
      listAcl().catch((e) => { throw e; }),
    ])
      .then(([inst, fr, acl]) => {
        if (cancelled) return;
        setInstalled(inst);
        setFriends(fr);
        setGrants(new Set(acl.map((r) => r.friendId)));
        setError('');
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      invoke<Status>('provider_runtime_status')
        .then((s) => { if (!cancelled) setStatus(s); })
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  async function toggle(friendId: string, on: boolean) {
    setBusy((s) => new Set([...s, friendId]));
    setRowError((e) => ({ ...e, [friendId]: '' }));
    try {
      if (on) {
        await grantAcl(friendId);
        setGrants((g) => new Set([...g, friendId]));
      } else {
        await revokeAcl(friendId);
        setGrants((g) => { const n = new Set(g); n.delete(friendId); return n; });
      }
    } catch (e: any) {
      setRowError((er) => ({ ...er, [friendId]: String(e?.message || e) }));
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(friendId); return n; });
    }
  }

  async function shareWithAll() {
    if (!friends) return;
    const targets = friends.filter((f) => !grants.has(f.friendId));
    if (targets.length === 0) return;
    setBulkBusy('share');
    setBulkError('');
    const next = new Set(grants);
    for (const f of targets) {
      try {
        await grantAcl(f.friendId);
        next.add(f.friendId);
      } catch (e: any) {
        setBulkError(`Failed on ${f.friendId.slice(0, 12)}: ${String(e?.message || e)}`);
        break;
      }
    }
    setGrants(next);
    setBulkBusy(null);
  }

  async function revokeAll() {
    if (grants.size === 0) return;
    setBulkBusy('revoke');
    setBulkError('');
    const next = new Set(grants);
    for (const friendId of [...grants]) {
      try {
        await revokeAcl(friendId);
        next.delete(friendId);
      } catch (e: any) {
        setBulkError(`Failed on ${friendId.slice(0, 12)}: ${String(e?.message || e)}`);
        break;
      }
    }
    setGrants(next);
    setBulkBusy(null);
  }

  async function onStop() {
    setStopping(true);
    setStopError('');
    try {
      const next = await invoke<Status>('provider_runtime_stop');
      setStatus(next);
    } catch (e: any) {
      setStopError(String(e?.message || e));
    } finally {
      setStopping(false);
    }
  }

  const friendCount = friends?.length ?? 0;
  const sharedCount = grants.size;
  const running = status.running;

  return (
    <AuthGate>
    <div className="p-[18px]">
      <div className="flex items-center gap-2 text-[13.5px] font-black text-[var(--text)]">
        <Share2 size={14} strokeWidth={2.4} />
        Share my LLMs with friends
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
        Per-friend opt-in. Default OFF. Only mutual friends appear here. No payment, no metering — pure gift.
      </div>

      {/* Runtime status banner */}
      <section className="mt-4 p-3 rounded border border-[var(--border)] bg-[var(--bg)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                running ? 'bg-[#3bd16f]/15 text-[#3bd16f]' : 'bg-[var(--glass-bg-strong)] text-[var(--text-dim)]'
              }`}
            >
              <Power size={13} strokeWidth={2.6} />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-black text-[var(--text)] flex items-center gap-2">
                Hosting runtime
                <span
                  className={`text-[9.5px] font-black uppercase tracking-[0.06em] px-1.5 py-[1px] rounded-full ${
                    running
                      ? 'bg-[#3bd16f]/15 text-[#3bd16f] border border-[#3bd16f]/40'
                      : 'bg-[var(--glass-bg-strong)] text-[var(--text-dim)] border border-[var(--border)]'
                  }`}
                >
                  {running ? 'Live' : 'Off'}
                </span>
              </div>
              <div className="text-[10.5px] text-[var(--text-dim)] mt-0.5">
                {running
                  ? `Sharing with ${sharedCount} friend${sharedCount === 1 ? '' : 's'}${status.pid ? ` · pid ${status.pid}` : ''}`
                  : 'Compute not shared with anyone right now'}
              </div>
            </div>
          </div>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping}
              className="flex items-center gap-1.5 px-3 h-[28px] rounded-full text-[11.5px] font-black border bg-transparent text-[var(--text)] border-[var(--border)] hover:border-[var(--red)] hover:text-[var(--red)] transition-colors disabled:opacity-50"
            >
              {stopping ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} strokeWidth={2.6} />}
              Stop hosting
            </button>
          ) : onSwitchTab ? (
            <button
              type="button"
              onClick={() => onSwitchTab('provider')}
              className="flex items-center gap-1.5 px-3 h-[28px] rounded-full text-[11.5px] font-black border bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)] hover:opacity-90 transition-colors"
            >
              Start in P2P Provider
              <ArrowRight size={12} strokeWidth={2.6} />
            </button>
          ) : null}
        </div>
        {stopError && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px]" style={{ color: '#e07070' }}>
            <AlertTriangle size={11} strokeWidth={2.4} className="flex-shrink-0 mt-[1px]" />
            <span>{stopError}</span>
          </div>
        )}
      </section>

      {/* Installed LLMs */}
      <section className="mt-4 p-3 rounded border border-[var(--border)] bg-[var(--bg)]">
        <div className="flex items-center gap-2 text-[12px] font-black text-[var(--text)]">
          <Cpu size={12} strokeWidth={2.4} />
          My hosted LLMs
        </div>
        <div className="mt-2 text-[11px] text-[var(--text-dim)]">
          These models are installed locally and will be reachable by any friend you grant access to.
        </div>
        <div className="mt-2">
          {!installed ? (
            <div className="text-[11.5px] text-[var(--text-dim)]">Loading…</div>
          ) : installed.length === 0 ? (
            <div className="text-[11.5px] text-[var(--text-dim)] italic">
              No LLM installed yet. Open Settings → Local LLM to download one.
            </div>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {installed.map((f) => (
                <li
                  key={f}
                  className="px-2 py-1 rounded text-[11px] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)]"
                  title={f}
                >
                  {resolveLabel(f)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Friend list with toggles */}
      <section className="mt-4">
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-2">
            <Users size={12} strokeWidth={2.4} className="text-[var(--text-dim)]" />
            <span className="text-[12px] font-black text-[var(--text)]">Friends</span>
            {friends && friends.length > 0 && (
              <span className="text-[10.5px] text-[var(--text-dim)]">
                {sharedCount}/{friendCount} sharing
              </span>
            )}
          </div>
          {friends && friends.length > 1 && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={shareWithAll}
                disabled={bulkBusy !== null || sharedCount === friendCount}
                className="flex items-center gap-1 px-2 h-[24px] rounded-full text-[10.5px] font-black border bg-transparent text-[var(--text-dim)] border-[var(--border)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Grant ACL to every mutual friend"
              >
                {bulkBusy === 'share' ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} strokeWidth={2.6} />}
                Share with all
              </button>
              <button
                type="button"
                onClick={revokeAll}
                disabled={bulkBusy !== null || sharedCount === 0}
                className="flex items-center gap-1 px-2 h-[24px] rounded-full text-[10.5px] font-black border bg-transparent text-[var(--text-dim)] border-[var(--border)] hover:text-[var(--red)] hover:border-[var(--red)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Revoke ACL from every friend"
              >
                {bulkBusy === 'revoke' ? <Loader2 size={10} className="animate-spin" /> : <X size={10} strokeWidth={2.6} />}
                Revoke all
              </button>
            </div>
          )}
        </div>
        {bulkError && (
          <div className="mb-2 text-[11px]" style={{ color: '#e07070' }}>{bulkError}</div>
        )}
        {loading ? (
          <div className="text-[11.5px] text-[var(--text-dim)]">Loading…</div>
        ) : error ? (
          <div className="text-[11.5px]" style={{ color: '#e07070' }}>{error}</div>
        ) : !friends || friends.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-8 gap-2">
            <div className="text-3xl opacity-70">🫂</div>
            <div className="text-[12px] font-bold text-[var(--text-muted)]">No mutual friends yet</div>
            <div className="text-[11.5px] text-[var(--text-dim)] max-w-[320px] leading-relaxed">
              You need at least one confirmed friend before you can share compute.
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {friends.map((f) => {
              const on = grants.has(f.friendId);
              const isBusy = busy.has(f.friendId) || bulkBusy !== null;
              const err = rowError[f.friendId];
              return (
                <li
                  key={f.friendId}
                  className="p-3 rounded border border-[var(--border)] bg-[var(--bg)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[11.5px] font-mono text-[var(--text)] truncate"
                        title={f.friendId}
                      >
                        {f.friendId.slice(0, 12)}
                      </div>
                      <div className="mt-1 text-[11px] text-[var(--text-dim)]">
                        {on ? 'sharing enabled' : 'not shared'}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => toggle(f.friendId, !on)}
                      aria-pressed={on}
                      className={`flex items-center gap-1.5 px-3 h-[28px] rounded-full text-[11.5px] font-black border transition-colors disabled:opacity-50 ${
                        on
                          ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                          : 'bg-transparent text-[var(--text-dim)] border-[var(--border)] hover:text-[var(--text)]'
                      }`}
                    >
                      {busy.has(f.friendId) ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : on ? (
                        <Check size={12} strokeWidth={2.6} />
                      ) : (
                        <X size={12} strokeWidth={2.6} />
                      )}
                      {on ? 'Shared' : 'Share'}
                    </button>
                  </div>
                  {err && (
                    <div className="mt-2 text-[11px]" style={{ color: '#e07070' }}>
                      {err}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
    </AuthGate>
  );
}

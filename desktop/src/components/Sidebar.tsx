import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { Session, ProfileResponse } from '../types';
import MonkeyLogo from './MonkeyLogo';
import { isGuestMode, exitGuestMode } from '../auth/guest-mode';
import { signalUnauthorized } from '../auth/auth-events';

interface Props {
  onNewSession: () => void;
  onSignOut: () => void;
  onSelectSession: (session: Session) => void;
  activeSessionId: string | null;
  sessionsRefreshKey?: number;
}

export default function Sidebar({ onNewSession, onSignOut, onSelectSession, activeSessionId, sessionsRefreshKey = 0 }: Props) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [query, setQuery] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);

  useEffect(() => {
    setLoadingSessions(true);
    api.getSessions()
      .then(list => setSessions([...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())))
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, [sessionsRefreshKey]);

  const filtered = query.trim()
    ? sessions.filter(s => {
        const q = query.toLowerCase();
        return (s.summary || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q);
      })
    : sessions;

  useEffect(() => {
    if (isGuestMode()) return;
    api.getProfile().then(setProfile).catch(() => {});
  }, []);

  const guest = isGuestMode();

  return (
    <aside className="flex flex-col w-56 flex-shrink-0 bg-[var(--bg2)] border-r border-[var(--border)] overflow-hidden">
      {/* New session */}
      <div className="px-3 py-[12px] flex justify-center pb-[6px]">
        <button
          onClick={onNewSession}
          className="inline-flex items-center gap-[7px] px-3.5 py-[7px] rounded-full border border-[var(--border)] bg-[var(--bg3)] text-[var(--text)] font-[Nunito] font-semibold text-[12px] cursor-pointer transition-all duration-150 shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:shadow-[0_3px_10px_rgba(0,0,0,0.15)] hover:-translate-y-0.5 hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
          {t('sidebar.newChat')}
        </button>
      </div>

      {/* Search */}
      {sessions.length > 4 && (
        <div className="px-3 pt-1 pb-0">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('sidebar.searchPlaceholder')}
            aria-label={t('sidebar.searchSessions')}
            className="w-full px-2.25 py-[5px] bg-[var(--bg3)] border border-[var(--border)] rounded-full text-[var(--text)] text-[11.5px] font-[Nunito] font-medium outline-none"
          />
        </div>
      )}

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-2 py-[6px]">
        <p className="px-2 py-1 text-[10px] font-bold text-[var(--text-dim)] uppercase tracking-[0.06em]">
          {query.trim() ? t('sidebar.results', { count: filtered.length }) : t('sidebar.recent')}
        </p>
        {loadingSessions && sessions.length === 0 && (
          <div className="px-2 py-[6px] flex flex-col gap-1.5">
            {[0,1,2].map(i => (
              <div key={i} className="h-[22px] rounded-[var(--r)] bg-[var(--bg3)] animate-pulse" style={{ opacity: 0.6 - i * 0.15, animationDuration: '1.4s' }} />
            ))}
          </div>
        )}
        {!loadingSessions && sessions.length === 0 && (
          <p className="px-2 py-[6px] text-[12px] text-[var(--text-dim)]">{t('sidebar.noSessions')}</p>
        )}
        {!loadingSessions && sessions.length > 0 && filtered.length === 0 && (
          <p className="px-2 py-[6px] text-[12px] text-[var(--text-dim)]">{t('sidebar.noResults')}</p>
        )}
        {filtered.map(s => (
          <div
            key={s.id}
            onClick={() => onSelectSession(s)}
            title={s.summary || s.name}
            className={`px-2.5 py-[7px] rounded-[var(--r)] text-[12.5px] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap transition-all duration-120 ${
              activeSessionId === s.id
                ? 'text-[var(--text)] bg-[var(--bg3)] border-l-2 border-[var(--accent)] font-semibold'
                : 'text-[var(--text-muted)] bg-transparent border-l-2 border-transparent font-medium'
            }`}
          >
            {s.summary || s.name || 'Session'}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--border)] px-3 py-2.5">
        {profile && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-[var(--accent-dim)] flex items-center justify-center text-[12px] font-black text-[var(--accent)] flex-shrink-0">
              {profile.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="text-[11.5px] text-[var(--text-muted)] overflow-hidden text-ellipsis whitespace-nowrap font-medium">
              {profile.email}
            </span>
          </div>
        )}
        {guest ? (
          <button
            onClick={() => { exitGuestMode(); signalUnauthorized(); }}
            className="w-full text-[12px] text-[var(--accent)] bg-none border-none cursor-pointer text-left px-0.5 py-1 font-[Nunito] font-bold transition-colors duration-150 hover:opacity-80"
          >
            {t('guest.loginCta', 'Se connecter')}
          </button>
        ) : (
          <button
            onClick={onSignOut}
            className="w-full text-[12px] text-[var(--text-dim)] bg-none border-none cursor-pointer text-left px-0.5 py-1 font-[Nunito] font-semibold transition-colors duration-150 hover:text-[var(--red)]"
          >
            {t('sidebar.signOut')}
          </button>
        )}
      </div>
    </aside>
  );
}

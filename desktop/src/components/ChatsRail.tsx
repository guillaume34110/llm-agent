import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, MessageSquare, LogOut } from 'lucide-react';
import { api } from '../api';
import type { Session, ProfileResponse } from '../types';

interface Props {
  onNewSession: () => void;
  onSignOut: () => void;
  onSelectSession: (session: Session) => void;
  activeSessionId: string | null;
  sessionsRefreshKey?: number;
}

export default function ChatsRail({ onNewSession, onSignOut, onSelectSession, activeSessionId, sessionsRefreshKey = 0 }: Props) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getSessions()
      .then(list => setSessions([...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionsRefreshKey]);

  useEffect(() => { api.getProfile().then(setProfile).catch(() => {}); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(s =>
      (s.summary || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
    );
  }, [sessions, query]);

  return (
    <aside
      className="w-[240px] flex-shrink-0 relative isolate min-h-0"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        borderRight: '1px solid var(--glass-border)',
      }}
    >
      <div className="absolute inset-0 flex flex-col z-10">
      <div className="px-3 pt-3 pb-2 flex items-center gap-2">
        <div className="text-[10.5px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)] flex-1">
          {t('sidebar.recent', { defaultValue: 'Chats' })}
        </div>
        <button
          onClick={onNewSession}
          title="⌘N"
          className="flex items-center gap-1 px-2.5 h-[24px] rounded-full text-[10.5px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
        >
          <Plus size={11} strokeWidth={2.6} />
          New
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={12} strokeWidth={2.2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('sidebar.searchPlaceholder', { defaultValue: 'Search…' })}
            className="w-full pl-7 pr-2.5 h-[26px] bg-transparent outline-none border border-[var(--glass-border)] rounded-full text-[11.5px] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
        {loading && sessions.length === 0 && (
          <div className="px-2 py-2 flex flex-col gap-1.5">
            {[0,1,2].map(i => (
              <div key={i} className="h-[28px] rounded-[var(--rm)] bg-[var(--glass-bg-strong)] animate-pulse" style={{ opacity: 0.6 - i * 0.15 }} />
            ))}
          </div>
        )}
        {!loading && sessions.length === 0 && (
          <div className="px-2 py-6 text-center text-[11.5px] text-[var(--text-dim)]">
            {t('sidebar.noSessions', { defaultValue: 'No sessions yet.' })}
          </div>
        )}
        {!loading && sessions.length > 0 && filtered.length === 0 && (
          <div className="px-2 py-6 text-center text-[11.5px] text-[var(--text-dim)]">
            {t('sidebar.noResults', { defaultValue: 'No match.' })}
          </div>
        )}
        {filtered.map(s => {
          const active = activeSessionId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSelectSession(s)}
              title={s.summary || s.name}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[var(--rm)] text-left transition-colors ${
                active
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-l-2 border-[var(--accent)] pl-[8px]'
                  : 'text-[var(--text)] hover:bg-[var(--glass-bg-strong)] border-l-2 border-transparent pl-[8px]'
              }`}
            >
              <MessageSquare size={11} strokeWidth={2.2} className={active ? '' : 'text-[var(--text-dim)]'} />
              <span className="flex-1 min-w-0 truncate text-[12px] font-bold">
                {s.summary || s.name || 'Session'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-[var(--glass-border)] px-3 py-2 flex items-center gap-2">
        {profile && (
          <>
            <div className="w-6 h-6 rounded-full bg-[var(--accent-soft)] flex items-center justify-center text-[10.5px] font-black text-[var(--accent)] flex-shrink-0">
              {profile.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="flex-1 min-w-0 truncate text-[10.5px] font-bold text-[var(--text-dim)]">
              {profile.email}
            </span>
          </>
        )}
        <button
          onClick={onSignOut}
          title={t('sidebar.signOut', { defaultValue: 'Sign out' })}
          className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--glass-bg-strong)]"
        >
          <LogOut size={11} strokeWidth={2.2} />
        </button>
      </div>
      </div>
    </aside>
  );
}

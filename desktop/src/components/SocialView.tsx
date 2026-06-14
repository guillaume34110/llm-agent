import { useEffect, useState } from 'react';
import ProfilePanel from './ProfilePanel';
import AvailabilityPanel from './AvailabilityPanel';
import InquiryInboxPanel from './InquiryInboxPanel';
import FriendsListPanel from './FriendsListPanel';
import ForumPanel from './ForumPanel';
import KbSharePanel from './KbSharePanel';
import BroadcastDialog from './BroadcastDialog';
import { fetchInquiryInbox, type InquiryRecord } from '../social/inquiry-client';
import { listFriends, type Friend } from '../social/friendship-client';
import { listMyGroupThreads, type GroupThread } from '../social/group-client';

type Section = 'pulse' | 'inbox' | 'friends' | 'forum' | 'kb' | 'profile' | 'availability';

const RAIL: { id: Section; label: string; icon: string }[] = [
  { id: 'pulse',        label: 'Pulse',         icon: '✨' },
  { id: 'inbox',        label: 'Inbox',         icon: '📥' },
  { id: 'friends',      label: 'Friends',       icon: '🫂' },
  { id: 'forum',        label: 'Forum',         icon: '💬' },
  { id: 'kb',           label: 'Shared KB',     icon: '📚' },
  { id: 'profile',      label: 'Profile',       icon: '🪪' },
  { id: 'availability', label: 'Availability',  icon: '🟢' },
];

type PulseItem =
  | { kind: 'inquiry'; ts: number; data: InquiryRecord }
  | { kind: 'friend';  ts: number; data: Friend }
  | { kind: 'group';   ts: number; data: GroupThread };

function relTime(ts: number, now: number): string {
  const d = Math.max(0, now - ts);
  const m = Math.floor(d / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}h`;
  const days = Math.floor(h / 24);
  return `il y a ${days}j`;
}

function Pulse({ onGoto }: { onGoto: (s: Section) => void }) {
  const [items, setItems] = useState<PulseItem[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [friendsR, inqR, groupsR] = await Promise.allSettled([
        listFriends(), fetchInquiryInbox(), listMyGroupThreads(),
      ]);
      if (cancelled) return;
      const all: PulseItem[] = [];
      if (friendsR.status === 'fulfilled') {
        for (const f of friendsR.value) all.push({ kind: 'friend', ts: new Date(f.createdAt).getTime(), data: f });
      }
      if (inqR.status === 'fulfilled') {
        for (const i of inqR.value) all.push({ kind: 'inquiry', ts: new Date(i.createdAt).getTime(), data: i });
      }
      if (groupsR.status === 'fulfilled') {
        for (const g of groupsR.value) all.push({ kind: 'group', ts: new Date(g.createdAt).getTime(), data: g });
      }
      if ([friendsR, inqR, groupsR].every(r => r.status === 'rejected')) {
        setError('Backend indisponible');
      } else {
        setError('');
      }
      all.sort((a, b) => b.ts - a.ts);
      setItems(all.slice(0, 20));
    }
    load();
    const id = setInterval(load, 30_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (items === null) {
    return <div className="py-10 text-center text-[12px] text-[var(--text-dim)]">Chargement…</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 gap-2">
        <div className="text-4xl opacity-70">⚠️</div>
        <div className="text-[12.5px] font-bold text-[var(--text-muted)]">Backend down</div>
        <div className="text-[11.5px] text-[var(--text-dim)] max-w-[320px] leading-relaxed">{error}</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 gap-2">
        <div className="text-4xl opacity-70">✨</div>
        <div className="text-[12.5px] font-bold text-[var(--text-muted)]">Tout est calme</div>
        <div className="text-[11.5px] text-[var(--text-dim)] max-w-[340px] leading-relaxed">
          Pas d'activité récente. Active <button onClick={() => onGoto('availability')} className="text-[var(--accent)] underline">Disponibilité</button> pour recevoir des inquiries, ou broadcast une demande P2P.
        </div>
      </div>
    );
  }

  const now = Date.now();

  return (
    <div className="space-y-2">
      <div className="text-[13.5px] font-black text-[var(--text)] mb-2">Pulse</div>
      <div className="mb-3 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
        Activité récente sur ton réseau P2P.
      </div>
      {items.map((it, idx) => {
        const key = `${it.kind}-${idx}`;
        if (it.kind === 'inquiry') {
          const inq = it.data;
          const tags = inq.filters.tags || [];
          return (
            <button
              key={key}
              onClick={() => onGoto('inbox')}
              className="w-full text-left p-3 glass-card hover:!border-[var(--accent)] transition-colors flex items-start gap-3"
            >
              <div className="text-[18px] flex-shrink-0">📥</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[var(--text)]">
                  Nouvelle inquiry · <span className="text-[var(--text-dim)] font-normal">{inq.mode.replace('find_', '')}</span>
                </div>
                {tags.length > 0 && (
                  <div className="mt-1 text-[11px] text-[var(--text-dim)] truncate">{tags.join(' · ')}</div>
                )}
              </div>
              <div className="text-[10.5px] text-[var(--text-dim)] flex-shrink-0">{relTime(it.ts, now)}</div>
            </button>
          );
        }
        if (it.kind === 'friend') {
          const f = it.data;
          return (
            <button
              key={key}
              onClick={() => onGoto('friends')}
              className="w-full text-left p-3 glass-card hover:!border-[var(--accent)] transition-colors flex items-start gap-3"
            >
              <div className="text-[18px] flex-shrink-0">🫂</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-[var(--text)]">Nouveau collab</div>
                <div className="mt-1 text-[11px] text-[var(--text-dim)] font-mono truncate">{f.friendId.slice(0, 16)}…</div>
              </div>
              <div className="text-[10.5px] text-[var(--text-dim)] flex-shrink-0">{relTime(it.ts, now)}</div>
            </button>
          );
        }
        const g = it.data;
        return (
          <button
            key={key}
            onClick={() => onGoto('kb')}
            className="w-full text-left p-3 glass-card hover:!border-[var(--accent)] transition-colors flex items-start gap-3"
          >
            <div className="text-[18px] flex-shrink-0">📚</div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-[var(--text)] truncate">KB groupe · {g.title}</div>
              <div className="mt-1 text-[11px] text-[var(--text-dim)]">{(g.members?.length ?? 0)} membre(s)</div>
            </div>
            <div className="text-[10.5px] text-[var(--text-dim)] flex-shrink-0">{relTime(it.ts, now)}</div>
          </button>
        );
      })}
    </div>
  );
}

export default function SocialView() {
  const [section, setSection] = useState<Section>('pulse');
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[var(--bg)]">
      {/* Left rail */}
      <aside className="w-[200px] flex-shrink-0 border-r border-[var(--border)] bg-[var(--bg2)] relative isolate py-3 px-2">
        <div className="relative z-10 flex flex-col gap-0.5 h-full">
        {RAIL.map(item => (
          <button
            key={item.id}
            onClick={() => setSection(item.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-[var(--rm)] text-[12.5px] font-bold text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              section === item.id
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg3)] hover:text-[var(--text)]'
            }`}
          >
            <span className="text-[14px]">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
          </button>
        ))}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setBroadcastOpen(true)}
          className="mt-2 mx-1 px-3 py-2 rounded-[var(--rm)] text-[12px] font-black bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90"
        >
          📣 Broadcast P2P
        </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[920px] mx-auto p-5">
          {section === 'pulse' && <Pulse onGoto={setSection} />}
          {section === 'inbox' && (
            <section className="glass-card overflow-hidden">
              <InquiryInboxPanel />
            </section>
          )}
          {section === 'friends' && (
            <section className="glass-card overflow-hidden">
              <FriendsListPanel />
            </section>
          )}
          {section === 'forum' && (
            <section className="glass-card overflow-hidden">
              <ForumPanel />
            </section>
          )}
          {section === 'kb' && (
            <section className="glass-card overflow-hidden">
              <KbSharePanel />
            </section>
          )}
          {section === 'profile' && (
            <section className="glass-card overflow-hidden">
              <ProfilePanel />
            </section>
          )}
          {section === 'availability' && (
            <section className="glass-card overflow-hidden">
              <AvailabilityPanel />
            </section>
          )}
        </div>
      </div>

      <BroadcastDialog open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </div>
  );
}

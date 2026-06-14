import { useState } from 'react';
import { Users, Megaphone } from 'lucide-react';
import ProfilePanel from './ProfilePanel';
import AvailabilityPanel from './AvailabilityPanel';
import InquiryInboxPanel from './InquiryInboxPanel';
import FriendsListPanel from './FriendsListPanel';
import ForumPanel from './ForumPanel';
import BroadcastDialog from './BroadcastDialog';
import AuthGate from './AuthGate';

type Tab = 'friends' | 'inquiries' | 'forum' | 'profile' | 'availability';

const TABS: { id: Tab; label: string }[] = [
  { id: 'friends',      label: 'Friends' },
  { id: 'inquiries',    label: 'Inquiries' },
  { id: 'forum',        label: 'Forum' },
  { id: 'profile',      label: 'Profile' },
  { id: 'availability', label: 'Availability' },
];

export default function PeopleView() {
  const [tab, setTab] = useState<Tab>('friends');
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  return (
    <AuthGate>
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative isolate">
      <div className="flex-shrink-0 px-6 pt-5 pb-3 relative z-10">
        <div className="flex items-center gap-3 mb-1">
          <Users size={20} strokeWidth={2.2} className="text-[var(--accent)]" />
          <h1 className="text-[20px] font-black tracking-[-0.4px] text-[var(--text)]">People</h1>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setBroadcastOpen(true)}
            className="flex items-center gap-1.5 px-3 h-[28px] rounded-full text-[11.5px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
          >
            <Megaphone size={12} strokeWidth={2.6} />
            Broadcast
          </button>
        </div>
        <p className="text-[12px] text-[var(--text-dim)] mb-3">Your P2P network — friends, inquiries, forum.</p>

        <div className="flex gap-1 border-b border-[var(--glass-border)]">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 h-[32px] text-[12px] font-bold border-b-2 transition-colors -mb-px ${
                tab === t.id
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 relative z-10">
        <div className="max-w-[920px] mx-auto">
          {tab === 'friends'      && <section className="glass-card overflow-hidden"><FriendsListPanel /></section>}
          {tab === 'inquiries'    && <section className="glass-card overflow-hidden"><InquiryInboxPanel /></section>}
          {tab === 'forum'        && <section className="glass-card overflow-hidden"><ForumPanel /></section>}
          {tab === 'profile'      && <section className="glass-card overflow-hidden"><ProfilePanel /></section>}
          {tab === 'availability' && <section className="glass-card overflow-hidden"><AvailabilityPanel /></section>}
        </div>
      </div>

      <BroadcastDialog open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </div>
    </AuthGate>
  );
}

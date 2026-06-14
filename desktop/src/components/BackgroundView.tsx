import { useState } from 'react';
import { Activity } from 'lucide-react';
import JobsWidget from './JobsWidget';
import ProviderHostingPanel from './ProviderHostingPanel';
import FriendSharingPanel from './FriendSharingPanel';
import ActivityTicker from './ActivityTicker';
import Conversion3DPanel from './Conversion3DPanel';

type Tab = 'jobs' | 'provider' | 'sharing' | 'activity' | 'convert3d';

const TABS: { id: Tab; label: string }[] = [
  { id: 'provider',  label: 'P2P Provider' },
  { id: 'jobs',      label: 'Jobs & Schedules' },
  { id: 'sharing',   label: 'Share with Friends' },
  { id: 'convert3d', label: '2D → 3D' },
  { id: 'activity',  label: 'Activity' },
];

export default function BackgroundView() {
  const [tab, setTab] = useState<Tab>('provider');

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative isolate">
      <div className="flex-shrink-0 px-6 pt-5 pb-2 relative z-10">
        <div className="flex items-center gap-3 mb-1">
          <Activity size={20} strokeWidth={2.2} className="text-[var(--accent)]" />
          <h1 className="text-[20px] font-black tracking-[-0.4px] text-[var(--text)]">Background</h1>
        </div>
        <p className="text-[12px] text-[var(--text-dim)] mb-3">Jobs, schedules, watchers — everything your agent is doing while you're not looking.</p>
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
        <div className="max-w-[920px] mx-auto pt-4">
          {tab === 'jobs'     && <JobsWidget />}
          {tab === 'provider' && <section className="glass-card overflow-hidden"><ProviderHostingPanel /></section>}
          {tab === 'sharing'  && <section className="glass-card overflow-hidden"><FriendSharingPanel onSwitchTab={setTab} /></section>}
          {tab === 'convert3d' && <section className="glass-card overflow-hidden"><Conversion3DPanel /></section>}
          {tab === 'activity' && <section className="glass-card overflow-hidden p-4"><ActivityTicker /></section>}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getJobs, subscribeJobs, type BackgroundJob } from '../jobs/job-service';
import { subscribeWhatsAppActivity, type WhatsAppActivityEvent } from '../whatsapp/wa-bridge';

const NEON = 'var(--accent)';
const NEON_DIM = 'var(--accent-dim)';
const NEON_FAINT = 'var(--accent-glow)';
const AMBER = 'var(--amber)';
const RED = 'var(--red)';

interface Item { at: string; level: 'info' | 'warn' | 'error'; tag: string; message: string; }

function itemsFromJobs(jobs: BackgroundJob[]): Item[] {
  const items: Item[] = [];
  for (const j of jobs) {
    for (const l of j.logs) {
      items.push({ at: l.at, level: 'info', tag: j.kind.slice(0, 8), message: `${j.title} — ${l.message}` });
    }
    if (j.error) {
      items.push({ at: j.finishedAt || j.updatedAt, level: 'error', tag: j.kind.slice(0, 8), message: `${j.title} — ${j.error}` });
    }
  }
  return items;
}

function levelColor(l: Item['level']) {
  return l === 'error' ? RED : l === 'warn' ? AMBER : NEON;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ActivityTicker() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<BackgroundJob[]>(getJobs());
  const [wa, setWa] = useState<WhatsAppActivityEvent[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => subscribeJobs(setJobs), []);
  useEffect(() => subscribeWhatsAppActivity(setWa), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 6, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  const all: Item[] = [
    ...itemsFromJobs(jobs),
    ...wa.map(e => ({ at: e.at, level: e.level, tag: e.tag, message: e.message } as Item)),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const latest = all.length ? all[all.length - 1] : null;
  const recent = all.slice(-60);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, recent.length]);

  const color = latest ? levelColor(latest.level) : NEON_DIM;

  return (
    <div ref={wrapRef} className="bridge-viz-wrap relative flex items-center flex-[0_1_460px] min-w-0" style={{ zIndex: 2147483647 }}>
      <div className="bridge-viz" style={{ color: latest ? color : undefined }}>
        <span
          className="w-[6px] h-[6px] rounded-full flex-shrink-0"
          style={{
            background: latest ? color : 'var(--accent-dim)',
            boxShadow: latest ? `0 0 6px ${color}` : 'none',
          }}
        />
        {latest ? (
          <>
            <span className="opacity-70 flex-shrink-0">{latest.tag}</span>
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {latest.message}
            </span>
          </>
        ) : (
          <span className="flex-1 italic">idle</span>
        )}
        <button
          onClick={() => setOpen(v => !v)}
          title={open ? t('activity.collapse') : t('activity.expand')}
          className="border-none bg-transparent text-[inherit] cursor-pointer px-[2px] py-0 flex items-center flex-shrink-0 opacity-70"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="bridge-viz__panel"
          style={{ left: pos.left, top: pos.top, width: pos.width }}
        >
          <div ref={scrollRef} className="max-h-[280px] overflow-y-auto flex flex-col gap-[2px]">
            {recent.length === 0 && (
              <div className="opacity-60 italic">{t('activity.idle')}</div>
            )}
            {recent.map((it, i) => {
              const c = levelColor(it.level);
              return (
                <div key={i} className="flex gap-2 items-start">
                  <span className="opacity-60 flex-shrink-0">{fmtTime(it.at)}</span>
                  <span className="font-bold flex-shrink-0 min-w-[40px]" style={{ color: c }}>{it.tag}</span>
                  <span className="flex-1 break-words" style={{ color: c }}>{it.message}</span>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

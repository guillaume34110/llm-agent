import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cancelJob, clearFinishedJobs, getJobs, subscribeJobs, type BackgroundJob } from '../jobs/job-service';
import FluoActivityFeed, { type FluoActivityItem } from './FluoActivityFeed';

function badge(job: BackgroundJob, t: (key: string) => string) {
  if (job.status === 'done') return { label: t('jobs.badge.done'), color: 'var(--accent)', bg: 'var(--accent-soft)' };
  if (job.status === 'failed') return { label: t('jobs.badge.failed'), color: 'var(--red)', bg: 'var(--red-soft)' };
  if (job.status === 'running') return { label: t('jobs.badge.running'), color: 'var(--blue)', bg: 'var(--blue-soft)' };
  return { label: t('jobs.badge.pending'), color: 'var(--amber)', bg: 'var(--amber-soft)' };
}

export default function JobsView() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState(getJobs());

  useEffect(() => subscribeJobs(setJobs), []);

  const activityItems = useMemo<FluoActivityItem[]>(() => {
    const items: FluoActivityItem[] = [];
    for (const j of jobs) {
      for (let i = 0; i < j.logs.length; i++) {
        items.push({
          id: `${j.id}-${i}`,
          at: j.logs[i].at,
          level: j.status === 'failed' && i === j.logs.length - 1 ? 'error' : 'info',
          tag: j.kind.slice(0, 10),
          message: `${j.title} — ${j.logs[i].message}`,
        });
      }
      if (j.error) items.push({ id: `${j.id}-err`, at: j.finishedAt || j.updatedAt, level: 'error', tag: j.kind.slice(0, 10), message: `${j.title} — ${j.error}` });
    }
    items.sort((a, b) => a.at.localeCompare(b.at));
    return items.slice(-60);
  }, [jobs]);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative isolate">
      <div className="px-[18px] py-4 border-b border-[var(--border)] bg-[var(--bg2)] flex items-center gap-3 relative z-10">
        <div>
          <div className="text-[18px] font-[900] text-[var(--text)]">{t('jobs.title')}</div>
          <div className="mt-1 text-[12px] text-[var(--text-dim)]">{t('jobs.subtitle')}</div>
        </div>
        <div className="flex-1" />
        <button
          onClick={clearFinishedJobs}
          className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[10px] py-2 cursor-pointer font-bold"
        >
          {t('jobs.clearButton')}
        </button>
      </div>

      <div className="p-[18px] overflow-auto grid gap-3 relative z-10">
        <FluoActivityFeed title={t('jobs.activityTitle')} items={activityItems} />
        {jobs.length === 0 && (
          <div className="border border-dashed border-[var(--border)] rounded-[var(--rm)] p-[22px] text-[var(--text-dim)] text-[13px] relative isolate overflow-hidden min-h-[140px]">
            <div className="relative z-10">{t('jobs.empty')}</div>
          </div>
        )}
        {jobs.map(job => {
          const meta = badge(job, t);
          return (
            <div key={job.id} className="border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
              <div className="flex items-center gap-[10px]">
                <div className="flex-1">
                  <div className="text-[14px] font-[900] text-[var(--text)]">{job.title}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">{job.kind}</div>
                </div>
                <span className="px-[9px] py-[5px] rounded-full text-[11.5px] font-[800]" style={{ background: meta.bg, color: meta.color }}>
                  {meta.label}
                </span>
                {(job.status === 'running' || job.status === 'pending') && (
                  <button
                    onClick={() => cancelJob(job.id)}
                    title={t('jobs.cancelTitle')}
                    className="flex items-center justify-center gap-[5px] px-[10px] py-[5px] rounded-full border border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)] cursor-pointer text-[11.5px] font-[800]"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
                    {t('jobs.stopButton')}
                  </button>
                )}
              </div>

              <div className="mt-[14px] h-2 rounded-full bg-[var(--bg)] overflow-hidden">
                <div style={{ width: `${Math.max(6, Math.round(job.progress * 100))}%`, height: '100%', background: meta.color, transition: 'width 0.2s ease' }} />
              </div>

              {job.result && (
                <div className="mt-[10px] text-[12.5px] text-[var(--accent)]">{job.result}</div>
              )}
              {job.error && (
                <div className="mt-[10px] text-[12.5px] text-[var(--red)]">{job.error}</div>
              )}

              {job.logs.length > 0 && (
                <div className="mt-3 border-t border-[var(--border)] pt-3 grid gap-[6px]">
                  {job.logs.slice(-6).map((log, index) => (
                    <div key={`${job.id}-${index}`} className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">
                      <span className="text-[var(--text-dim)]">{new Date(log.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                      {' — '}
                      {log.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

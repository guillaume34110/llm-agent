import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearFinishedJobs, getJobs, subscribeJobs, type BackgroundJob } from '../jobs/job-service';

function statusMeta(job: BackgroundJob, t: (key: string) => string) {
  if (job.status === 'running') return { label: t('jobs.badge.running'), color: 'var(--blue)' };
  if (job.status === 'pending') return { label: t('jobs.badge.pending'), color: 'var(--amber)' };
  if (job.status === 'failed') return { label: t('jobs.badge.failed'), color: 'var(--red)' };
  return { label: t('jobs.badge.done'), color: 'var(--accent)' };
}

export default function JobsWidget() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<BackgroundJob[]>(getJobs());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => subscribeJobs(setJobs), []);

  const active = useMemo(() => jobs.filter(j => j.status === 'running' || j.status === 'pending'), [jobs]);
  const recent = useMemo(() => jobs.slice(0, 6), [jobs]);

  const visible = expanded ? recent : active;
  if (visible.length === 0 && !expanded) return null;

  return (
    <div className="my-2 mx-4 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-[10px] text-[12px]">
      <div className="flex items-center gap-2">
        <div className="font-[800] text-[var(--text)]">
          {t('jobs.label')} · {active.length} {active.length > 1 ? t('jobs.activeMany') : t('jobs.activeOne')}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setExpanded(v => !v)}
          className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-2 py-[3px] cursor-pointer text-[11px] font-bold"
        >
          {expanded ? t('jobs.collapse') : t('jobs.expandAll')}
        </button>
        {expanded && (
          <button
            onClick={clearFinishedJobs}
            className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-2 py-[3px] cursor-pointer text-[11px] font-bold"
          >
            {t('jobs.cleanButton')}
          </button>
        )}
      </div>
      <div className="mt-2 grid gap-[6px]">
        {visible.map(job => {
          const meta = statusMeta(job, t);
          return (
            <div key={job.id} className="flex items-center gap-2">
              <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: meta.color }} />
              <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[var(--text-muted)]">
                {job.title}
              </div>
              <div className="w-[70px] h-1 rounded-full bg-[var(--bg)] overflow-hidden">
                <div style={{ width: `${Math.max(4, Math.round(job.progress * 100))}%`, height: '100%', background: meta.color }} />
              </div>
              <div className="text-[10.5px] font-bold w-[70px] text-right" style={{ color: meta.color }}>{meta.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

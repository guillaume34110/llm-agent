import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getRecentTools, clearUsageLog, subscribeUsageLog } from '../observability/usage-log';

function formatRelative(ts: number, t: any): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('audit.now');
  if (diff < 3_600_000) return t('audit.minutesAgo', { count: Math.floor(diff / 60000) });
  if (diff < 86_400_000) return t('audit.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return t('audit.daysAgo', { count: Math.floor(diff / 86_400_000) });
}

export default function AuditLogPanel() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Array<{ ts: number; name: string; ok: boolean }>>(() => getRecentTools(50));

  useEffect(() => {
    const unsubscribe = subscribeUsageLog(() => {
      setEntries(getRecentTools(50));
    });
    return unsubscribe;
  }, []);

  const handleClear = () => {
    if (window.confirm(t('audit.confirmClear'))) {
      clearUsageLog();
    }
  };

  return (
    <div className="mt-4">
      <div className="flex items-center text-[12px] font-bold text-[var(--text)] mb-[10px]">
        {t('audit.title')} ({entries.length})
        <button
          onClick={handleClear}
          className="text-[11px] px-[10px] py-1 rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text-muted)] cursor-pointer ml-auto"
        >
          {t('audit.clearButton')}
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center text-[12px] text-[var(--text-dim)] py-5 italic">
          {t('audit.empty')}
        </div>
      ) : (
        <div className="max-h-[240px] overflow-y-auto border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] p-2">
          {entries.map((entry, idx) => (
            <div
              key={idx}
              className="flex gap-2 text-[11.5px] px-[6px] py-1 items-center"
              style={{ borderBottom: idx === entries.length - 1 ? 'none' : '1px solid var(--border)' }}
            >
              <span className="font-semibold" style={{ color: entry.ok ? 'var(--accent)' : 'var(--red, #e25555)' }}>
                {entry.ok ? '✓' : '✗'}
              </span>
              <span className="font-semibold text-[var(--text)] flex-1">
                {entry.name}
              </span>
              <span className="text-[10.5px] text-[var(--text-dim)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatRelative(entry.ts, t)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

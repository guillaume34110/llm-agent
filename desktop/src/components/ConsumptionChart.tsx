import React, { useEffect, useState } from 'react';
import { getDailyTokens, subscribeUsageLog } from '../observability/usage-log';

export default function ConsumptionChart() {
  const [days, setDays] = useState(() => getDailyTokens(7));

  useEffect(() => {
    const unsubscribe = subscribeUsageLog(() => {
      setDays(getDailyTokens(7));
    });
    return unsubscribe;
  }, []);

  const totalTokens = days.reduce((sum, d) => sum + d.promptTokens + d.completionTokens, 0);
  const totalCostCents = days.reduce((sum, d) => sum + d.costCents, 0);
  const maxTokens = Math.max(...days.map(d => d.promptTokens + d.completionTokens), 1);

  if (totalTokens === 0) {
    return (
      <div className="mt-[14px] py-3 border-t border-[var(--border)]">
        <div className="text-[12px] text-[var(--text-dim)] italic">
          Aucune utilisation cette semaine.
        </div>
      </div>
    );
  }

  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  return (
    <div className="mt-[14px] py-3 border-t border-[var(--border)]">
      <div className="text-[11px] text-[var(--text-dim)] mb-3">
        7 derniers jours
      </div>

      <div className="flex items-end justify-center gap-[6px] h-20">
        {days.map((day, idx) => {
          const tokens = day.promptTokens + day.completionTokens;
          const heightPercent = maxTokens > 0 ? (tokens / maxTokens) * 100 : 0;
          const baseHeight = 2;
          const maxHeight = 60;
          const height = tokens === 0 ? baseHeight : Math.max(baseHeight, (heightPercent / 100) * maxHeight);

          const dayDate = new Date(day.dayIso);
          const dayIdx = dayDate.getUTCDay() === 0 ? 6 : dayDate.getUTCDay() - 1;
          const dayLabel = idx === days.length - 1 ? 'Auj.' : dayNames[dayIdx];

          const costDisplay = (day.costCents / 100).toFixed(2);

          return (
            <div key={day.dayIso} className="flex flex-col items-center gap-1">
              <div
                title={`${dayLabel} ${day.dayIso}: ${tokens} tokens, ${day.costCents}¢`}
                className="w-6 rounded cursor-pointer transition-opacity duration-150 hover:opacity-100"
                style={{
                  height: `${height}px`,
                  backgroundColor: 'var(--accent)',
                  borderRadius: '3px',
                  opacity: 0.85,
                }}
              />
              <div className="text-[11px] text-[var(--text-dim)] w-6 text-center h-4 flex items-center justify-center" style={{ fontWeight: idx === days.length - 1 ? 700 : 400 }}>
                {dayLabel}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-[14px] text-[11.5px] text-[var(--text-dim)] text-center">
        {totalTokens.toLocaleString()} tokens · {(totalCostCents / 100).toFixed(2)}€ cette semaine
      </div>
    </div>
  );
}

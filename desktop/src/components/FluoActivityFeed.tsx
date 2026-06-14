import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const NEON = 'var(--accent)';
const NEON_DIM = 'var(--accent-dim)';
const NEON_FAINT = 'var(--accent-glow)';
const AMBER = 'var(--amber)';
const RED = 'var(--red)';

export interface FluoActivityItem {
  id: string | number;
  at: string;
  level?: 'info' | 'warn' | 'error';
  tag?: string;
  message: string;
}

interface Props {
  title?: string;
  items: FluoActivityItem[];
  emptyLabel?: string;
  maxHeight?: number;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function levelColor(level?: FluoActivityItem['level']): string {
  if (level === 'error') return RED;
  if (level === 'warn') return AMBER;
  return NEON;
}

export default function FluoActivityFeed({ title = 'Activité', items, emptyLabel = '(idle)', maxHeight = 260 }: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const len = items.length;
  const finalTitle = typeof title === 'string' && title.startsWith('activity.') ? t(title) : title;
  const finalEmptyLabel = typeof emptyLabel === 'string' && emptyLabel.startsWith('activity.') ? t(emptyLabel) : emptyLabel;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [len]);

  return (
    <div
      className="font-[ui-monospace] text-[11.5px] leading-[1.45] bg-[var(--bg)] rounded-[10px] p-[10px] border"
      style={{
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        color: NEON,
        borderColor: NEON_DIM,
        boxShadow: `0 0 10px ${NEON_FAINT} inset, 0 0 4px ${NEON_FAINT}`,
        textShadow: `0 0 4px ${NEON_FAINT}`,
      }}
    >
      <div className="flex items-center gap-2 mb-[6px]">
        <span
          className="w-[7px] h-[7px] rounded-full"
          style={{
            background: NEON,
            boxShadow: `0 0 6px ${NEON}`,
          }}
        />
        <span className="font-[800] tracking-[0.04em] uppercase text-[10.5px]">
          {finalTitle}
        </span>
        <span className="flex-1" />
        <span className="text-[10px]" style={{ color: NEON_DIM }}>{len} évt</span>
      </div>
      <div
        ref={scrollRef}
        className="flex flex-col gap-[2px]"
        style={{ maxHeight, overflowY: 'auto' }}
      >
        {items.length === 0 && (
          <div className="italic" style={{ color: NEON_DIM }}>{finalEmptyLabel}</div>
        )}
        {items.map(it => {
          const c = levelColor(it.level);
          return (
            <div key={it.id} className="flex gap-2 items-start">
              <span className="flex-shrink-0" style={{ color: NEON_DIM }}>{fmtTime(it.at)}</span>
              {it.tag && (
                <span
                  className="font-bold flex-shrink-0 min-w-[40px]"
                  style={{
                    color: c,
                    textShadow: `0 0 5px var(--accent-glow)`,
                  }}
                >
                  {it.tag}
                </span>
              )}
              <span className="break-words flex-1" style={{ color: c }}>{it.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

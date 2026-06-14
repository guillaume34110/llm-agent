import React from 'react';
import { cn } from './cn';

type Tone = 'success' | 'muted' | 'partial' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  success: 'bg-[var(--green)/0.15] text-[var(--green)] border-[var(--green)/0.35]',
  muted:   'bg-[var(--bg3)] text-[var(--text-dim)] border-[var(--border)]',
  partial: 'bg-[var(--amber)/0.15] text-[var(--amber)] border-[var(--amber)/0.35]',
  danger:  'bg-[var(--danger-soft)] text-[oklch(72%_0.16_25)] border-[oklch(55%_0.18_25/0.5)]',
  info:    'bg-[var(--bg4)] text-[var(--text-muted)] border-[var(--border)]',
};

export function Chip({ tone = 'muted', children, className }: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[12px] font-bold font-[Nunito]',
      tones[tone],
      className,
    )}>
      {children}
    </span>
  );
}

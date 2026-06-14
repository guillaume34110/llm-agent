import React from 'react';
import { cn } from './cn';

export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-[var(--border)]', className)}>
      {tabs.map(t => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              'bg-transparent border-none cursor-pointer px-3.5 py-2.5 font-[Nunito] font-bold text-[13.5px] -mb-px transition-colors',
              active
                ? 'text-[var(--green)] border-b-2 border-[var(--green)]'
                : 'text-[var(--text-muted)] border-b-2 border-transparent hover:text-[var(--text)]',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

import React from 'react';
import { cn } from './cn';

export function Card({ title, action, children, className }: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(
      'bg-[var(--bg2)] border border-[var(--border)] rounded-[12px] p-5 flex flex-col gap-3',
      className,
    )}>
      {(title || action) && (
        <header className="flex items-center justify-between">
          {title && <h3 className="text-[14px] font-extrabold text-[var(--text)] m-0">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

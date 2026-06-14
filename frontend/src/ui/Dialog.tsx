import React, { useEffect, useRef } from 'react';
import { cn } from './cn';

export function Dialog({ open, onClose, title, children, width = 400 }: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-[oklch(4%_0.02_148/0.75)] flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'dlg-title' : undefined}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={cn(
          'fade-in bg-[var(--bg2)] border border-[var(--border)] rounded-[18px] p-7 flex flex-col gap-3 outline-none',
        )}
        style={{ width, boxShadow: 'var(--shadow-pop)' }}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <header className="flex items-center justify-between mb-1">
            <h3 id="dlg-title" className="text-[17px] font-extrabold text-[var(--text)] m-0">{title}</h3>
            <button onClick={onClose} aria-label="Fermer" className="bg-transparent border-none text-[var(--text-dim)] text-[20px] leading-none cursor-pointer hover:text-[var(--text)]">×</button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

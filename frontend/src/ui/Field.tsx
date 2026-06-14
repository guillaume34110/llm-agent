import React from 'react';
import { cn } from './cn';

export function Field({ label, helper, error, children, htmlFor }: {
  label?: string;
  helper?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={htmlFor} className="text-[11.5px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)]">
          {label}
        </label>
      )}
      {children}
      {error
        ? <span className="text-[12.5px] font-semibold text-[oklch(70%_0.16_25)]">{error}</span>
        : helper && <span className="text-[12px] text-[var(--text-dim)]">{helper}</span>}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest }, ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={cn(
        'w-full bg-[var(--bg3)] border rounded-[8px] px-3 py-2.5 text-[14px] text-[var(--text)] font-[Nunito] outline-none transition-colors',
        invalid ? 'border-[oklch(55%_0.18_25/0.6)]' : 'border-[var(--border)] focus:border-[var(--green)]',
        className,
      )}
    />
  );
});

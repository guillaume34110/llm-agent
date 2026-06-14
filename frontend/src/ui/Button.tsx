import React from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  full?: boolean;
}

const base = 'inline-flex items-center justify-center gap-2 font-bold font-[Nunito] transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer select-none';

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-[8px]',
  md: 'h-10 px-4 text-[14px] rounded-[10px]',
  lg: 'h-12 px-6 text-[15px] rounded-[12px]',
};

const variants: Record<Variant, string> = {
  primary: 'bg-[var(--green)] text-white hover:bg-[var(--green-dim)] shadow-[0_4px_16px_var(--green-glow)]',
  secondary: 'bg-[var(--bg3)] text-[var(--text)] hover:bg-[var(--bg4)] border border-[var(--border)]',
  ghost: 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg3)] hover:text-[var(--text)]',
  danger: 'bg-[var(--danger-soft)] text-[oklch(72%_0.16_25)] border border-[oklch(55%_0.18_25/0.5)] hover:bg-[oklch(45%_0.16_25/0.25)]',
  outline: 'bg-transparent text-[var(--green)] border-2 border-[var(--green)] hover:bg-[var(--green)/0.08]',
};

export function Button({
  variant = 'primary', size = 'md', loading, full, className, children, disabled, ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(base, sizes[size], variants[variant], full && 'w-full', className)}
    >
      {loading ? <><span className="dot" /><span className="dot" /><span className="dot" /></> : children}
    </button>
  );
}

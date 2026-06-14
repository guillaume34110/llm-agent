import React, { useEffect, useRef, useState } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  width?: number | string;
  menuWidth?: number | string;
  menuMaxHeight?: number;
  fontSize?: number;
  buttonPadding?: string;
  disabled?: boolean;
  direction?: 'up' | 'down';
}

export default function Dropdown({
  value,
  options,
  onChange,
  placeholder = 'Choisir…',
  title,
  width = '100%',
  menuWidth,
  menuMaxHeight = 320,
  fontSize = 11.5,
  buttonPadding = '7px 10px',
  disabled = false,
  direction = 'down',
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value);
  const label = current?.label || value || placeholder;

  return (
    <div ref={ref} className="dd-root" style={{ width }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(v => !v)}
        title={title || current?.value || placeholder}
        disabled={disabled}
        className={`dd-btn ${open ? 'is-open' : ''}`}
        style={{
          padding: buttonPadding,
          background: open ? 'var(--bg4)' : 'var(--bg3)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          fontSize,
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span className="overflow-hidden text-ellipsis flex-1 text-left">
          {label}
        </span>
        <span className="dd-caret">▾</span>
      </button>
      {open && (
        <div
          className={`dd-menu scrollbar-thin ${direction === 'up' ? 'dd-up' : ''}`}
          style={{
            width: menuWidth || width,
            maxHeight: menuMaxHeight,
            [direction === 'up' ? 'bottom' : 'top']: 'calc(100% + 6px)',
          } as React.CSSProperties}
        >
          {options.length === 0 && (
            <div className="dd-empty">Aucune option</div>
          )}
          {options.map((opt, i) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange(opt.value); setOpen(false); }}
                className={`dd-item ${selected ? 'is-selected' : ''}`}
                style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
              >
                <span className="dd-label">{opt.label}</span>
                {opt.hint && <span className="dd-hint">{opt.hint}</span>}
                {selected && (
                  <span className="dd-check" aria-hidden>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.2 L5 8.7 L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

export default function GlassModal({ open, title, subtitle, onClose, children, footer, width = 440 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    setTimeout(() => {
      const focusable = ref.current?.querySelector<HTMLElement>('input, textarea, button:not([data-close])');
      focusable?.focus();
    }, 30);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[10002] flex items-center justify-center"
      style={{ background: 'oklch(0% 0 0 / 0.45)', backdropFilter: 'blur(6px)' }}
    >
      <div
        ref={ref}
        onClick={e => e.stopPropagation()}
        style={{ width }}
        className="glass-card-strong max-w-[92vw] flex flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--glass-border)]">
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-black text-[var(--text)]">{title}</div>
            {subtitle && <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{subtitle}</div>}
          </div>
          <button
            data-close
            onClick={onClose}
            aria-label="Close"
            className="w-6 h-6 rounded-full hover:bg-[var(--glass-bg-strong)] flex items-center justify-center text-[var(--text-dim)] flex-shrink-0"
          >
            <X size={13} strokeWidth={2.4} />
          </button>
        </div>
        <div className="px-4 py-4 flex flex-col gap-3">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-[var(--glass-border)] flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface PromptProps {
  open: boolean;
  title: string;
  subtitle?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function GlassPromptModal({ open, title, subtitle, defaultValue = '', placeholder, confirmLabel = 'Save', onConfirm, onCancel }: PromptProps) {
  const [value, setValue] = React.useState(defaultValue);
  useEffect(() => { if (open) setValue(defaultValue); }, [open, defaultValue]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

  return (
    <GlassModal
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-3 h-[28px] rounded-full text-[11.5px] font-bold text-[var(--text-dim)] hover:bg-[var(--glass-bg-strong)]"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="px-3 h-[28px] rounded-full text-[11.5px] font-black bg-[var(--accent)] text-[var(--on-accent)] disabled:opacity-40 hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder={placeholder}
        className="w-full bg-transparent outline-none border border-[var(--glass-border)] rounded-[var(--rm)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
      />
    </GlassModal>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: string;
  destructive?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function GlassConfirmModal({ open, title, message, destructive, confirmLabel = 'Confirm', onConfirm, onCancel }: ConfirmProps) {
  return (
    <GlassModal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-3 h-[28px] rounded-full text-[11.5px] font-bold text-[var(--text-dim)] hover:bg-[var(--glass-bg-strong)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={destructive ? { background: 'var(--red)', color: 'white' } : undefined}
            className="px-3 h-[28px] rounded-full text-[11.5px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[12.5px] text-[var(--text)] leading-relaxed">{message}</div>
    </GlassModal>
  );
}

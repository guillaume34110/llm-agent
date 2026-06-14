import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ChoiceOption {
  value: string;
  label: string;
  hint?: string;
  group?: string;
}

interface Props {
  value: string;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  emptyText?: string;
  width?: number;
  popoverWidth?: number;
  popoverMaxHeight?: number;
  /** When true and options have group values, navigation is two-step (group -> option). */
  groupNavigation?: boolean;
  /** Direction the popover opens. Defaults to "down". */
  direction?: 'up' | 'down';
  /** Optional value to render as the topmost "auto / default" option. */
  autoLabel?: string;
}

export default function ChoicePicker({
  value,
  options,
  onChange,
  placeholder = 'Choisir',
  title,
  emptyText = 'Aucune option',
  width = 320,
  popoverWidth = 320,
  popoverMaxHeight = 320,
  groupNavigation = false,
  direction = 'down',
  autoLabel,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveGroup(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const groups = useMemo(() => {
    const map = new Map<string, ChoiceOption[]>();
    for (const opt of options) {
      const g = opt.group || '';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(opt);
    }
    return map;
  }, [options]);

  const selected = options.find(o => o.value === value);
  const showGroups = groupNavigation && groups.size > 1 && !Array.from(groups.keys()).every(k => k === '');

  const popoverPos: React.CSSProperties = direction === 'up'
    ? { bottom: 'calc(100% + 6px)' }
    : { top: 'calc(100% + 6px)' };

  return (
    <div ref={ref} style={{ position: 'relative', width }}>
      <button
        type="button"
        onClick={() => { setOpen(prev => !prev); setActiveGroup(null); }}
        title={title || selected?.value || placeholder}
        className="py-[7px] px-[10px] rounded-[var(--r)] text-[11.5px] cursor-pointer font-[Nunito] font-bold whitespace-nowrap w-full overflow-hidden text-ellipsis transition-all duration-150 flex items-center justify-between gap-1"
        style={{
          background: open ? 'var(--bg4)' : 'var(--bg3)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          color: open ? 'var(--accent)' : 'var(--text-muted)',
        }}
      >
        <span className="overflow-hidden text-ellipsis flex-1 text-left">
          {selected ? selected.label : (value === '' && autoLabel) ? autoLabel : placeholder}
        </span>
        <span className="flex-shrink-0">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute left-0 rounded-[var(--rm)] border border-[var(--border)] bg-[var(--bg3)] z-[100] overflow-y-auto" style={{
          ...popoverPos,
          width: popoverWidth,
          maxHeight: popoverMaxHeight,
          boxShadow: 'var(--shadow-strong)',
          scrollbarWidth: 'thin',
        }}>
          {options.length === 0 && (
            <div className="px-[14px] py-3 text-[12px] text-[var(--text-dim)]">{emptyText || t('choicePicker.empty')}</div>
          )}

          {/* Optional "auto" entry */}
          {autoLabel && (!showGroups || activeGroup === null) && (
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange(''); setOpen(false); setActiveGroup(null); }}
              className="w-full text-left py-2 px-3 border-b border-[var(--border)] cursor-pointer font-[Nunito] font-bold text-[12.5px]"
              style={{
                background: value === '' ? 'var(--accent-soft)' : 'transparent',
                color: value === '' ? 'var(--accent)' : 'var(--text-muted)',
                borderLeft: value === '' ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {autoLabel}
            </button>
          )}

          {/* Step 1: groups list */}
          {showGroups && activeGroup === null && (
            <>
              {[...groups.entries()].map(([group, items]) => {
                if (!group) return null;
                const hasSelected = items.some(it => it.value === value);
                return (
                  <button
                    key={group}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setActiveGroup(group); }}
                    className="w-full text-left py-[9px] px-3 flex items-center justify-between border-b border-[var(--border)] cursor-pointer font-[Nunito]"
                    style={{
                      background: hasSelected ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                    }}
                  >
                    <span className="text-[12.5px] font-bold" style={{ color: hasSelected ? 'var(--accent)' : 'var(--text)' }}>
                      {group}
                    </span>
                    <span className="text-[10.5px] text-[var(--text-dim)] flex items-center gap-1">
                      <span style={{ opacity: 0.6 }}>{items.length}</span>
                      <span>›</span>
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {/* Step 2 (group selected) OR flat list */}
          {(!showGroups || activeGroup !== null) && (
            <>
              {showGroups && activeGroup !== null && (
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setActiveGroup(null); }}
                  className="w-full text-left py-2 px-3 flex items-center gap-[6px] border-b border-[var(--border)] cursor-pointer font-[Nunito] text-[var(--accent)] font-bold text-[12px]"
                >
                  <span>‹</span>
                  <span className="text-[11px] tracking-[0.05em] uppercase">{activeGroup}</span>
                </button>
              )}
              {(showGroups
                ? (groups.get(activeGroup as string) || [])
                : options
              ).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange(opt.value); setOpen(false); setActiveGroup(null); }}
                  className="w-full text-left py-2 px-3 flex items-center justify-between cursor-pointer font-[Nunito] font-semibold text-[12.5px] transition-colors duration-100"
                  style={{
                    background: opt.value === value ? 'var(--accent-soft)' : 'transparent',
                    color: opt.value === value ? 'var(--accent)' : 'var(--text-muted)',
                    borderLeft: opt.value === value ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">
                    {opt.label}
                  </span>
                  {opt.hint && (
                    <span className="text-[10px] text-[var(--text-dim)] flex-shrink-0 ml-[6px]">
                      {opt.hint}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

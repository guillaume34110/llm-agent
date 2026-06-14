import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  Settings as SettingsIcon, Sun, Moon, Sparkles, LogOut,
} from 'lucide-react';
import AnimalAvatar from './AnimalAvatar';
import ActivityTicker from './ActivityTicker';
import LocalRuntimeToggle from './LocalRuntimeToggle';
import { getCurrentAnimal, subscribe as subscribeAnimal } from '../animals/animal-service';
import { getPreferences, subscribePreferences, updatePreferences } from '../preferences/preferences-service';
import { api } from '../api';
import type { ModelInfo } from '../types';
import { resolveModelIdAlias } from '../models/model-id-alias';

import type { AgentView } from '../types';

interface Props {
  title: string;
  sidecarReady: boolean;
  view: AgentView;
  onViewChange: (view: AgentView) => void;
  onOpenPalette?: () => void;
  onOpenCosmetics?: () => void;
  onSignOut?: () => void;
  runtimeStatus?: string;
}

function useCurrentAnimalName(): string {
  const [name, setName] = useState(() => getCurrentAnimal().displayName);
  useEffect(() => {
    const unsub = subscribeAnimal(a => setName(a.displayName));
    return () => { unsub(); };
  }, []);
  return name;
}

const win = (() => { try { return getCurrentWindow(); } catch { return null; } })();

export default function TopBar({
  title, sidecarReady, view, onViewChange, onOpenCosmetics, onSignOut, runtimeStatus = '',
}: Props) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => getPreferences().theme);
  useEffect(() => subscribePreferences(p => setTheme(p.theme)), []);
  const toggleTheme = () => updatePreferences({ theme: theme === 'dark' ? 'light' : 'dark' });

  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => { api.getModels().then(setModels).catch(() => {}); }, []);
  const prettyRuntimeStatus = (() => {
    if (!runtimeStatus) return '';
    if (!models.length) return runtimeStatus;
    const availableIds = models.map(m => m.id);
    const parts = runtimeStatus.split(' · ');
    const pretty = parts.map(part => {
      const trimmed = part.trim();
      const resolved = resolveModelIdAlias(trimmed, availableIds);
      const info = models.find(m => m.id === resolved);
      return info?.name || part;
    });
    return pretty.join(' · ');
  })();

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ right: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuPopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    const compute = () => {
      const btn = menuBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMenuPos({
        right: Math.round(window.innerWidth - r.right),
        top: Math.round(r.bottom + 6),
      });
    };
    compute();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (menuPopoverRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [menuOpen]);

  const animalName = useCurrentAnimalName();

  return (
    <div
      data-tauri-drag-region
      className="h-[48px] flex-shrink-0 flex items-center pl-4 pr-[36px] gap-2 select-none relative"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        borderBottom: '1px solid var(--glass-border)',
      }}
    >
      {/* Title block — animal name + optional context title */}
      <span className="font-black text-[14px] tracking-[-0.3px] text-[var(--text)]">{animalName}</span>
      {title && (
        <>
          <span className="text-[11px] text-[var(--text-dim)] opacity-60">·</span>
          <span className="text-[12px] text-[var(--text-muted)] font-medium overflow-hidden text-ellipsis whitespace-nowrap max-w-[260px]">
            {title}
          </span>
        </>
      )}

      <div className="flex-1" aria-hidden="true" />

      {/* Live activity / schedule visualizer — replaces the old search input */}
      <ActivityTicker />

      <div className="flex-1" aria-hidden="true" />

      {prettyRuntimeStatus && (
        <div
          className="hidden lg:flex items-center gap-1.5 px-2.5 h-[26px] rounded-full max-w-[260px]"
          style={{ background: 'var(--glass-bg-strong)', border: '1px solid var(--glass-border)' }}
          title={prettyRuntimeStatus}
        >
          <span className="text-[11px] font-bold text-[var(--text-muted)] overflow-hidden text-ellipsis whitespace-nowrap">
            {prettyRuntimeStatus}
          </span>
        </div>
      )}

      {/* Local-models on/off — shared component used in TopBar + ProviderHostingPanel */}
      <LocalRuntimeToggle size={42} />
      {/* Avatar menu */}
      <div ref={menuRef} className="relative">
        <button
          ref={menuBtnRef}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Open account menu"
          className="w-[30px] h-[30px] rounded-full cursor-pointer flex items-center justify-center transition-transform hover:scale-105"
          style={{ background: 'var(--glass-bg-strong)', border: '1px solid var(--glass-border)' }}
        >
          <AnimalAvatar size={22} />
        </button>
        {menuOpen && menuPos && createPortal(
          <div
            ref={menuPopoverRef}
            className="fixed w-[220px] z-[10002] glass-card-strong p-1 overflow-hidden"
            style={{ right: menuPos.right, top: menuPos.top }}
            onClick={() => setMenuOpen(false)}
          >
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--rm)] hover:bg-[var(--accent-soft)] text-left text-[12.5px] font-semibold text-[var(--text)] transition-colors"
            >
              {theme === 'dark' ? <Sun size={14} strokeWidth={2.4} /> : <Moon size={14} strokeWidth={2.4} />}
              {theme === 'dark' ? t('topBar.lightMode') : t('topBar.darkMode')}
            </button>
            {onOpenCosmetics && (
              <button
                onClick={onOpenCosmetics}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--rm)] hover:bg-[var(--accent-soft)] text-left text-[12.5px] font-semibold text-[var(--text)] transition-colors"
              >
                <Sparkles size={14} strokeWidth={2.4} />
                Cosmetics
              </button>
            )}
            <button
              onClick={() => onViewChange('settings')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--rm)] hover:bg-[var(--accent-soft)] text-left text-[12.5px] font-semibold transition-colors ${
                view === 'settings' ? 'text-[var(--accent)] bg-[var(--accent-soft)]' : 'text-[var(--text)]'
              }`}
            >
              <SettingsIcon size={14} strokeWidth={2.4} />
              {t('topBar.openSettings') || 'Settings'}
              <kbd className="ml-auto text-[10px] font-bold opacity-60">⌘,</kbd>
            </button>
            {onSignOut && (
              <>
                <div className="my-1 h-px bg-[var(--glass-border)]" />
                <button
                  onClick={onSignOut}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--rm)] hover:bg-[var(--red-soft)] text-left text-[12.5px] font-semibold text-[var(--red)] transition-colors"
                >
                  <LogOut size={14} strokeWidth={2.4} />
                  Sign out
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
      </div>

      {/* Window controls — must stack above CornerExpandButton (z=9999) */}
      <div className="flex items-center gap-1.5 ml-1 relative z-[10000]">
        <button onClick={() => win?.minimize()} aria-label={t('topBar.minimizeWindow')} className="w-3 h-3 rounded-full bg-[#f5a623] border-none cursor-pointer p-0 hover:opacity-80 transition-opacity" />
        <button onClick={() => win?.toggleMaximize()} aria-label={t('topBar.maximizeWindow')} className="w-3 h-3 rounded-full bg-[var(--accent)] border-none cursor-pointer p-0 hover:opacity-80 transition-opacity" />
        <button onClick={() => win?.close()} aria-label={t('topBar.closeWindow')} className="w-3 h-3 rounded-full bg-[var(--red)] border-none cursor-pointer p-0 hover:opacity-80 transition-opacity" />
      </div>
    </div>
  );
}

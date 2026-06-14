import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { api } from '../api';

interface Props {
  onWorkspaceChange?: (path: string) => void;
}

export default function WorkspaceBar({ onWorkspaceChange }: Props) {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState('');

  useEffect(() => {
    api.getWorkspace().then(async r => {
      setWorkspace(r.path);
      if (r.path) { try { await invoke('allow_fs_path', { path: r.path }); } catch {} }
    }).catch(() => {});
  }, []);

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: t('workspace.chooseFolderTitle') });
    if (!selected || typeof selected !== 'string') return;
    try {
      try { await invoke('allow_fs_path', { path: selected }); } catch {}
      const r = await api.setWorkspace(selected);
      setWorkspace(r.path);
      onWorkspaceChange?.(r.path);
    } catch {}
  };

  const short = workspace.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div
      className="shrink-0 px-4 py-[6px] flex items-center gap-2"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        WebkitBackdropFilter: 'var(--glass-blur)',
        borderBottom: '1px solid var(--glass-border)',
      }}
    >
      <span className="text-[10.5px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)] shrink-0">
        {t('workspace.context')}
      </span>
      <span className="flex-1 text-[11.5px] font-medium text-[var(--text)] overflow-hidden text-ellipsis whitespace-nowrap">
        {short || '…'}
      </span>
      <button
        onClick={pickFolder}
        title={t('workspace.changeFolderTitle')}
        className="shrink-0 px-2.5 h-[22px] rounded-full text-[10.5px] font-black bg-[var(--glass-bg-strong)] border border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
      >
        {t('workspace.change')}
      </button>
    </div>
  );
}

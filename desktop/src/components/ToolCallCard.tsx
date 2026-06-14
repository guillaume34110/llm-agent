import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolCall } from '../types';

const SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL || 'http://localhost:3471';

type ImageProgress = {
  stage: string;
  step?: number;
  total?: number;
  its?: number;
  elapsed?: number;
  width?: number;
  height?: number;
  steps?: number;
};

function fmtImageProgress(p: ImageProgress): string {
  const elapsed = typeof p.elapsed === 'number' ? `${p.elapsed.toFixed(0)}s` : '';
  if (p.stage === 'sampling' && p.step && p.total) {
    const its = p.its ? ` • ${p.its.toFixed(1)}s/it` : '';
    return `step ${p.step}/${p.total}${its} • ${elapsed}`;
  }
  if (p.stage === 'loading') return `loading weights • ${elapsed}`;
  if (p.stage === 'loaded') return `weights loaded • ${elapsed}`;
  if (p.stage === 'decoding') return `decoding • ${elapsed}`;
  if (p.stage === 'saving') return `saving • ${elapsed}`;
  return `${p.stage} • ${elapsed}`;
}

function extractImagePath(output: string): string | null {
  const match = output.match(/→\s*(.+\.(png|jpg|jpeg|webp))/i);
  return match ? match[1].trim() : null;
}

function ToolCallCardImpl({ tool, defaultOpen = false }: { tool: ToolCall; defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [imgProgress, setImgProgress] = useState<ImageProgress | null>(null);

  useEffect(() => {
    if (tool.name !== 'generate_image' || tool.output) {
      setImgProgress(null);
      return;
    }
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`${SIDECAR_URL}/local-image/progress`);
        if (!cancelled && r.ok) setImgProgress(await r.json());
      } catch {}
    }, 800);
    return () => { cancelled = true; clearInterval(id); };
  }, [tool.name, tool.output]);

  const TOOL_META: Record<string, { icon: string; label: string; previewKey?: string }> = {
    search_web:       { icon: '🔍', label: t('toolCall.searchWeb'),        previewKey: 'query' },
    fetch_page:       { icon: '🌐', label: t('toolCall.fetchPage'),         previewKey: 'url' },
    browser_navigate: { icon: '🧭', label: t('toolCall.navigate'),       previewKey: 'url' },
    read_file:        { icon: '📄', label: t('toolCall.readFile'),       previewKey: 'path' },
    write_file:       { icon: '✏️', label: t('toolCall.writeFile'),    previewKey: 'path' },
    list_dir:         { icon: '📁', label: t('toolCall.listDir'),  previewKey: 'path' },
    list_dir_images:  { icon: '🖼', label: t('toolCall.listDirImages'), previewKey: 'path' },
    run_command:      { icon: '⚡', label: t('toolCall.command'),         previewKey: 'command' },
    remember_fact:    { icon: '🧠', label: t('toolCall.memorized'),         previewKey: 'key' },
    generate_image:   { icon: '🖼', label: t('toolCall.generateImage'),    previewKey: 'prompt' },
  };

  const meta = TOOL_META[tool.name] || { icon: '🔧', label: tool.name };
  const icon = meta.icon;
  const label = meta.label;
  const previewVal = meta.previewKey && tool.args?.[meta.previewKey]
    ? String(tool.args[meta.previewKey]).slice(0, 60)
    : '';
  const argsStr = typeof tool.args === 'string'
    ? tool.args
    : JSON.stringify(tool.args, null, 2);

  const imagePath = tool.name === 'generate_image' && tool.output ? extractImagePath(tool.output) : null;
  const imageUrl = imagePath ? `${SIDECAR_URL}/file?path=${encodeURIComponent(imagePath)}` : null;

  return (
    <div className="tool-card" style={{ maxWidth: imagePath ? '80%' : '70%' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="tool-card__head"
      >
        <span className="text-[13px]">{icon}</span>
        <span className="font-[700] text-[var(--text)] text-[12px]">{label}</span>
        {previewVal && <span className="text-[var(--text-dim)] overflow-hidden text-ellipsis whitespace-nowrap max-w-[180px] text-[11.5px]">{previewVal}</span>}
        {!tool.output && <span className="text-[10px] text-[var(--accent-2)] ml-[2px]">●</span>}
        {!tool.output && tool.name === 'generate_image' && imgProgress && (
          <span className="text-[10.5px] text-[var(--accent-2)] ml-[4px] overflow-hidden text-ellipsis whitespace-nowrap max-w-[220px]">
            {fmtImageProgress(imgProgress)}
          </span>
        )}
        <span className="text-[var(--text-dim)] ml-[2px] text-[10px]">{open ? '▾' : '▸'}</span>
      </button>
      {imageUrl && (
        <div className="mt-[6px] relative inline-block max-w-full">
          <img
            src={imageUrl}
            alt={tool.args?.prompt || 'AI-generated image'}
            className="max-w-full rounded-[var(--rm)] border border-[var(--border)] block"
          />
          {/* EU AI Act Art. 50(2) — visible synthetic-content marking. */}
          <span
            aria-label="AI-generated image"
            title="AI-generated — EU AI Act Art. 50(2)"
            className="absolute top-[6px] left-[6px] px-[6px] py-[2px] rounded-[4px] bg-[rgba(0,0,0,0.65)] text-[#fff] text-[10px] font-[700] tracking-[0.5px] pointer-events-none"
          >AI</span>
        </div>
      )}
      {open && (
        <div className="tool-card__body">
          {argsStr && (
            <div className="tool-card__section">
              <p className="tool-card__label">Args</p>
              <pre className="tool-card__pre tool-card__args">{argsStr}</pre>
            </div>
          )}
          {!imageUrl && (
            <div className="tool-card__section relative" style={{ maxHeight: 180, overflowY: 'auto' }}>
              <p className="tool-card__label">{t('toolCall.result')}</p>
              {tool.output && (
                <button
                  type="button"
                  className="tool-card__copy absolute top-[4px] right-[4px] border-none bg-[var(--bg2)] text-[var(--text-dim)] px-[6px] py-[2px] rounded-[6px] text-[10px] font-[700] cursor-pointer font-Nunito z-[1]"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try { await navigator.clipboard.writeText(tool.output || ''); } catch {}
                  }}
                  title={t('toolCall.copyResult')}
                  aria-label={t('toolCall.copyResult')}
                >⧉</button>
              )}
              <pre className="tool-card__pre tool-card__result">{tool.output || t('toolCall.empty')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ToolCallCard = React.memo(ToolCallCardImpl, (a, b) => (
  a.tool.name === b.tool.name &&
  a.tool.output === b.tool.output &&
  a.defaultOpen === b.defaultOpen &&
  JSON.stringify(a.tool.args) === JSON.stringify(b.tool.args)
));
export default ToolCallCard;

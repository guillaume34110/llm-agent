import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TERMS_OF_SERVICE, PRIVACY_POLICY, LEGAL_VERSION } from '../compliance/legal-text';

type Tab = 'tos' | 'privacy' | null;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Safe inline rendering for **bold** and _italic_ (static content only, but avoid innerHTML).
  const out: React.ReactNode[] = [];
  let i = 0;
  let buf = '';
  let k = 0;
  const push = (n: React.ReactNode) => { out.push(<React.Fragment key={`${keyPrefix}-${k++}`}>{n}</React.Fragment>); };
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > 0) {
        if (buf) { push(buf); buf = ''; }
        push(<b>{text.slice(i + 2, end)}</b>);
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '_') {
      const end = text.indexOf('_', i + 1);
      if (end > 0) {
        if (buf) { push(buf); buf = ''; }
        push(<i>{text.slice(i + 1, end)}</i>);
        i = end + 1;
        continue;
      }
    }
    buf += text[i++];
  }
  if (buf) push(buf);
  return out;
}

function renderMarkdown(src: string): React.ReactNode[] {
  const lines = src.split('\n');
  const nodes: React.ReactNode[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const text = para.join(' ');
    nodes.push(
      <p key={nodes.length} className="my-2 leading-[1.6] text-[12.5px] text-[var(--text)]">
        {renderInline(text, `p${nodes.length}`)}
      </p>
    );
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) {
      flush();
      nodes.push(<h3 key={nodes.length} className="mt-[18px] mb-1.5 text-[13.5px] font-[800] text-[var(--text)]">{line.slice(3)}</h3>);
    } else if (line.startsWith('# ')) {
      flush();
      nodes.push(<h2 key={nodes.length} className="mt-1.5 mb-2 text-[16px] font-[900] text-[var(--text)]">{line.slice(2)}</h2>);
    } else if (line.startsWith('- ')) {
      flush();
      nodes.push(
        <li key={nodes.length} className="ml-4 text-[12.5px] text-[var(--text)] leading-[1.6]">
          {renderInline(line.slice(2), `li${nodes.length}`)}
        </li>
      );
    } else {
      para.push(line);
    }
  }
  flush();
  return nodes;
}

export default function LegalPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(null);
  const content = tab === 'tos' ? TERMS_OF_SERVICE : tab === 'privacy' ? PRIVACY_POLICY : null;

  return (
    <div className="p-4 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg2)]">
      <div className="text-[14px] font-[800] text-[var(--text)]">{t('legal.title')}</div>
      <div className="mt-1 text-[11px] text-[var(--text-dim)]">{t('legal.version', { version: LEGAL_VERSION })}</div>

      <div className="mt-[10px] flex gap-2">
        <button
          type="button"
          onClick={() => setTab(tab === 'tos' ? null : 'tos')}
          className={`px-[10px] py-1.5 border border-[var(--border)] rounded-2 text-[var(--text)] cursor-pointer text-[11.5px] font-[700] ${tab === 'tos' ? 'bg-[var(--accent-2)]' : 'bg-[var(--bg3)]'}`}
        >{t('legal.termsOfService')}</button>
        <button
          type="button"
          onClick={() => setTab(tab === 'privacy' ? null : 'privacy')}
          className={`px-[10px] py-1.5 border border-[var(--border)] rounded-2 text-[var(--text)] cursor-pointer text-[11.5px] font-[700] ${tab === 'privacy' ? 'bg-[var(--accent-2)]' : 'bg-[var(--bg3)]'}`}
        >{t('legal.privacyPolicy')}</button>
      </div>

      {content && (
        <div className="mt-3 p-3 bg-[var(--bg3)] rounded-2 max-h-[360px] overflow-y-auto border border-[var(--border)]">
          {renderMarkdown(content)}
        </div>
      )}
    </div>
  );
}

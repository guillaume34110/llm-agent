import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../types';
import { getWorkspacePath, getWorkspacePathSync, resolveImageSrc } from '../utils/workspace';
import { getCurrentAnimal, subscribe as subscribeAnimal } from '../animals/animal-service';
import RichBlockFromCode from './RichBlock';

function AgentImage({ src, alt }: { src?: string; alt?: string }) {
  const [resolved, setResolved] = useState<string>(() => resolveImageSrc(src || ''));
  useEffect(() => {
    if (!src) return;
    if (!getWorkspacePathSync()) {
      getWorkspacePath().then(() => setResolved(resolveImageSrc(src)));
    } else {
      setResolved(resolveImageSrc(src));
    }
  }, [src]);
  if (!src) return null;
  return (
    <img
      src={resolved}
      alt={alt || ''}
      className="max-w-full max-h-[360px] rounded-[10px] border border-[var(--border)] block my-1.5 object-contain bg-[var(--bg)]"
      loading="lazy"
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.4'; }}
    />
  );
}

const md: React.CSSProperties = {
  fontSize: 13.5, lineHeight: 1.7, fontWeight: 500,
};

function usePolychrome(): boolean {
  const [poly, setPoly] = useState<boolean>(() => {
    const a = getCurrentAnimal();
    return a.hue2 != null && a.hue2 !== a.hue;
  });
  useEffect(() => subscribeAnimal(a => setPoly(a.hue2 != null && a.hue2 !== a.hue)), []);
  return poly;
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      title={t('chat.copy')}
      aria-label={t('chat.copyMessage')}
      className="chat-bubble__copy absolute top-1.5 right-1.5 border-none bg-[var(--bg2)] rounded-[6px] px-1.5 py-[3px] text-[10.5px] font-bold cursor-pointer font-nunito"
      style={{
        opacity: copied ? 1 : 0,
        transition: 'opacity 0.15s',
        color: copied ? 'var(--accent)' : 'var(--text-dim)',
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

export default function MessageBubble({ msg }: { msg: Message }) {
  const { t } = useTranslation();
  const isUser = msg.role === 'user';
  const polychrome = usePolychrome();
  const className = `chat-bubble ${isUser ? 'chat-bubble--user' : 'chat-bubble--agent'}`;
  return (
    <div
      className={`${className} relative`}
      data-polychrome={!isUser && polychrome ? 'true' : undefined}
    >
      {!isUser && msg.content && <CopyButton text={msg.content} />}
      {msg.attachments && msg.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2" style={{ marginBottom: msg.content ? 10 : 0 }}>
          {msg.attachments.map(attachment => (
            <div
              key={attachment.id}
              className="flex items-center gap-1.5 rounded-full px-2.25 py-[5px] text-[11.5px]"
              style={{
                border: `1px solid ${isUser ? 'rgba(255,255,255,0.18)' : 'var(--border)'}`,
                background: isUser ? 'rgba(255,255,255,0.08)' : 'var(--bg2)',
                color: isUser ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)',
              }}
            >
              <span className="font-bold">{attachment.name}</span>
              <span style={{ opacity: 0.72 }}>{attachment.kind}</span>
            </div>
          ))}
        </div>
      )}
      {isUser ? msg.content : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => <p className="text-[13.5px] leading-[1.7] font-medium mb-2">{children}</p>,
            h1: ({ children }) => <h1 className="text-[17px] font-bold my-1.5 text-[var(--text)]">{children}</h1>,
            h2: ({ children }) => <h2 className="text-[15px] font-bold my-1.25 text-[var(--text)]">{children}</h2>,
            h3: ({ children }) => <h3 className="text-[13.5px] font-bold my-1 text-[var(--text-muted)]">{children}</h3>,
            ul: ({ children }) => <ul className="pl-[18px] my-1">{children}</ul>,
            ol: ({ children }) => <ol className="pl-[18px] my-1">{children}</ol>,
            li: ({ children }) => <li className="text-[13.5px] leading-[1.7] font-medium my-0.5">{children}</li>,
            strong: ({ children }) => <strong className="font-bold text-[var(--text)]">{children}</strong>,
            em: ({ children }) => <em className="text-[var(--text-muted)]">{children}</em>,
            code: ({ inline, className, children }: any) => {
              if (inline) {
                return <code className="bg-[var(--bg2)] border border-[var(--border-2nd,var(--border))] rounded px-[5px] py-[1px] text-[12px] text-[var(--accent-2)]">{children}</code>;
              }
              const m = String(className || '').match(/language-(\w+)/);
              const lang = m ? m[1] : '';
              if (lang === 'rich') {
                const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
                return <RichBlockFromCode raw={raw} />;
              }
              return <pre className="bg-[var(--bg2)] border border-[var(--border-2nd,var(--border))] rounded-[8px] p-3 overflow-x-auto my-1.5"><code className="text-[12px] text-[var(--accent-2)] whitespace-pre">{children}</code></pre>;
            },
            table: ({ children }) => <div className="overflow-x-auto my-2"><table className="border-collapse w-full text-[12.5px]">{children}</table></div>,
            th: ({ children }) => <th className="bg-[var(--bg2)] border border-[var(--border)] px-2.5 py-1.5 font-bold text-left text-[var(--text-muted)]">{children}</th>,
            td: ({ children }) => <td className="border border-[var(--border)] px-2.5 py-1.5 text-[var(--text)]">{children}</td>,
            blockquote: ({ children }) => <blockquote className="border-l-[3px] border-[var(--accent-3)] pl-3 my-1.5 text-[var(--text-muted)] italic">{children}</blockquote>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-[var(--accent-2)] underline">{children}</a>,
            hr: () => <hr className="border-none border-t border-[var(--border)] my-2.5" />,
            img: ({ src, alt }: any) => <AgentImage src={src} alt={alt} />,
          }}
        >
          {msg.content}
        </ReactMarkdown>
      )}
    </div>
  );
}

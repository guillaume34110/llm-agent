import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message, AgentPlan } from '../types';
import MessageBubble from './MessageBubble';
import ToolCallCard from './ToolCallCard';
import AnimalAvatar from './AnimalAvatar';
import TerminalLog from './TerminalLog';
import ApprovalInline from './ApprovalInline';
import { formatCostBadge } from '../agent/pricing';
import { shareConversation } from '../social/social-client';
import { Globe } from 'lucide-react';
import { getLocale, subscribeLocale, type Locale } from '../i18n/i18n';
import { updatePreferences } from '../preferences/preferences-service';

const WELCOME_LOCALES: Array<[Locale, string]> = [
  ['fr', 'Français'], ['en', 'English'],
];

// Language picker shown on the empty/welcome screen so a first-time user can set
// their language without diving into Settings. Writing the pref globally retunes
// i18next + every subscriber (preferences-service initI18nLocale).
function WelcomeLanguagePicker() {
  const [locale, setLoc] = useState<Locale>(() => getLocale());
  useEffect(() => subscribeLocale(() => setLoc(getLocale())), []);
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] font-[Nunito] font-semibold cursor-pointer">
      <Globe size={14} className="opacity-70" />
      <select
        value={locale}
        onChange={e => updatePreferences({ locale: e.target.value as Locale })}
        className="bg-[var(--bg2)] border border-[var(--border)] rounded-[var(--r)] px-2 py-[5px] text-[12px] text-[var(--text)] font-[Nunito] font-semibold cursor-pointer outline-none focus:border-[var(--accent)]"
      >
        {WELCOME_LOCALES.map(([code, label]) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
    </label>
  );
}

function ShareButton({ messages }: { messages: Message[] }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true); setErr(null); setDone(null);
    try {
      const payload = messages.map(m => ({ role: m.role, content: m.content, createdAt: (m as any).createdAt }));
      const { url } = await shareConversation(payload);
      await navigator.clipboard.writeText(url);
      setDone('Link copied');
      setTimeout(() => setDone(null), 2500);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setTimeout(() => setErr(null), 4000);
    } finally { setBusy(false); }
  };
  return (
    <div className="sticky top-1 self-end z-2 flex items-center gap-2">
      {err && <span className="text-[10.5px] text-[var(--red,#e55)] font-[Nunito]">{err}</span>}
      {done && <span className="text-[10.5px] text-[var(--accent)] font-[Nunito]">{done}</span>}
      <button
        onClick={onClick}
        disabled={busy || messages.length === 0}
        className="px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg2)] text-[var(--text-muted)] text-[10.5px] font-bold cursor-pointer font-[Nunito] hover:text-[var(--accent)]"
        title="Encrypt this conversation and copy a shareable link. The decryption key lives in the URL fragment — the server never sees it."
      >{busy ? 'Sharing…' : 'Share'}</button>
    </div>
  );
}

function PlanCard({ steps, current, done }: { steps: string[]; current: number; done: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <style>{`
        @keyframes plan-dot-pulse {
          0%   { box-shadow: 0 0 0 0   color-mix(in srgb, var(--blue) 55%, transparent); }
          60%  { box-shadow: 0 0 0 5px color-mix(in srgb, var(--blue) 0%,  transparent); }
          100% { box-shadow: 0 0 0 0   color-mix(in srgb, var(--blue) 0%,  transparent); }
        }
        @keyframes plan-dot-complete {
          0%   { transform: scale(1);   box-shadow: 0 0 0 0   color-mix(in srgb, var(--accent) 60%, transparent); }
          40%  { transform: scale(1.35); box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%,  transparent); }
          100% { transform: scale(1);   box-shadow: none; }
        }
        @keyframes plan-row-enter {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
      <div className="plan-card">
        <div className="plan-card__title">
          {t('chat.plan')} — {steps.length} {t('chat.steps')}
        </div>
        <div className="flex flex-col gap-0">
          {steps.map((step, i) => {
            const isActive    = !done && i === current;
            const isCompleted = done ? i <= current : i < current;
            const dotColor    = isCompleted ? 'var(--accent)' : isActive ? 'var(--blue)' : 'var(--plan-dot-pending)';
            const textColor   = isCompleted ? 'var(--text-muted)' : isActive ? 'var(--text)' : 'var(--text-muted)';
            const lineColor   = isCompleted ? 'var(--accent)' : 'var(--plan-line-pending)';
            return (
              <div
                key={i}
                style={{
                  animation: isActive ? 'plan-row-enter 0.25s ease-out' : 'none',
                }}
                className="flex items-stretch gap-[10px]"
              >
                {/* Timeline dot + line */}
                <div className="flex flex-col items-center w-[14px] flex-shrink-0">
                  <div style={{
                    width: isActive ? 10 : 8,
                    height: isActive ? 10 : 8,
                    borderRadius: '50%',
                    border: `2px solid ${dotColor}`,
                    background: isCompleted ? dotColor : isActive ? 'var(--blue)' : 'transparent',
                    flexShrink: 0,
                    marginTop: isActive ? 3 : 4,
                    transition: 'all 0.35s cubic-bezier(.4,0,.2,1)',
                    animation: isActive
                      ? 'plan-dot-pulse 1.4s ease-out infinite'
                      : isCompleted
                        ? 'plan-dot-complete 0.5s ease-out forwards'
                        : 'none',
                  }} />
                  {i < steps.length - 1 && (
                    <div style={{
                      width: 2, flex: 1,
                      background: lineColor,
                      margin: '2px 0', minHeight: 8,
                      transition: 'background 0.4s ease',
                    }} />
                  )}
                </div>

                {/* Step text */}
                <div style={{
                  paddingBottom: i < steps.length - 1 ? 8 : 2,
                  paddingTop: 1,
                }}
                className="flex items-center gap-[5px]">
                  {isCompleted && (
                    <span className="text-[9px] font-black bg-[var(--accent-soft)] border border-[var(--accent-glow)] rounded-full px-[5px] py-[1px] flex-shrink-0 inline-block" style={{
                      color: 'var(--accent)',
                      animation: 'plan-dot-complete 0.4s ease-out',
                    }}>✓</span>
                  )}
                  {isActive && (
                    <span className="w-[6px] h-[6px] rounded-full bg-[var(--blue)] flex-shrink-0 inline-block" style={{
                      animation: 'plan-dot-pulse 1.4s ease-out infinite',
                    }} />
                  )}
                  <span style={{
                    fontSize: 12.5,
                    fontWeight: isActive ? 800 : isCompleted ? 500 : 600,
                    color: textColor,
                    transition: 'color 0.35s ease, font-weight 0.2s ease',
                    textDecoration: isCompleted ? 'none' : 'none',
                    opacity: (!done && !isActive && !isCompleted) ? 0.65 : 1,
                  }}>
                    {step}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

const SUGGESTION_KEYS = [
  'chat.suggestionAINews',
  'chat.suggestionReadFile',
  'chat.suggestionWriteScript',
  'chat.suggestionBrowseWeb',
];

interface Props {
  messages: Message[];
  loading: boolean;
  liveTools?: import('../types').ToolCall[];
  loadingLabel?: string;
  onSuggestion: (text: string) => void;
  plan?: AgentPlan | null;
  compact?: boolean;
}

export default function ChatFeed({ messages, loading, liveTools = [], loadingLabel = '', onSuggestion, plan, compact = false }: Props) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const planCardRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const planStepsKey = plan?.steps.join('|') ?? '';

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(near);
    if (near) setHasNew(false);
  };

  // Auto-scroll only if user near bottom; otherwise raise "new message" flag
  useEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setHasNew(true);
    }
  }, [messages, loading]);

  // Scroll to plan card when a new plan first appears
  useEffect(() => {
    if (planStepsKey && planCardRef.current) {
      planCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [planStepsKey]);

  // Keep the live agent-state bubble visible while loading — only when user is at bottom
  const liveSig = liveTools.map(t => t.name + (t.output ? '1' : '0')).join(',') + '|' + loadingLabel;
  useEffect(() => {
    if (loading && atBottom && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [loading, liveSig, atBottom]);

  if (messages.length === 0 && compact) return null;
  if (messages.length === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8 bg-[var(--bg)] relative isolate overflow-hidden">
      <div className="flex flex-col items-center relative z-10">
        <div className="opacity-[0.18] mb-4 flex items-center justify-center w-[88px] h-[88px] cute-breathe">
          <AnimalAvatar size={72} />
        </div>
        <h2 className="text-[16px] font-bold text-[var(--text)] tracking-[-0.3px] mb-1.5">{t('chat.whatCanIDo')}</h2>
        <p className="text-[13px] text-[var(--text-muted)] font-medium">{t('chat.description')}</p>
        {/* EU AI Act Article 50(1) — disclose at first interaction that the user is talking to an AI. */}
        <p className="text-[11px] text-[var(--text-muted)] font-medium mt-2.5 opacity-70">
          {t('chat.aiDisclosure')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 w-full max-w-[360px] relative z-10">
        {SUGGESTION_KEYS.map((key, i) => {
          const accents = ['var(--accent)', 'var(--accent-2)', 'var(--accent)', 'var(--accent-2)'];
          const bgs = ['var(--bg3)', 'var(--bg2-alt)', 'var(--bg3)', 'var(--bg2-alt)'];
          const borders = ['var(--border)', 'var(--border-2nd)', 'var(--border)', 'var(--border-2nd)'];
          const hoverColor = accents[i % accents.length];
          const suggestion = t(key);
          return (
            <button
              key={key}
              onClick={() => onSuggestion(suggestion)}
              style={{
                background: bgs[i % bgs.length], border: `1px solid ${borders[i % borders.length]}`,
              }}
              onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = hoverColor; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
              onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = borders[i % borders.length]; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
              className="text-[12px] text-[var(--text-muted)] text-left font-[Nunito] font-semibold transition-all duration-150 cursor-pointer px-[12px] py-[10px] rounded-[var(--r)]"
            >{suggestion}</button>
          );
        })}
      </div>
      <div className="relative z-10 mt-1">
        <WelcomeLanguagePicker />
      </div>
    </div>
  );

  return (
    <div ref={scrollRef} onScroll={handleScroll} style={{ flex: compact ? 'none' : 1, overflowY: compact ? 'visible' : 'auto', padding: compact ? '8px 12px' : '20px 24px', gap: compact ? 8 : 16 }} className="flex flex-col bg-[var(--bg)] relative gap-[16px]">
      {!compact && messages.length > 0 && <ShareButton messages={messages} />}
      {!atBottom && hasNew && (
        <button
          onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setHasNew(false); }}
          className="sticky bottom-2 self-center z-2 px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg2)] text-[var(--accent)] text-[11.5px] font-bold cursor-pointer font-[Nunito] shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
        >↓ {t('chat.newMessage')}</button>
      )}
      {messages.map(msg => (
        <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
          {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
            <div className="w-full flex flex-col gap-1">
              {msg.toolCalls.map((t, i) => <ToolCallCard key={i} tool={t} />)}
            </div>
          )}
          {msg.planSteps && msg.planSteps.length > 0 && (() => {
            const isActivePlan = loading && plan?.steps.join('') === msg.planSteps.join('');
            const current = isActivePlan ? (plan?.current ?? 0) : msg.planSteps.length - 1;
            const done = !isActivePlan;
            return (
              <div ref={isActivePlan ? planCardRef : undefined}>
                <PlanCard steps={msg.planSteps} current={current} done={done} />
              </div>
            );
          })()}
          {msg.content && <MessageBubble msg={msg} />}
          {msg.role === 'assistant' && msg.usageTokens && (msg.usageTokens.prompt + msg.usageTokens.completion > 0) && (
            <div className="text-[10.5px] text-[var(--text-muted)] opacity-65 font-[Nunito] font-semibold px-[4px] tracking-[0.2px]">
              {msg.usageTokens.prompt + msg.usageTokens.completion} tokens
              {typeof msg.costCents === 'number' && msg.costCents > 0 ? ` · ${formatCostBadge(msg.costCents)}` : ''}
            </div>
          )}
        </div>
      ))}
      {loading && <div ref={terminalRef} className="self-start max-w-full"><TerminalLog liveTools={liveTools} loadingLabel={loadingLabel} /></div>}
      <ApprovalInline />
      <div ref={bottomRef} />
    </div>
  );
}

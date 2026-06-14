import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentPlan, StepStatus, DoDResult } from '../types';

const SIDECAR_URL = (import.meta.env.VITE_SIDECAR_URL || 'http://localhost:3471').replace(/\/$/, '');

interface Props {
  plan: AgentPlan | null;
  loading: boolean;
}

function statusStyle(status: StepStatus, isActive: boolean) {
  switch (status) {
    case 'done':
      return { dotColor: 'var(--accent)', dotFill: 'var(--accent)', textColor: 'var(--text-muted)', icon: '✓', iconColor: 'var(--accent)' };
    case 'failed':
      return { dotColor: 'var(--red, #e74c3c)', dotFill: 'var(--red, #e74c3c)', textColor: 'var(--text)', icon: '✗', iconColor: 'var(--red, #e74c3c)' };
    case 'verifying':
      return { dotColor: 'var(--orange, #f39c12)', dotFill: 'transparent', textColor: 'var(--text)', icon: '⟳', iconColor: 'var(--orange, #f39c12)' };
    case 'running':
      return { dotColor: 'var(--blue)', dotFill: 'transparent', textColor: 'var(--text)', icon: null as string | null, iconColor: null as string | null };
    case 'skipped':
      return { dotColor: 'var(--text-dim)', dotFill: 'transparent', textColor: 'var(--text-dim)', icon: '⊘', iconColor: 'var(--text-dim)' };
    case 'pending':
    default:
      return { dotColor: 'var(--border)', dotFill: 'transparent', textColor: 'var(--text-dim)', icon: null as string | null, iconColor: null as string | null };
  }
  // suppress unused warn
  void isActive;
}

function screenshotUrl(path: string): string {
  return `${SIDECAR_URL}/file?path=${encodeURIComponent(path)}`;
}

function DoDDrawer({ results }: { results: DoDResult[] }) {
  const { t } = useTranslation();
  if (!results || results.length === 0) {
    return (
      <div className="text-[11px] text-[var(--text-dim)] italic p-[4px]">
        {t('plan.noResults')}
      </div>
    );
  }
  return (
    <>
      {results.map((r, j) => (
        <div
          key={j}
          style={{
            fontSize: 11,
            padding: 6,
            background: r.ok ? 'var(--accent-soft)' : 'var(--red-soft)',
            borderLeft: `2px solid ${r.ok ? 'var(--accent)' : 'var(--red,#e74c3c)'}`,
            marginTop: 4,
            borderRadius: 2,
          }}
        >
          <div className="font-semibold">
            {r.ok ? '✓' : '✗'} {r.checkType}
            {typeof r.durationMs === 'number' && (
              <span className="font-normal text-[var(--text-dim)] ml-[6px]">
                ({r.durationMs}ms)
              </span>
            )}
          </div>
          {r.detail && <div className="text-[var(--text-dim)] mt-[2px]">{r.detail}</div>}
          {r.cmd && (
            <code className="text-[10px] opacity-80 block mt-[2px]">
              $ {r.cmd}
            </code>
          )}
          {r.stdout && (
            <pre className="text-[10px] max-h-[100px] overflow-auto mt-[4px] whitespace-pre-wrap bg-[var(--bg)] p-[4px] rounded-[2px]">
              {r.stdout}
            </pre>
          )}
          {typeof r.exitCode === 'number' && (
            <div className="text-[10px] text-[var(--text-dim)] mt-[2px]">
              exit: {r.exitCode}
            </div>
          )}
          {r.screenshotPath && (
            <img
              src={screenshotUrl(r.screenshotPath)}
              alt=""
              className="max-w-[200px] mt-[4px] border border-[var(--border)] rounded-[2px]"
            />
          )}
        </div>
      ))}
    </>
  );
}

export default function PlanPanel({ plan, loading }: Props) {
  const { t } = useTranslation();
  const activeRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (plan) setDismissed(false);
  }, [plan?.steps.join('|')]);

  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [plan?.current]);

  if (!plan || plan.steps.length === 0 || dismissed) return null;

  const isDone = !loading;
  const statuses = plan.statuses || [];
  const incomplete = !!plan.incomplete;
  const failedCount = statuses.filter(s => s === 'failed').length;
  const doneCount = statuses.filter(s => s === 'done').length;
  const dismissAllowed = isDone && !incomplete;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg2)] px-[20px] py-[10px] flex-shrink-0">
      <div className="flex items-center justify-between mb-[8px]">
        <div className="text-[10px] font-bold text-[var(--text-dim)] tracking-[0.08em] uppercase">
          {t('plan.title')}
        </div>
        {isDone && (
          <button
            onClick={() => dismissAllowed && setDismissed(true)}
            disabled={!dismissAllowed}
            style={{
              cursor: dismissAllowed ? 'pointer' : 'not-allowed',
              opacity: dismissAllowed ? 1 : 0.4,
            }}
            className="bg-none border-none text-[var(--text-dim)] text-[14px] leading-none p-[0_2px]"
            title={dismissAllowed ? t('plan.close') : t('plan.incompleteHint')}
          >✕</button>
        )}
      </div>

      {isDone && incomplete && (
        <div className="p-[8px] bg-[var(--red-soft)] rounded-[4px] text-[11px] text-[var(--red,#e74c3c)] mb-[8px]">
          ⚠ {t('plan.incomplete', { count: failedCount })}
          {plan.finalAuditIssues && plan.finalAuditIssues.length > 0 && (
            <ul className="m-[4px_0_0_16px] p-0">
              {plan.finalAuditIssues.slice(0, 3).map((iss, k) => (
                <li key={k}>{iss.slice(0, 200)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {isDone && !incomplete && plan.finalAuditStatus === 'ok' && (
        <div className="p-[8px] bg-[var(--accent-soft)] rounded-[4px] text-[11px] text-[var(--accent)] mb-[8px]">
          ✓ {t('plan.validated', { done: doneCount, total: statuses.length })}
        </div>
      )}

      <div
        ref={containerRef}
        className="flex flex-col gap-0 max-h-[280px] overflow-y-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        {plan.steps.map((step, i) => {
          const status: StepStatus = (statuses[i] as StepStatus) || 'pending';
          const isActive = (status === 'running' || status === 'verifying') && loading;
          const sStyle = statusStyle(status, isActive);
          const stepId = `step_${i}`;
          const stepResults = (plan.results || {})[stepId] || [];
          const skipReason = (plan.skipReasons || {})[stepId];
          const expanded = expandedStep === stepId;
          const hasResults = stepResults.length > 0;
          const clickable = hasResults;

          // Connector color
          const nextStatus = statuses[i + 1];
          let connectorColor: string = 'var(--border)';
          if (status === 'done') connectorColor = 'var(--accent)';
          else if (status === 'failed') connectorColor = 'var(--red,#e74c3c)';
          else if (status === 'skipped') connectorColor = 'var(--text-dim)';
          void nextStatus;

          return (
            <div key={i} ref={isActive ? activeRef : undefined}>
              <div className="flex items-stretch gap-[10px]">
                {/* Timeline column */}
                <div className="flex flex-col items-center w-[14px] flex-shrink-0">
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: sStyle.dotFill,
                    border: `2px solid ${sStyle.dotColor}`,
                    flexShrink: 0,
                    marginTop: 5,
                    transition: 'all 0.3s',
                    boxShadow: isActive ? `0 0 0 3px color-mix(in srgb, var(--blue) 20%, transparent)` : 'none',
                    ...(isActive ? { animation: 'pulse-ring 1.5s ease-in-out infinite' } : {}),
                  }} />
                  {i < plan.steps.length - 1 && (
                    <div style={{
                      width: 2, flex: 1,
                      background: connectorColor,
                      margin: '2px 0',
                      transition: 'background 0.3s',
                      minHeight: 10,
                    }} />
                  )}
                </div>

                {/* Step label */}
                <div
                  onClick={() => clickable && setExpandedStep(expanded ? null : stepId)}
                  className="flex-1 pt-[2px] select-none"
                  style={{
                    paddingBottom: i < plan.steps.length - 1 ? 8 : 4,
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    color: sStyle.textColor,
                    transition: 'color 0.3s',
                  }}>
                    {sStyle.icon && (
                      <span style={{ color: sStyle.iconColor || undefined, fontSize: 10 }}>
                        {sStyle.icon}
                      </span>
                    )}
                    <span className="flex-1">{step}</span>
                    {hasResults && (
                      <span
                        className="text-[10px] px-[6px] py-[1px] bg-[var(--bg)] border border-[var(--border)] rounded-[3px] text-[var(--text-dim)] font-semibold"
                        title="Critères Definition of Done évalués"
                      >
                        DoD: {stepResults.length}
                      </span>
                    )}
                    {clickable && (
                      <span className="text-[9px] text-[var(--text-dim)]">
                        {expanded ? '▾' : '▸'}
                      </span>
                    )}
                  </div>
                  {status === 'skipped' && skipReason && (
                    <div className="text-[11px] italic text-[var(--text-dim)] mt-[2px] ml-[16px]">
                      {skipReason}
                    </div>
                  )}
                  {expanded && (
                    <div className="mt-[4px] ml-[16px] mr-[4px]">
                      <DoDDrawer results={stepResults} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isDone && plan.screenshots && plan.screenshots.length > 0 && (
        <div className="mt-[12px] pt-[12px] border-t border-dashed border-[var(--border)]">
          <div className="text-[10px] font-bold text-[var(--text-dim)] mb-[6px] tracking-[0.08em] uppercase">
            {t('plan.screenshots')}
          </div>
          <div className="flex gap-[6px] flex-wrap">
            {plan.screenshots.map((path, k) => (
              <img
                key={k}
                src={screenshotUrl(path)}
                alt=""
                onClick={() => setLightbox(path)}
                className="w-[80px] h-[80px] object-cover cursor-pointer border border-[var(--border)] rounded-[4px]"
              />
            ))}
          </div>
        </div>
      )}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-[var(--overlay-strong)] z-[1000] flex items-center justify-center cursor-zoom-out"
        >
          <img
            src={screenshotUrl(lightbox)}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-[4px]"
            style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
          />
        </div>
      )}
    </div>
  );
}

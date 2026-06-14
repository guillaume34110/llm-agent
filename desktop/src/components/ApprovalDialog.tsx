import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { decideApproval, subscribeApprovals, type ApprovalRequest } from '../approvals/approval-service';
import { getCurrentAnimal, subscribe as subscribeAnimal } from '../animals/animal-service';

export default function ApprovalDialog() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<ApprovalRequest[]>([]);
  const [animalName, setAnimalName] = useState(() => getCurrentAnimal().displayName);
  const current = queue[0] || null;

  useEffect(() => subscribeApprovals(setQueue), []);
  useEffect(() => subscribeAnimal(a => setAnimalName(a.displayName)), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current) {
        e.preventDefault();
        decideApproval(current.id, false);
      }
    };
    if (current) {
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [current]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('approval.required')}
      className="fixed inset-0 z-[70] bg-[rgba(0,0,0,0.52)] flex items-center justify-center p-[24px]">
      <div className="w-[min(640px,100%)] bg-[var(--bg2)] border border-[var(--border)] rounded-[var(--rm)] shadow-[0_24px_60px_rgba(0,0,0,0.35)] overflow-hidden">
        <div className="px-[18px] py-[16px] border-b border-[var(--border)] bg-[var(--bg3)]">
          <div className="text-[11px] text-[var(--amber)] font-black uppercase tracking-[0.08em]">
            {t('approval.required')}
          </div>
          <div className="mt-[6px] text-[18px] font-black text-[var(--text)]">
            {current.title}
          </div>
          <div className="mt-[8px] text-[13px] text-[var(--text-muted)]">
            {current.summary}
          </div>
        </div>

        <div className="p-[18px] flex flex-col gap-[12px]">
          <div className="text-[12.5px] text-[var(--text-muted)] leading-[1.6]">
            {t('approval.waitingMessage', { animalName })}
          </div>
          <pre className="m-0 p-[14px_16px] rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] text-[11.5px] whitespace-pre-wrap leading-[1.5] max-h-[260px] overflow-auto">
            {current.detail}
          </pre>
        </div>

        <div className="p-[18px] border-t border-[var(--border)] flex gap-[10px] justify-end">
          <button
            onClick={() => decideApproval(current.id, false)}
            className="px-[14px] py-[10px] rounded-[var(--r)] border border-[var(--border)] bg-transparent text-[var(--red)] cursor-pointer font-black font-[Nunito]"
          >
            {t('approval.deny')}
          </button>
          <button
            onClick={() => decideApproval(current.id, true, true)}
            className="px-[14px] py-[10px] rounded-[var(--r)] border border-[var(--accent)] bg-transparent text-[var(--accent)] cursor-pointer font-black font-[Nunito]"
          >
            {t('approval.allowSession')}
          </button>
          <button
            onClick={() => decideApproval(current.id, true)}
            className="px-[14px] py-[10px] rounded-[var(--r)] border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] cursor-pointer font-black font-[Nunito]"
          >
            {t('approval.allowOnce')}
          </button>
        </div>
      </div>
    </div>
  );
}

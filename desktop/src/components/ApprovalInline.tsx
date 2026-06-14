import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { decideApproval, subscribeApprovals, type ApprovalRequest } from '../approvals/approval-service';

export default function ApprovalInline() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<ApprovalRequest[]>([]);
  const current = queue[0] || null;

  useEffect(() => subscribeApprovals(setQueue), []);

  if (!current) return null;

  return (
    <div className="self-start max-w-[85%] bg-[var(--bg3)] border border-[var(--amber,#f59e0b)] border-l-[3px] border-l-[var(--amber,#f59e0b)] rounded-[4px_14px_14px_14px] px-[12px] py-[10px] flex flex-col gap-[8px] text-[12.5px]">
      <div className="flex items-baseline gap-[8px]">
        <span className="text-[10px] font-black text-[var(--amber,#f59e0b)] uppercase tracking-[0.08em]">
          {t('approval.label')}
        </span>
        <span className="font-black text-[var(--text)]">{current.title}</span>
        {queue.length > 1 && <span className="text-[10px] text-[var(--text-muted)]">+{queue.length - 1}</span>}
      </div>
      <div className="text-[var(--text-muted)] font-[ui-monospace,'SF_Mono',Menlo,monospace] text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis">
        {current.summary}
      </div>
      <div className="flex gap-[6px] flex-wrap">
        <button
          onClick={() => decideApproval(current.id, true)}
          style={btnStyle('var(--accent)', true)}
        >
          {t('approval.allow')}
        </button>
        <button
          onClick={() => decideApproval(current.id, true, true)}
          style={btnStyle('var(--accent)', false)}
        >
          {t('approval.allowAllSession')}
        </button>
        <button
          onClick={() => decideApproval(current.id, false)}
          style={btnStyle('var(--red)', false)}
        >
          {t('approval.deny')}
        </button>
      </div>
    </div>
  );
}

function btnStyle(color: string, primary: boolean): React.CSSProperties {
  return {
    padding: '5px 10px',
    fontSize: 11.5,
    borderRadius: 8,
    border: `1px solid ${color}`,
    background: primary ? color : 'transparent',
    color: primary ? '#000' : color,
    cursor: 'pointer',
    fontWeight: 800,
    fontFamily: 'Nunito',
  };
}

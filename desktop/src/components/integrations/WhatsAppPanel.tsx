import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getWhatsAppBridgeStatus,
  pushWhatsAppActivity,
  subscribeWhatsAppActivity,
  type WhatsAppActivityEvent,
  type WhatsAppBridgeStatus,
} from '../../whatsapp/wa-bridge';
import WhatsAppChatsPanel from '../WhatsAppChatsPanel';

const WA_URL = (import.meta as any).env?.VITE_WA_SIDECAR_URL || 'http://localhost:3472';

interface WaStatus {
  status: 'disconnected' | 'qr' | 'pairing' | 'ready' | 'failed';
  runtimeVersion?: string | null;
  pid?: number | null;
  qr?: string | null;
  user?: { id?: string; name?: string } | null;
  error?: string | null;
  startedAt?: string | null;
  connectedAt?: string | null;
  lastInboxAt?: string | null;
  lastInboxType?: string | null;
  lastReplyAt?: string | null;
  lastSendError?: string | null;
  lastUpsertAt?: string | null;
  lastUpsertType?: string | null;
  lastUpsertRemoteJid?: string | null;
  lastEventAt?: string | null;
  lastEventSource?: string | null;
  lastEventType?: string | null;
  lastEventRemoteJid?: string | null;
  lastEventCount?: number | null;
  lastRejectedReason?: string | null;
}

// STATUS_LABEL is created in component to use translation
const getStatusLabel = (t: any): Record<WaStatus['status'], { label: string; color: string }> => ({
  disconnected: { label: t('integrations.whatsappPanel.disconnected'), color: 'var(--text-muted)' },
  pairing: { label: t('integrations.whatsappPanel.starting'), color: 'var(--amber)' },
  qr: { label: t('integrations.whatsappPanel.waitingForScan'), color: 'var(--blue)' },
  ready: { label: t('integrations.whatsappPanel.connected'), color: 'var(--accent)' },
  failed: { label: t('integrations.whatsappPanel.failed'), color: 'var(--red)' },
});

function fmtTs(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('fr-FR');
}

export default function WhatsAppPanel() {
  const { t } = useTranslation();
  const [data, setData] = useState<WaStatus | null>(null);
  const [bridge, setBridge] = useState<WhatsAppBridgeStatus>(() => getWhatsAppBridgeStatus());
  const [reachable, setReachable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<WhatsAppActivityEvent[]>([]);

  useEffect(() => subscribeWhatsAppActivity(setActivity), []);

  useEffect(() => {
    let cancelled = false;
    let prev: WaStatus | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`${WA_URL}/wa/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as WaStatus;
        if (!cancelled) {
          if (prev) {
            if (json.lastInboxAt && json.lastInboxAt !== prev.lastInboxAt) {
              pushWhatsAppActivity('info', 'inbox', `${json.lastInboxType || 'msg'} (sidecar)`);
            }
            if (json.lastUpsertAt && json.lastUpsertAt !== prev.lastUpsertAt) {
              pushWhatsAppActivity('info', 'upsert', `${json.lastUpsertType || '?'} ${json.lastUpsertRemoteJid?.slice(-14) || ''}`);
            }
            if (json.lastRejectedReason && json.lastRejectedReason !== prev.lastRejectedReason) {
              pushWhatsAppActivity('warn', 'reject', json.lastRejectedReason);
            }
            if (json.lastSendError && json.lastSendError !== prev.lastSendError) {
              pushWhatsAppActivity('error', 'sidecar', json.lastSendError);
            }
            if (json.status !== prev.status) {
              pushWhatsAppActivity('info', 'status', `${prev.status} → ${json.status}`);
            }
          }
          prev = json;
          setData(json);
          setBridge(getWhatsAppBridgeStatus());
          setReachable(true);
        }
      } catch {
        if (!cancelled) {
          setBridge(getWhatsAppBridgeStatus());
          setReachable(false);
        }
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${WA_URL}/wa/logout`, { method: 'POST' });
    } finally {
      setBusy(false);
    }
  };

  const meta = data ? getStatusLabel(t)[data.status] : null;

  const tagColor = (level: WhatsAppActivityEvent['level'], tag: string) => {
    if (level === 'error') return 'var(--red)';
    if (level === 'warn') return 'var(--amber)';
    if (tag === 'agent' || tag === 'tool' || tag === 'dequeue') return 'var(--blue)';
    if (tag === 'send' || tag === 'done') return 'var(--accent)';
    if (tag === 'inbox' || tag === 'upsert') return 'var(--blue)';
    return 'var(--text-muted)';
  };

  return (
    <div className="p-4.5 grid grid-cols-[minmax(0,1fr)] gap-3.5 w-full box-border min-w-0">
      <div>
        <div className="text-[13.5px] font-black text-[var(--text)]">WhatsApp</div>
        <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
          {t('integrations.whatsappPanel.instructions')}
        </div>
      </div>

      {!reachable && (
        <div className="p-3 border border-[var(--border)] rounded-[var(--r)] bg-[var(--red-soft)] text-[var(--red)] text-[12px] font-bold">
          {t('integrations.whatsappPanel.sidecarUnreachable', { url: WA_URL })}
        </div>
      )}

      {data && (
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full" style={{ background: meta!.color }} />
          <span className="text-[12.5px] font-extrabold" style={{ color: meta!.color }}>{meta!.label}</span>
          {data.user?.id && (
            <span className="text-[11.5px] text-[var(--text-muted)]">· {data.user.id}</span>
          )}
        </div>
      )}

      {data?.status === 'qr' && data.qr && (
        <div className="flex items-start gap-4">
          <img src={data.qr} alt={t('integrations.whatsappPanel.qrAlt')} className="w-[220px] h-[220px] rounded-[12px] bg-white p-2 border border-[var(--border)]" />
          <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            {t('integrations.whatsappPanel.scanInstructions')}
          </div>
        </div>
      )}

      {data && data.status !== 'ready' && (data.status === 'disconnected' || data.status === 'failed' || data.status === 'qr') && (
        <button
          onClick={logout}
          disabled={busy}
          title={t('integrations.whatsappPanel.deleteSessionTitle')}
          className="w-fit border border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)] rounded-[var(--r)] px-3 py-2 font-extrabold font-[Nunito] text-[12px]"
          style={{ cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? t('integrations.whatsappPanel.deleting') : t('integrations.whatsappPanel.deleteSession')}
        </button>
      )}

      {data?.status === 'ready' && (
        <div className="grid gap-2.5">
          <button
            onClick={logout}
            disabled={busy}
            className="w-fit border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2 font-bold font-[Nunito] text-[12px]"
            style={{ cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy ? t('integrations.whatsappPanel.disconnecting') : t('integrations.whatsappPanel.disconnect')}
          </button>

          <div className="border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg3)] p-3 grid gap-1.5 min-w-0" style={{ wordBreak: 'break-word', overflow: 'hidden' }}>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-dim)]">
              {t('integrations.whatsappPanel.liveDiagnostic')}
            </div>
            <div className="text-[11.5px] text-[var(--text-muted)] leading-relaxed">
              <div>Connecté depuis : {fmtTs(data.connectedAt || data.startedAt)}</div>
              <div>Runtime sidecar : {data.runtimeVersion || 'legacy'}{data.pid ? ` / pid ${data.pid}` : ''}</div>
              <div>Runtime bridge : {bridge.runtimeVersion}</div>
              <div>Dernier event WA : {fmtTs(data.lastEventAt)} {data.lastEventSource ? `(${data.lastEventSource}${data.lastEventType ? ` / ${data.lastEventType}` : ''}${data.lastEventCount != null ? ` / ${data.lastEventCount}` : ''})` : ''}</div>
              <div>Dernier JID event : {data.lastEventRemoteJid || '—'}</div>
              <div>Dernier upsert brut : {fmtTs(data.lastUpsertAt)} {data.lastUpsertType ? `(${data.lastUpsertType})` : ''}</div>
              <div>Dernier JID brut : {data.lastUpsertRemoteJid || '—'}</div>
              <div>Dernier message reçu : {fmtTs(data.lastInboxAt)} {data.lastInboxType ? `(${data.lastInboxType})` : ''}</div>
              <div>Dernière réponse envoyée : {fmtTs(data.lastReplyAt)}</div>
              <div>Bridge file : {bridge.running ? 'occupé' : 'idle'} / queue {bridge.queueLength}</div>
              <div>Dernier poll bridge : {fmtTs(bridge.lastPollAt)} {bridge.lastPollCount ? `(${bridge.lastPollCount})` : ''}</div>
              <div>Dernier run agent : {fmtTs(bridge.lastAgentStartAt)}{bridge.lastAgentDoneAt ? ` → ${fmtTs(bridge.lastAgentDoneAt)}` : ''}</div>
              <div>Dernière approval bridge : {fmtTs(bridge.lastApprovalAt)}{bridge.lastApprovalTool ? ` (${bridge.lastApprovalTool} / ${bridge.lastApprovalDecision || '—'})` : ''}</div>
            </div>
            {data.lastRejectedReason && (
              <div className="text-[11.5px] text-[var(--amber)] font-bold">
                Dernier rejet inbox : {data.lastRejectedReason}
              </div>
            )}
            {bridge.lastAgentError && (
              <div className="text-[11.5px] text-[var(--amber)] font-bold">
                Dernière erreur bridge : {bridge.lastAgentError}
              </div>
            )}
            {bridge.lastSendError && (
              <div className="text-[11.5px] text-[var(--red)] font-bold">
                Dernière erreur envoi bridge : {bridge.lastSendError}
              </div>
            )}
            {data.lastSendError && (
              <div className="text-[11.5px] text-[var(--red)] font-bold">
                Dernière erreur d&apos;envoi : {data.lastSendError}
              </div>
            )}
          </div>
        </div>
      )}

      {data?.error && (
        <div className="text-[11.5px] text-[var(--red)] font-bold">Erreur : {data.error}</div>
      )}

      {data?.status === 'ready' && <WhatsAppChatsPanel />}

      <div className="border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg3)] p-3 grid gap-2 min-w-0 overflow-hidden">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-dim)]">
          {t('integrations.whatsappPanel.bridgeTasks', { count: activity.length })}
        </div>
        <div className="max-h-[320px] overflow-y-auto flex flex-col-reverse gap-1 font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[11px] leading-[1.5]">
          {activity.length === 0 ? (
            <div className="text-[var(--text-muted)] italic">
              {t('integrations.whatsappPanel.noTasksYet')}
            </div>
          ) : (
            activity.map(ev => (
              <div key={ev.id} className="grid gap-2" style={{ gridTemplateColumns: '60px 70px 1fr', alignItems: 'baseline' }}>
                <span className="text-[var(--text-dim)]">
                  {new Date(ev.at).toLocaleTimeString('fr-FR', { hour12: false })}
                </span>
                <span className="font-extrabold uppercase" style={{ color: tagColor(ev.level, ev.tag) }}>
                  {ev.tag}
                </span>
                <span style={{ color: ev.level === 'error' ? 'var(--red)' : ev.level === 'warn' ? 'var(--amber)' : 'var(--text)' }}>
                  {ev.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

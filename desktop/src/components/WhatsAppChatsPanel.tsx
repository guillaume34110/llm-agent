import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getChatConfig,
  setChatConfig,
  disableAllContacts,
  subscribeChatConfigs,
  PERSONA_MAX_CHARS,
  type ToolMode,
} from '../whatsapp/wa-chat-config';
import { listPersistedChats, subscribePersistedChats, type PersistedChat } from '../whatsapp/wa-store';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const WA_URL = (import.meta as any).env?.VITE_WA_SIDECAR_URL || 'http://localhost:3472';
const POLL_MS = 5000;
const PIC_TTL_MS = 5 * 60 * 1000;

type ChatRow = {
  jid: string;
  kind: 'owner' | 'contact';
  displayName: string | null;
  lastMessageAt: number | null;
  lastPreview: string;
  lastFromBot: boolean;
  messageCount: number;
};

type RosterResponse = { chats: ChatRow[]; owner: string | null };

const TOOL_MODE_LABEL_FR: Record<ToolMode, string> = {
  full: 'Complet',
  chat_only: 'Chat seul',
  chat_search: 'Chat + recherche web',
};

function fmtTs(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR');
}

function shortJid(jid: string): string {
  const at = jid.indexOf('@');
  return at > 0 ? jid.slice(0, at) : jid;
}

const pictureCache = new Map<string, { url: string | null; at: number }>();

async function fetchPicture(jid: string): Promise<string | null> {
  const cached = pictureCache.get(jid);
  if (cached && Date.now() - cached.at < PIC_TTL_MS) return cached.url;
  try {
    const res = await fetch(`${WA_URL}/wa/contact/${encodeURIComponent(jid)}`);
    if (!res.ok) {
      pictureCache.set(jid, { url: null, at: Date.now() });
      return null;
    }
    const json = await res.json();
    const url: string | null = typeof json?.pictureUrl === 'string' ? json.pictureUrl : null;
    pictureCache.set(jid, { url, at: Date.now() });
    return url;
  } catch {
    pictureCache.set(jid, { url: null, at: Date.now() });
    return null;
  }
}

function Avatar({ jid, name }: { jid: string; name: string | null }) {
  const [url, setUrl] = useState<string | null>(() => pictureCache.get(jid)?.url ?? null);
  useEffect(() => {
    let cancelled = false;
    fetchPicture(jid).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [jid]);
  const initials = (name || shortJid(jid)).slice(0, 2).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 bg-[var(--bg3)] border border-[var(--border)] flex items-center justify-center text-[12px] font-[800] text-[var(--text-muted)]">
      {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : initials}
    </div>
  );
}

function ConfigModal({ row, onClose }: { row: ChatRow; onClose: () => void }) {
  const { t } = useTranslation();
  const initial = getChatConfig(row.jid, row.kind);
  const [persona, setPersona] = useState(initial.persona);
  const [toolMode, setToolMode] = useState<ToolMode>(initial.toolMode);
  const [agentEnabled, setAgentEnabled] = useState(initial.agentEnabled);
  const [contextFolder, setContextFolder] = useState(initial.contextFolder);

  const pickFolder = async () => {
    try {
      const sel = await openDialog({
        directory: true,
        multiple: false,
        title: t('whatsapp.dialogPickFolder'),
      });
      if (typeof sel === 'string' && sel.trim()) setContextFolder(sel.trim());
    } catch {}
  };

  const save = () => {
    setChatConfig(row.jid, row.kind, { persona, toolMode, agentEnabled, contextFolder });
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/45 flex items-center justify-center z-[1000]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-[480px] max-w-[92vw] max-h-[90vh] overflow-auto bg-[var(--bg2)] border border-[var(--border)] rounded-[var(--r)] p-[18px] grid gap-3 grid-cols-1 box-border"
      >
        <div className="flex items-center gap-[10px]">
          <Avatar jid={row.jid} name={row.displayName} />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="text-[13px] font-[800] text-[var(--text)] whitespace-nowrap overflow-hidden text-ellipsis">
              {row.displayName || shortJid(row.jid)}
            </div>
            <div className="text-[11px] text-[var(--text-muted)] whitespace-nowrap overflow-hidden text-ellipsis">{row.jid}</div>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12.5px] font-700 text-[var(--text)]">
          <input type="checkbox" checked={agentEnabled} onChange={e => setAgentEnabled(e.target.checked)} />
          {t('whatsapp.labelAgentEnabled')}
        </label>

        <div>
          <div className="text-[11px] font-[800] uppercase tracking-[0.06em] text-[var(--text-dim)] mb-1">
            {t('whatsapp.labelPersona')}
          </div>
          <textarea
            value={persona}
            onChange={e => setPersona(e.target.value.slice(0, PERSONA_MAX_CHARS))}
            placeholder={t('whatsapp.placeholderPersona')}
            rows={8}
            className="w-full box-border bg-[var(--bg3)] text-[var(--text)] border border-[var(--border)] rounded-[var(--r)] p-2 font-inherit text-[12.5px] leading-[1.5] resize-vertical"
          />
          <div className="text-[10.5px] text-[var(--text-dim)] text-right">
            {persona.length} / {PERSONA_MAX_CHARS}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-[800] uppercase tracking-[0.06em] text-[var(--text-dim)] mb-1">
            {t('whatsapp.labelTools')}
          </div>
          <select
            value={toolMode}
            onChange={e => setToolMode(e.target.value as ToolMode)}
            className="w-full p-2 bg-[var(--bg3)] text-[var(--text)] border border-[var(--border)] rounded-[var(--r)] text-[12.5px]"
          >
            <option value="chat_only">{t('whatsapp.toolChatOnly')} ({t('whatsapp.toolNone')})</option>
            <option value="chat_search">{t('whatsapp.toolChatSearch')}</option>
          </select>
          <div className="text-[10.5px] text-[var(--text-dim)] mt-1">
            {t('whatsapp.hintThirdPartyLimit')}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-[800] uppercase tracking-[0.06em] text-[var(--text-dim)] mb-1">
            {t('whatsapp.labelDocFolder')}
          </div>
          <div className="flex items-center gap-2 p-2 bg-[var(--bg3)] border border-[var(--border)] rounded-[var(--r)] min-w-0">
            <div
              className={`flex-1 min-w-0 text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis direction-rtl text-left ${
                contextFolder ? 'text-[var(--text)] font-mono' : 'text-[var(--text-dim)] font-inherit'
              }`}
              title={contextFolder || ''}
            >
              {contextFolder || t('whatsapp.noFolderSelected')}
            </div>
            <button
              onClick={pickFolder}
              className="px-[10px] py-[6px] bg-transparent text-[var(--text)] border border-[var(--border)] rounded-[var(--r)] cursor-pointer font-700 text-[11px] whitespace-nowrap"
            >{t('whatsapp.buttonChoose')}</button>
            {contextFolder && (
              <button
                onClick={() => setContextFolder('')}
                className="px-[10px] py-[6px] bg-transparent text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--r)] cursor-pointer font-700 text-[11px]"
              >{t('whatsapp.buttonClear')}</button>
            )}
          </div>
          <div className="text-[10.5px] text-[var(--text-dim)] mt-1">
            {t('whatsapp.hintDocFolder')}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-[14px] py-2 bg-transparent text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--r)] cursor-pointer font-700 text-[12px]"
          >{t('common.cancel')}</button>
          <button
            onClick={save}
            className="px-[14px] py-2 bg-[var(--accent)] text-[var(--bg)] border-none rounded-[var(--r)] cursor-pointer font-[800] text-[12px]"
          >{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}

export default function WhatsAppChatsPanel() {
  const { t } = useTranslation();
  const [liveChats, setLiveChats] = useState<ChatRow[]>([]);
  const [persisted, setPersisted] = useState<PersistedChat[]>([]);
  const [ownerJid, setOwnerJid] = useState<string | null>(null);
  const [reachable, setReachable] = useState(true);
  const [editing, setEditing] = useState<ChatRow | null>(null);
  const [, setConfigVersion] = useState(0);

  // Live sidecar roster — gives us kind (owner/contact) + availability signal.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${WA_URL}/wa/chats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RosterResponse;
        if (!cancelled) {
          setLiveChats(Array.isArray(json.chats) ? json.chats : []);
          setOwnerJid(typeof json.owner === 'string' ? json.owner : null);
          setReachable(true);
        }
      } catch {
        if (!cancelled) setReachable(false);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Local SQLite roster — survives sidecar/app restart.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listPersistedChats().then(rows => { if (!cancelled) setPersisted(rows); }).catch(() => {});
    };
    refresh();
    const unsub = subscribePersistedChats(refresh);
    return () => { cancelled = true; unsub(); };
  }, []);

  // Merge: live wins (has kind + fresh preview); persisted fills gaps post-restart.
  const chats = useMemo<ChatRow[]>(() => {
    const byJid = new Map<string, ChatRow>();
    for (const p of persisted) {
      const isOwner = ownerJid && p.jid === ownerJid;
      byJid.set(p.jid, {
        jid: p.jid,
        kind: isOwner ? 'owner' : 'contact',
        displayName: p.displayName,
        lastMessageAt: p.lastMessageAt,
        lastPreview: p.lastPreview,
        lastFromBot: false,
        messageCount: p.messageCount,
      });
    }
    for (const c of liveChats) byJid.set(c.jid, c);
    return Array.from(byJid.values()).sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  }, [liveChats, persisted, ownerJid]);

  useEffect(() => subscribeChatConfigs(() => setConfigVersion(v => v + 1)), []);

  const owner = useMemo(() => chats.find(c => c.kind === 'owner') || null, [chats]);
  const contacts = useMemo(() => chats.filter(c => c.kind === 'contact'), [chats]);

  const handleToggle = (row: ChatRow, next: boolean) => {
    setChatConfig(row.jid, row.kind, { agentEnabled: next });
  };

  const handleDisableAll = () => {
    const n = disableAllContacts();
    if (n === 0) return;
  };

  return (
    <div className="p-[18px] grid grid-cols-1 gap-[14px] w-full box-border min-w-0">
      <div>
        <div className="text-[13.5px] font-[900] text-[var(--text)]">{t('whatsapp.title')}</div>
        <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-[1.6]">
          {t('whatsapp.description')}
        </div>
      </div>

      {!reachable && (
        <div className="p-3 border border-[var(--border)] rounded-[var(--r)] bg-[var(--red-soft)] text-[var(--red)] text-[12px] font-700">
          {t('whatsapp.sidecarUnreachable')}
        </div>
      )}

      {owner && (
        <div className="border border-[var(--accent)] rounded-[var(--r)] bg-[var(--bg3)] p-3 flex items-center gap-3">
          <Avatar jid={owner.jid} name={owner.displayName} />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="text-[13px] font-[800] text-[var(--text)]">
                {owner.displayName || t('whatsapp.ownChatAuto')}
              </div>
              <span className="text-[9.5px] font-[900] px-[6px] py-[2px] rounded-full bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-glow)] uppercase tracking-[0.06em]">
                {t('whatsapp.fullAssistant')}
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
              {owner.lastPreview || '—'}
            </div>
            <div className="text-[10.5px] text-[var(--text-dim)] mt-0.5">
              {fmtTs(owner.lastMessageAt)} · {owner.messageCount} msg
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-[11px] font-[800] uppercase tracking-[0.06em] text-[var(--text-dim)]">
          {t('whatsapp.contactsLabel', { count: contacts.length })}
        </div>
        {contacts.length > 0 && (
          <button
            onClick={handleDisableAll}
            className="px-[10px] py-1 bg-transparent text-[var(--amber)] border border-[var(--amber)] rounded-[var(--r)] cursor-pointer font-700 text-[11px]"
          >{t('whatsapp.buttonDisableAll')}</button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-[6px] min-w-0">
        {contacts.length === 0 ? (
          <div className="text-[12px] text-[var(--text-muted)] italic">
            {t('whatsapp.noContacts')}
          </div>
        ) : (
          contacts.map(row => {
            const cfg = getChatConfig(row.jid, 'contact');
            return (
              <div
                key={row.jid}
                className="border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg3)] p-[10px] flex items-center gap-[10px] min-w-0 w-full box-border overflow-hidden"
              >
                <Avatar jid={row.jid} name={row.displayName} />
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="text-[12.5px] font-700 text-[var(--text)] whitespace-nowrap overflow-hidden text-ellipsis">
                    {row.displayName || shortJid(row.jid)}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] whitespace-nowrap overflow-hidden text-ellipsis">
                    {row.lastFromBot ? '↳ ' : ''}{row.lastPreview || '—'}
                  </div>
                  <div className="text-[10.5px] text-[var(--text-dim)]">
                    {fmtTs(row.lastMessageAt)} · {TOOL_MODE_LABEL_FR[cfg.toolMode]}
                  </div>
                </div>
                <label className={`flex items-center gap-[6px] text-[11px] font-700 ${cfg.agentEnabled ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                  <input
                    type="checkbox"
                    checked={cfg.agentEnabled}
                    onChange={e => handleToggle(row, e.target.checked)}
                  />
                  {cfg.agentEnabled ? 'ON' : 'OFF'}
                </label>
                <button
                  onClick={() => setEditing(row)}
                  title={t('whatsapp.titleConfigure')}
                  className="px-[10px] py-[6px] bg-transparent text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--r)] cursor-pointer font-700 text-[12px]"
                >⚙</button>
              </div>
            );
          })
        )}
      </div>

      {editing && <ConfigModal row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

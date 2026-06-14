import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createGroupThread,
  listMyGroupThreads,
  fetchMyGroupKey,
  fetchGroupMessages,
  postGroupMessage,
  fetchGroupKb,
  type GroupThread,
  type GroupMessage,
  type GroupKbBundle,
} from '../social/group-client';
import { bytesToBase64, base64ToBytes } from '../social/share-crypto';
import GroupKbStatus from './GroupKbStatus';
import { knowledgeService } from '../memory/knowledge.service';

// Module-level cache: Map<threadId, CryptoKey>
const groupKeys = new Map<string, CryptoKey>();

// Encryption helpers
async function encryptForGroup(key: CryptoKey, payload: unknown): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv, 0);
  blob.set(ct, iv.length);
  return bytesToBase64(blob);
}

async function decryptForGroup(key: CryptoKey, b64: string): Promise<unknown> {
  const blob = base64ToBytes(b64);
  if (blob.length < 13) throw new Error('ciphertext too small');
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// Helper: load group key from storage or server
async function loadGroupKey(threadId: string): Promise<CryptoKey | null> {
  // Check module cache first
  if (groupKeys.has(threadId)) {
    return groupKeys.get(threadId)!;
  }

  // Check localStorage
  const cached = localStorage.getItem(`groupKey:${threadId}`);
  if (cached) {
    const keyBytes = base64ToBytes(cached);
    const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
    groupKeys.set(threadId, key);
    return key;
  }

  // Fetch from server
  try {
    const wrappedKeyB64 = await fetchMyGroupKey(threadId);
    const keyBytes = base64ToBytes(wrappedKeyB64);
    const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
    groupKeys.set(threadId, key);
    localStorage.setItem(`groupKey:${threadId}`, wrappedKeyB64);
    return key;
  } catch {
    return null;
  }
}

interface CreateGroupState {
  open: boolean;
  title: string;
  memberIds: string;
  loading: boolean;
  error: string;
}

export default function KbSharePanel() {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';

  const [threads, setThreads] = useState<GroupThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [errorThreads, setErrorThreads] = useState('');

  const [createModal, setCreateModal] = useState<CreateGroupState>({
    open: false,
    title: '',
    memberIds: '',
    loading: false,
    error: '',
  });

  const hasJwt = !!localStorage.getItem('jwt');

  // Load threads on mount
  useEffect(() => {
    if (!hasJwt) {
      setLoadingThreads(false);
      return;
    }
    let cancelled = false;
    setLoadingThreads(true);
    setErrorThreads('');
    listMyGroupThreads()
      .then((list) => {
        if (!cancelled) {
          setThreads(list);
          if (list.length > 0) setSelectedThreadId(list[0].id);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          const msg = String(e?.message || e);
          if (msg.includes('401')) {
            setErrorThreads(lang === 'fr' ? 'Session expirée — reconnecte-toi.' : 'Session expired — sign in again.');
          } else {
            setErrorThreads(msg);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingThreads(false);
      });
    return () => { cancelled = true; };
  }, [hasJwt, lang]);

  async function handleCreateGroup() {
    const { title, memberIds } = createModal;
    if (!title.trim()) {
      setCreateModal((s) => ({ ...s, error: lang === 'fr' ? 'Titre requis' : 'Title required' }));
      return;
    }

    setCreateModal((s) => ({ ...s, loading: true, error: '' }));

    try {
      // Generate fresh AES-256 key
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      const keyB64 = bytesToBase64(keyBytes);

      // Build members array
      const lines = memberIds.trim().split('\n').map((l) => l.trim()).filter(Boolean);
      const userId = localStorage.getItem('userId');
      const uniqueIds = new Set([...lines, ...(userId ? [userId] : [])]);

      const members = Array.from(uniqueIds).map((id) => ({
        userId: id,
        wrappedKey: keyB64, // MVP: wrappedKey is raw key
      }));

      const thread = await createGroupThread({ title, members });

      // Cache the key locally
      const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
      groupKeys.set(thread.id, key);
      localStorage.setItem(`groupKey:${thread.id}`, keyB64);

      // Refresh threads
      const updated = await listMyGroupThreads();
      setThreads(updated);
      setSelectedThreadId(thread.id);

      setCreateModal({ open: false, title: '', memberIds: '', loading: false, error: '' });
    } catch (e: any) {
      setCreateModal((s) => ({ ...s, error: String(e?.message || e), loading: false }));
    }
  }

  return (
    <div className="p-[18px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[13.5px] font-black text-[var(--text)]">
            {lang === 'fr' ? 'Partage KB' : 'KB share'}
          </div>
          <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed max-w-md">
            {lang === 'fr'
              ? 'Groupes privés chiffrés pour partager messages + bundles KB. Serveur voit ciphertext seulement, clé reste locale.'
              : 'Encrypted private groups to share messages + KB bundles. Server sees ciphertext only, key stays local.'}
          </div>
        </div>
        <button
          onClick={() => setCreateModal((s) => ({ ...s, open: true }))}
          disabled={!hasJwt}
          className="px-3 py-1.5 text-[12px] bg-[var(--accent)] text-[var(--accent-text)] rounded-[var(--rm)] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {lang === 'fr' ? '+ Nouveau' : '+ New'}
        </button>
      </div>

      {!hasJwt && (
        <div className="mb-3 p-3 rounded-[var(--rm)] border border-[var(--border)] bg-[var(--bg2)] text-[12px] text-[var(--text-dim)]">
          {lang === 'fr'
            ? 'Connecte-toi pour créer ou rejoindre des groupes chiffrés. Les clés restent locales — le serveur ne sert que de relais.'
            : 'Sign in to create or join encrypted groups. Keys stay local — the server is only a relay.'}
        </div>
      )}

      {/* Main layout: two columns or stacked */}
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0">
        {/* Left: Group list */}
        <div className="w-full md:w-[280px] flex flex-col border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg2)] overflow-hidden">
          <div className="text-[12px] font-black text-[var(--text)] p-3 border-b border-[var(--border)]">
            {lang === 'fr' ? 'Mes groupes' : 'My groups'}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingThreads && (
              <div className="p-3 text-[12px] text-[var(--text-dim)]">
                {lang === 'fr' ? 'Chargement…' : 'Loading…'}
              </div>
            )}

            {errorThreads && !loadingThreads && (
              <div className="p-3 text-[11px]" style={{ color: '#e07070' }}>
                {lang === 'fr' ? 'Erreur : ' : 'Error: '}{errorThreads}
              </div>
            )}

            {!loadingThreads && threads.length === 0 && (
              <div className="p-3 text-[12px] text-[var(--text-dim)]">
                {lang === 'fr' ? 'Aucun groupe' : 'No groups'}
              </div>
            )}

            {!loadingThreads &&
              threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => setSelectedThreadId(thread.id)}
                  className={`w-full text-left p-3 border-b border-[var(--border)] text-[12px] transition ${
                    selectedThreadId === thread.id
                      ? 'bg-[var(--accent)] text-[var(--accent-text)]'
                      : 'bg-[var(--bg2)] text-[var(--text)] hover:bg-[var(--bg3)]'
                  }`}
                >
                  <div className="font-medium truncate">{thread.title}</div>
                  <div className={`text-[11px] mt-1 ${selectedThreadId === thread.id ? 'opacity-90' : 'text-[var(--text-dim)]'}`}>
                    {thread.members?.length || 0} {lang === 'fr' ? 'membre(s)' : 'member(s)'}
                  </div>
                </button>
              ))}
          </div>
        </div>

        {/* Right: Thread detail (if selected) */}
        {selectedThreadId && (
          <ThreadDetail threadId={selectedThreadId} lang={lang} />
        )}

        {!selectedThreadId && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-dim)] text-[12px]">
            {lang === 'fr' ? 'Sélectionnez un groupe' : 'Select a group'}
          </div>
        )}
      </div>

      {/* Create Group Modal */}
      {createModal.open && (
        <CreateGroupModal
          lang={lang}
          state={createModal}
          setState={setCreateModal}
          onSubmit={handleCreateGroup}
        />
      )}
    </div>
  );
}

function CreateGroupModal({
  lang,
  state,
  setState,
  onSubmit,
}: {
  lang: 'fr' | 'en';
  state: CreateGroupState;
  setState: (s: CreateGroupState) => void;
  onSubmit: () => Promise<void>;
}) {
  const handleClose = () => {
    if (state.loading) return;
    setState({ ...state, open: false, error: '' });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loading]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleClose}
    >
      <div
        className="w-[min(520px,90vw)] bg-[var(--bg3)] border border-[var(--border)] rounded-[var(--rm)] p-[18px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[13.5px] font-black text-[var(--text)] mb-4">
          {lang === 'fr' ? 'Créer un groupe' : 'Create group'}
        </div>

        <label className="block text-[12px] font-medium text-[var(--text)] mb-2">
          {lang === 'fr' ? 'Titre' : 'Title'}
        </label>
        <input
          type="text"
          value={state.title}
          onChange={(e) => setState({ ...state, title: e.target.value })}
          placeholder={lang === 'fr' ? 'Nom du groupe' : 'Group name'}
          className="w-full px-3 py-2 text-[12px] bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text)] mb-4"
          disabled={state.loading}
        />

        <label className="block text-[12px] font-medium text-[var(--text)] mb-2">
          {lang === 'fr' ? 'IDs utilisateurs (un par ligne)' : 'User IDs (one per line)'}
        </label>
        <textarea
          value={state.memberIds}
          onChange={(e) => setState({ ...state, memberIds: e.target.value })}
          placeholder={lang === 'fr' ? 'user1\nuser2\nuser3' : 'user1\nuser2\nuser3'}
          className="w-full px-3 py-2 text-[12px] bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text)] mb-4 font-mono"
          rows={4}
          disabled={state.loading}
        />

        {state.error && (
          <div className="text-[11px] mb-4" style={{ color: '#e07070' }}>
            {state.error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-[12px] bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] rounded hover:bg-[var(--bg2)]"
            disabled={state.loading}
          >
            {lang === 'fr' ? 'Annuler' : 'Cancel'}
          </button>
          <button
            onClick={onSubmit}
            className="px-4 py-2 text-[12px] bg-[var(--accent)] text-[var(--accent-text)] rounded hover:opacity-90 disabled:opacity-50"
            disabled={state.loading}
          >
            {state.loading ? (lang === 'fr' ? 'Création…' : 'Creating…') : (lang === 'fr' ? 'Créer' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThreadDetail({ threadId, lang }: { threadId: string; lang: 'fr' | 'en' }) {
  const [tab, setTab] = useState<'kb' | 'messages'>('kb');
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [keyLoading, setKeyLoading] = useState(true);
  const [keyError, setKeyError] = useState('');

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [kbs, setKbs] = useState<GroupKbBundle[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [errorContent, setErrorContent] = useState('');

  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load key
  useEffect(() => {
    let cancelled = false;
    setKeyLoading(true);
    setKeyError('');
    loadGroupKey(threadId)
      .then((k) => {
        if (!cancelled) {
          setKey(k);
          if (!k) setKeyError(lang === 'fr' ? 'Clé indisponible' : 'Key unavailable');
        }
      })
      .catch((e) => {
        if (!cancelled) setKeyError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setKeyLoading(false);
      });
    return () => { cancelled = true; };
  }, [threadId, lang]);

  // Load content (messages or KB)
  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    setLoadingContent(true);
    setErrorContent('');

    const load = async () => {
      try {
        if (tab === 'messages') {
          const msgs = await fetchGroupMessages(threadId);
          if (!cancelled) setMessages(msgs);
        } else {
          const bundles = await fetchGroupKb(threadId);
          if (!cancelled) setKbs(bundles);
        }
      } catch (e) {
        if (!cancelled) setErrorContent(String((e as any)?.message || e));
      } finally {
        if (!cancelled) setLoadingContent(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [threadId, tab, key]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (keyLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--text-dim)]">
        {lang === 'fr' ? 'Chargement de la clé…' : 'Loading key…'}
      </div>
    );
  }

  if (keyError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[12px]" style={{ color: '#e07070' }}>
          {keyError}
        </div>
      </div>
    );
  }

  if (!key) {
    return (
      <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--text-dim)]">
        {lang === 'fr' ? 'Clé non disponible' : 'Key unavailable'}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg2)] overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        <button
          onClick={() => setTab('kb')}
          className={`flex-1 px-4 py-3 text-[12px] font-medium border-b-2 transition ${
            tab === 'kb'
              ? 'text-[var(--text)] border-[var(--accent)]'
              : 'text-[var(--text-dim)] border-transparent hover:text-[var(--text)]'
          }`}
        >
          {lang === 'fr' ? 'KB' : 'KB'}
        </button>
        <button
          onClick={() => setTab('messages')}
          className={`flex-1 px-4 py-3 text-[12px] font-medium border-b-2 transition ${
            tab === 'messages'
              ? 'text-[var(--text)] border-[var(--accent)]'
              : 'text-[var(--text-dim)] border-transparent hover:text-[var(--text)]'
          }`}
        >
          {lang === 'fr' ? 'Messages' : 'Messages'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loadingContent && (
          <div className="text-[12px] text-[var(--text-dim)]">
            {lang === 'fr' ? 'Chargement…' : 'Loading…'}
          </div>
        )}

        {errorContent && (
          <div className="text-[11px]" style={{ color: '#e07070' }}>
            {lang === 'fr' ? 'Erreur : ' : 'Error: '}{errorContent}
          </div>
        )}

        {!loadingContent && tab === 'kb' && (
          <>
            <div className="mb-3">
              <GroupKbStatus
                threadId={threadId}
                currentUserId={localStorage.getItem('userId') || ''}
                prepareCiphertext={async (modelId) => {
                  const docs = await knowledgeService.listDocuments(50);
                  const active = docs.filter((d) => !d.archived);
                  if (active.length === 0) {
                    throw new Error(
                      lang === 'fr'
                        ? 'Aucun document KB à partager (base vide).'
                        : 'No KB documents to share (knowledge base is empty).',
                    );
                  }
                  const manifest = {
                    modelId,
                    sharedAt: Date.now(),
                    docs: active.map((d) => ({ id: d.id, title: d.title, tags: d.tags, sizeBytes: d.sizeBytes })),
                  };
                  const ciphertext = await encryptForGroup(key, manifest);
                  return { modelId, ciphertext };
                }}
              />
            </div>
            <KBTab kbs={kbs} cryptoKey={key} lang={lang} />
          </>
        )}

        {!loadingContent && tab === 'messages' && (
          <MessagesTab messages={messages} cryptoKey={key} lang={lang} messagesEndRef={messagesEndRef} />
        )}
      </div>

      {/* Input (only for messages tab) */}
      {tab === 'messages' && (
        <MessageInput
          threadId={threadId}
          cryptoKey={key}
          lang={lang}
          messageText={messageText}
          setMessageText={setMessageText}
          sendingMessage={sendingMessage}
          setSendingMessage={setSendingMessage}
          onMessageSent={(msg) => setMessages((m) => [...m, msg])}
        />
      )}
    </div>
  );
}

function KBTab({
  kbs,
  cryptoKey,
  lang,
}: {
  kbs: GroupKbBundle[];
  cryptoKey: CryptoKey;
  lang: 'fr' | 'en';
}) {
  const [decrypting, setDecrypting] = useState<Set<string>>(new Set());
  const [decrypted, setDecrypted] = useState<Record<string, unknown>>({});

  async function handleDecrypt(bundleId: string, ciphertext: string) {
    setDecrypting((s) => new Set(s).add(bundleId));
    try {
      const payload = await decryptForGroup(cryptoKey, ciphertext);
      setDecrypted((d) => ({ ...d, [bundleId]: payload }));
    } catch (e) {
      console.error('Decrypt error:', e);
    } finally {
      setDecrypting((s) => {
        const next = new Set(s);
        next.delete(bundleId);
        return next;
      });
    }
  }

  if (kbs.length === 0) {
    return (
      <div className="text-[12px] text-[var(--text-dim)]">
        {lang === 'fr' ? 'Aucun bundle KB' : 'No KB bundles'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {kbs.map((bundle) => (
        <div key={bundle.id} className="border border-[var(--border)] rounded p-3 bg-[var(--bg)]">
          <div className="text-[12px] font-medium text-[var(--text)] mb-1">
            Model: {bundle.modelId}
          </div>
          <div className="text-[11px] text-[var(--text-dim)] mb-2">
            {lang === 'fr' ? 'Expire : ' : 'Expires: '}
            {new Date(bundle.expiresAt).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}
          </div>

          {decrypted[bundle.id] ? (
            <pre className="text-[11px] bg-[var(--bg2)] p-2 rounded overflow-x-auto max-h-64 overflow-y-auto font-mono text-[var(--text)]">
              {JSON.stringify(decrypted[bundle.id], null, 2)}
            </pre>
          ) : (
            <button
              onClick={() => handleDecrypt(bundle.id, bundle.ciphertext)}
              disabled={decrypting.has(bundle.id)}
              className="px-3 py-1.5 text-[11px] bg-[var(--accent)] text-[var(--accent-text)] rounded hover:opacity-90 disabled:opacity-50"
            >
              {decrypting.has(bundle.id)
                ? lang === 'fr'
                  ? 'Décryptage…'
                  : 'Decrypting…'
                : lang === 'fr'
                ? 'Décrypter'
                : 'Decrypt'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function MessagesTab({
  messages,
  cryptoKey,
  lang,
  messagesEndRef,
}: {
  messages: GroupMessage[];
  cryptoKey: CryptoKey;
  lang: 'fr' | 'en';
  messagesEndRef: React.RefObject<HTMLDivElement>;
}) {
  const [decrypted, setDecrypted] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result: Record<string, string> = {};
      for (const msg of messages) {
        try {
          const payload = await decryptForGroup(cryptoKey, msg.ciphertext);
          result[msg.id] = String(payload);
        } catch {
          result[msg.id] = lang === 'fr' ? '[Décryptage impossible]' : '[Unable to decrypt]';
        }
      }
      if (!cancelled) {
        setDecrypted((d) => {
          const merged = { ...d };
          for (const k of Object.keys(result)) if (!(k in merged)) merged[k] = result[k];
          return merged;
        });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, cryptoKey]);

  if (messages.length === 0) {
    return (
      <div className="text-[12px] text-[var(--text-dim)]">
        {lang === 'fr' ? 'Aucun message' : 'No messages'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((msg) => (
        <div key={msg.id} className="bg-[var(--bg)] p-2 rounded text-[12px]">
          <div className="text-[11px] text-[var(--text-dim)] mb-1 font-mono" title={msg.senderId}>
            {msg.senderId.slice(0, 8)} • {new Date(msg.createdAt).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US')}
          </div>
          <div className="text-[var(--text)] break-words">
            {decrypted[msg.id] || (lang === 'fr' ? '[Décryptage…]' : '[Decrypting…]')}
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

function MessageInput({
  threadId,
  cryptoKey,
  lang,
  messageText,
  setMessageText,
  sendingMessage,
  setSendingMessage,
  onMessageSent,
}: {
  threadId: string;
  cryptoKey: CryptoKey;
  lang: 'fr' | 'en';
  messageText: string;
  setMessageText: (t: string) => void;
  sendingMessage: boolean;
  setSendingMessage: (b: boolean) => void;
  onMessageSent: (msg: GroupMessage) => void;
}) {
  const [sendError, setSendError] = useState('');
  async function handleSend() {
    if (!messageText.trim()) return;
    setSendingMessage(true);
    setSendError('');
    try {
      const ciphertext = await encryptForGroup(cryptoKey, messageText.trim());
      const msg = await postGroupMessage(threadId, ciphertext);
      onMessageSent(msg);
      setMessageText('');
    } catch (e: any) {
      setSendError(String(e?.message || e));
    } finally {
      setSendingMessage(false);
    }
  }

  return (
    <div className="border-t border-[var(--border)] p-3">
      {sendError && (
        <div className="mb-2 text-[11px]" style={{ color: '#e07070' }}>
          {lang === 'fr' ? 'Erreur d\'envoi : ' : 'Send error: '}{sendError}
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              handleSend();
            }
          }}
          placeholder={lang === 'fr' ? 'Message…' : 'Message…'}
          className="flex-1 px-3 py-2 text-[12px] bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--text)] resize-none"
          rows={2}
          disabled={sendingMessage}
        />
        <button
          onClick={handleSend}
          disabled={sendingMessage || !messageText.trim()}
          className="px-3 py-2 text-[12px] bg-[var(--accent)] text-[var(--accent-text)] rounded hover:opacity-90 disabled:opacity-50 font-medium"
        >
          {sendingMessage ? (lang === 'fr' ? 'Envoi…' : 'Sending…') : lang === 'fr' ? 'Envoyer' : 'Send'}
        </button>
      </div>
    </div>
  );
}

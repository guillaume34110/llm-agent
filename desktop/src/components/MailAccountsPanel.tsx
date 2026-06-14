import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listAccounts,
  subscribe,
  refreshAccounts,
  addAccount,
  updateAccount,
  removeAccount,
  testAccountConnection,
  syncAccount,
  type MailAccount,
} from '../mail/mail-accounts-service';
import { autodiscover, domainOf, isGmailDomain, isGoogleConfig, type MailServerConfig, type ServerConfig } from '../mail/autodiscover';

type ModalMode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; accountId: string };

const inputClass = 'bg-[var(--bg2)] text-[var(--text)] border border-[var(--border)] rounded-[var(--r)] px-[10px] py-[8px] font-[Nunito] text-[13px]';

const primaryBtnClass = 'border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-[12px] py-[8px] cursor-pointer font-black font-[Nunito] text-[12.5px]';

const ghostBtnClass = 'border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[12px] py-[8px] cursor-pointer font-bold font-[Nunito] text-[12.5px]';

const dangerBtnClass = 'border border-[#e25555] bg-transparent text-[#e25555] rounded-[var(--r)] px-[12px] py-[8px] cursor-pointer font-bold font-[Nunito] text-[12.5px]';

function StatusPill({ account }: { account: MailAccount }) {
  const { t } = useTranslation();
  const ok = account.credentialsReady && !account.lastError;
  const color = account.lastError ? '#e25555' : ok ? 'var(--accent)' : '#e2a455';
  const label = account.lastError ? t('mail.statusError') : ok ? t('mail.statusReady') : t('mail.statusPasswordRequired');
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color,
        border: `1px solid ${color}`,
        padding: '2px 8px',
        borderRadius: 999,
      }}
    >
      {label}
    </span>
  );
}

function ServerRow({ label, config }: { label: string; config: ServerConfig }) {
  return (
    <div className="flex gap-[6px] text-[11px] text-[var(--text-dim)]">
      <span className="font-bold min-w-[44px]">{label}</span>
      <span>
        {config.host || '—'}:{config.port || '—'} · {config.socket}
      </span>
    </div>
  );
}

function AccountModal({
  mode,
  onClose,
}: {
  mode: ModalMode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = mode.kind === 'edit' ? listAccounts().find(a => a.id === mode.accountId) || null : null;

  const [email, setEmail] = useState(editing?.email || '');
  const [label, setLabel] = useState(editing?.label || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [config, setConfig] = useState<MailServerConfig | null>(
    editing
      ? {
          imap: { ...editing.imap },
          smtp: { ...editing.smtp },
          displayName: editing.label,
          source: 'manual',
        }
      : null,
  );
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<'detect' | 'test' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [indexInKb, setIndexInKb] = useState(editing?.indexInKb ?? false);

  const gmail = useMemo(() => isGmailDomain(email) || isGoogleConfig(config), [email, config]);

  const onDetect = async () => {
    setError('');
    setInfo('');
    if (!email.includes('@')) {
      setError(t('mail.errorInvalidEmail'));
      return;
    }
    setBusy('detect');
    try {
      const cfg = await autodiscover(email);
      if (!cfg) {
        setError(t('mail.errorNoAutoConfig', { domain: domainOf(email) }));
        setAdvanced(true);
      } else {
        setConfig(cfg);
        setInfo(t('mail.infoDetected', { source: cfg.source === 'ispdb' ? 'ISPDB Thunderbird' : t('mail.builtinProfile') }));
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const onTest = async () => {
    setError('');
    setInfo('');
    if (!config) {
      setError(t('mail.errorDetectFirst'));
      return;
    }
    if (!password) {
      setError(t('mail.errorPasswordRequired'));
      return;
    }
    setBusy('test');
    try {
      const res = await testAccountConnection(config.imap, email, password);
      if (!res.ok) {
        const raw = res.error || t('mail.errorTestFailed');
        const diag = `IMAP ${config.imap.host}:${config.imap.port} [${config.imap.socket || 'SSL'}] · user=${email} · pwd_len=${password.length}`;
        let hint = '';
        if (/application-specific password|app password required/i.test(raw)) {
          hint = t('mail.hintAppPassword');
        } else if (/authenticationfailed|invalid credentials|auth.*failed|login.*failed/i.test(raw)) {
          const looksGoogle = gmail;
          hint = looksGoogle ? t('mail.hintGoogleAuth') : t('mail.hintGenericAuth');
        } else if (/connect failed|timed out|timeout|refused|unreachable|getaddrinfo/i.test(raw)) {
          hint = t('mail.hintConnectionFailed');
        }
        setError(hint ? `${hint}\n\n${t('mail.labelDetail')} : ${raw}\n${diag}` : `${raw}\n${diag}`);
      } else {
        setInfo(t('mail.infoConnectionOk'));
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    setError('');
    setInfo('');
    if (!email.includes('@')) {
      setError(t('mail.errorInvalidEmailFormat'));
      return;
    }
    if (!config) {
      setError(t('mail.errorDetectFirst'));
      return;
    }
    if (!editing && !password) {
      setError(t('mail.errorPasswordRequired'));
      return;
    }
    setBusy('save');
    try {
      if (editing) {
        await updateAccount(
          {
            ...editing,
            label: label.trim() || editing.label,
            imap: { ...config.imap },
            smtp: { ...config.smtp },
            indexInKb,
          },
          password || undefined,
        );
      } else {
        await addAccount({ email, label, config, password, indexInKb });
      }
      onClose();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  if (mode.kind === 'closed') return null;

  return (
    <div
      className="fixed inset-0 bg-black/45 z-[1000] flex items-center justify-center p-[20px]"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-[var(--bg3)] border border-[var(--border)] rounded-[var(--rm)] max-w-[560px] w-full p-[18px] grid gap-[12px] max-h-[90vh] overflow-auto"
      >
        <div className="text-[14px] font-black text-[var(--text)]">
          {editing ? t('mail.titleEdit', { email: editing.email }) : t('mail.titleAdd')}
        </div>
        <div className="text-[11.5px] text-[var(--text-dim)]">
          {t('mail.descriptionModal')}
        </div>

        <label className="grid gap-[4px]">
          <span className="text-[11.5px] font-bold text-[var(--text)]">{t('mail.labelEmail')}</span>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="firstname@example.com"
            disabled={!!editing}
            className={inputClass}
            autoFocus={!editing}
          />
        </label>

        {gmail && (
          <div
            className="p-[10px] border border-[#e2a455] rounded-[var(--r)] bg-[rgba(226,164,85,0.08)] text-[11.5px] text-[var(--text)] leading-[1.5]"
          >
            <b>{t('mail.warningGmail')}</b> {t('mail.hintGmailAppPassword')}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)]"
            >
              myaccount.google.com/apppasswords
            </a>{' '}
            {t('mail.hintGmailNote')}
          </div>
        )}

        <label className="grid gap-[4px]">
          <span className="text-[11.5px] font-bold text-[var(--text)]">
            {gmail ? t('mail.labelAppPassword') : t('mail.labelPassword')}
            {editing?.credentialsReady && (
              <span className="font-normal text-[var(--text-dim)]"> · {t('mail.hintKeychainPreserved')}</span>
            )}
          </span>
          <div className="relative">
            <input
              value={password}
              onChange={e => setPassword(e.target.value.replace(/\s+/g, ''))}
              placeholder={gmail ? t('mail.placeholderAppPassword') : t('mail.placeholderPassword')}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className={`${inputClass} pr-[36px]`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? t('mail.ariaHidePassword') : t('mail.ariaShowPassword')}
              title={showPassword ? t('mail.titleHide') : t('mail.titleShow')}
              className="absolute right-[6px] top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer p-[4px] text-[var(--text-dim)] text-[14px] leading-none"
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
        </label>

        <label className="grid gap-[4px]">
          <span className="text-[11.5px] font-bold text-[var(--text)]">{t('mail.labelLabel')}</span>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={t('mail.placeholderLabel')}
            className={inputClass}
          />
        </label>

        <div className="flex gap-[8px]">
          <button onClick={onDetect} disabled={busy === 'detect' || !email} className={ghostBtnClass}>
            {busy === 'detect' ? '…' : t('mail.buttonDetect')}
          </button>
          <button
            onClick={() => setAdvanced(v => !v)}
            className={`${ghostBtnClass} ml-auto`}
          >
            {advanced ? t('mail.buttonHideAdvanced') : t('mail.buttonAdvanced')}
          </button>
        </div>

        {config && !advanced && (
          <div
            className="p-[10px] border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] grid gap-[4px]"
          >
            <ServerRow label="IMAP" config={config.imap} />
            <ServerRow label="SMTP" config={config.smtp} />
            {config.displayName && (
              <div className="text-[11px] text-[var(--text-dim)]">{config.displayName}</div>
            )}
          </div>
        )}

        {advanced && (
          <div
            className="grid gap-[8px] p-[10px] border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)]"
          >
            <div className="text-[11.5px] font-bold text-[var(--text)]">IMAP</div>
            <input
              value={config?.imap.host || ''}
              onChange={e =>
                setConfig(prev => ({
                  imap: { ...(prev?.imap || { host: '', port: 993, socket: 'SSL' }), host: e.target.value },
                  smtp: prev?.smtp || { host: '', port: 587, socket: 'STARTTLS' },
                  source: 'manual',
                }))
              }
              placeholder="imap.example.com"
              className={inputClass}
            />
            <div className="flex gap-[8px]">
              <input
                value={config?.imap.port?.toString() || ''}
                onChange={e =>
                  setConfig(prev => ({
                    imap: { ...(prev?.imap || { host: '', port: 993, socket: 'SSL' }), port: parseInt(e.target.value, 10) || 0 },
                    smtp: prev?.smtp || { host: '', port: 587, socket: 'STARTTLS' },
                    source: 'manual',
                  }))
                }
                placeholder="Port"
                className={`${inputClass} w-[100px]`}
              />
              <select
                value={config?.imap.socket || 'SSL'}
                onChange={e =>
                  setConfig(prev => ({
                    imap: {
                      ...(prev?.imap || { host: '', port: 993, socket: 'SSL' }),
                      socket: e.target.value as ServerConfig['socket'],
                    },
                    smtp: prev?.smtp || { host: '', port: 587, socket: 'STARTTLS' },
                    source: 'manual',
                  }))
                }
                className={inputClass}
              >
                <option value="SSL">SSL/TLS</option>
                <option value="STARTTLS">STARTTLS</option>
                <option value="plain">Aucun</option>
              </select>
            </div>

            <div className="text-[11.5px] font-bold text-[var(--text)] mt-[6px]">SMTP</div>
            <input
              value={config?.smtp.host || ''}
              onChange={e =>
                setConfig(prev => ({
                  imap: prev?.imap || { host: '', port: 993, socket: 'SSL' },
                  smtp: { ...(prev?.smtp || { host: '', port: 587, socket: 'STARTTLS' }), host: e.target.value },
                  source: 'manual',
                }))
              }
              placeholder="smtp.example.com"
              className={inputClass}
            />
            <div className="flex gap-[8px]">
              <input
                value={config?.smtp.port?.toString() || ''}
                onChange={e =>
                  setConfig(prev => ({
                    imap: prev?.imap || { host: '', port: 993, socket: 'SSL' },
                    smtp: { ...(prev?.smtp || { host: '', port: 587, socket: 'STARTTLS' }), port: parseInt(e.target.value, 10) || 0 },
                    source: 'manual',
                  }))
                }
                placeholder="Port"
                className={`${inputClass} w-[100px]`}
              />
              <select
                value={config?.smtp.socket || 'STARTTLS'}
                onChange={e =>
                  setConfig(prev => ({
                    imap: prev?.imap || { host: '', port: 993, socket: 'SSL' },
                    smtp: {
                      ...(prev?.smtp || { host: '', port: 587, socket: 'STARTTLS' }),
                      socket: e.target.value as ServerConfig['socket'],
                    },
                    source: 'manual',
                  }))
                }
                className={inputClass}
              >
                <option value="SSL">SSL/TLS</option>
                <option value="STARTTLS">STARTTLS</option>
                <option value="plain">Aucun</option>
              </select>
            </div>
          </div>
        )}

        <label className="flex items-center gap-[8px] text-[12px] text-[var(--text-muted)]">
          <input type="checkbox" checked={indexInKb} onChange={e => setIndexInKb(e.target.checked)} />
          {t('mail.labelIndexKb')}
        </label>

        {info && <div className="text-[11.5px] text-[var(--accent)]">{info}</div>}
        {error && <div className="text-[11.5px] text-[#e25555] whitespace-pre-wrap">{error}</div>}

        <div className="flex gap-[8px] mt-[4px]">
          <button onClick={onTest} disabled={busy === 'test' || !config || !password} className={ghostBtnClass}>
            {busy === 'test' ? '…' : t('mail.buttonTest')}
          </button>
          <div className="flex-1" />
          <button onClick={onClose} disabled={busy === 'save'} className={ghostBtnClass}>
            {t('common.cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={busy === 'save' || !config || !email || (!editing && !password)}
            className={primaryBtnClass}
          >
            {busy === 'save' ? '…' : editing ? t('mail.buttonUpdate') : t('common.save')}
          </button>
        </div>

        <div className="text-[10.5px] text-[var(--text-dim)] leading-[1.5]">
          {t('mail.footerKeychainNote')}
        </div>
      </div>
    </div>
  );
}

export default function MailAccountsPanel() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<MailAccount[]>(() => listAccounts());
  const [modal, setModal] = useState<ModalMode>({ kind: 'closed' });
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [syncMsg, setSyncMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsub = subscribe(setAccounts);
    refreshAccounts().catch(() => {});
    return unsub;
  }, []);

  const onDelete = async (id: string) => {
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    if (!confirm(t('mail.confirmDelete', { email: acc.email }))) return;
    try {
      await removeAccount(id);
    } catch (e: any) {
      alert(`${t('mail.errorDeleteFailed')}: ${e?.message || e}`);
    }
  };

  const onToggleIndex = async (account: MailAccount, next: boolean) => {
    try {
      await updateAccount({ ...account, indexInKb: next });
    } catch (e: any) {
      alert(`${t('mail.errorUpdateFailed')}: ${e?.message || e}`);
    }
  };

  const onSync = async (id: string) => {
    setSyncing(s => ({ ...s, [id]: true }));
    setSyncMsg(m => ({ ...m, [id]: '' }));
    try {
      const res = await syncAccount(id);
      setSyncMsg(m => ({ ...m, [id]: t('mail.syncSuccess', { fetched: res.fetched, inserted: res.inserted, indexed: res.indexed }) }));
    } catch (e: any) {
      setSyncMsg(m => ({ ...m, [id]: `${t('mail.syncError')}: ${e?.message || e}` }));
    } finally {
      setSyncing(s => ({ ...s, [id]: false }));
    }
  };

  return (
    <div className="p-[18px] grid gap-[12px]">
      <div className="flex items-center gap-[10px] flex-wrap">
        <div className="text-[13.5px] font-black text-[var(--text)]">{t('mail.title')}</div>
        <span
          className="text-[11px] font-bold text-[var(--text-dim)] border border-[var(--border)] px-[8px] py-[2px] rounded-full"
        >
          {t('mail.accountCount', { count: accounts.length })}
        </span>
        <div className="flex-1" />
        <button onClick={() => setModal({ kind: 'add' })} className={primaryBtnClass}>
          {t('mail.buttonAdd')}
        </button>
      </div>
      <div className="text-[11.5px] text-[var(--text-dim)] leading-[1.6]">
        {t('mail.descriptionPanel')}
      </div>

      {accounts.length === 0 && (
        <div
          className="p-[14px] border border-dashed border-[var(--border)] rounded-[var(--r)] text-[var(--text-dim)] text-[12px] text-center"
        >
          {t('mail.emptyState')}
        </div>
      )}

      <div className="grid gap-[10px]">
        {accounts.map(account => (
          <div
            key={account.id}
            className="p-[12px] border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] grid gap-[8px]"
          >
            <div className="flex items-center gap-[10px] flex-wrap">
              <div className="font-black text-[13px] text-[var(--text)]">{account.label}</div>
              <div className="text-[11px] text-[var(--text-dim)]">{account.email}</div>
              <div className="flex-1" />
              <StatusPill account={account} />
            </div>
            <ServerRow label="IMAP" config={account.imap} />
            <ServerRow label="SMTP" config={account.smtp} />
            <div className="flex gap-[8px] flex-wrap items-center">
              <label className="flex items-center gap-[6px] text-[11.5px] text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={account.indexInKb}
                  onChange={e => onToggleIndex(account, e.target.checked)}
                />
                {t('mail.labelIndexKb')}
              </label>
              <div className="flex-1" />
              <button
                onClick={() => onSync(account.id)}
                disabled={!account.credentialsReady || syncing[account.id]}
                className={ghostBtnClass}
              >
                {syncing[account.id] ? '…' : t('mail.buttonSync')}
              </button>
              <button onClick={() => setModal({ kind: 'edit', accountId: account.id })} className={ghostBtnClass}>
                {t('mail.buttonEdit')}
              </button>
              <button onClick={() => onDelete(account.id)} className={dangerBtnClass}>
                {t('mail.buttonDelete')}
              </button>
            </div>
            {syncMsg[account.id] && (
              <div className="text-[11px] text-[var(--text-dim)]">{syncMsg[account.id]}</div>
            )}
            {account.lastError && (
              <div className="text-[11px] text-[#e25555]">{t('mail.labelLastError')}: {account.lastError}</div>
            )}
          </div>
        ))}
      </div>

      <AccountModal mode={modal} onClose={() => setModal({ kind: 'closed' })} />
    </div>
  );
}

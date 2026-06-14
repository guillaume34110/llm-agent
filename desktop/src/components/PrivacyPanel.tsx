import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { exportAccountData, deleteAccount, triggerDownload } from '../compliance/account-service';
import { revokeConsent } from '../compliance/consent-service';
import AuthGate from './AuthGate';

// EU AI Act Art. 13 transparency + GDPR Art. 15/17 rights.
export default function PrivacyPanel({ onSignOut }: { onSignOut?: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const handleExport = async () => {
    setError(null); setBusy('export');
    try {
      const blob = await exportAccountData();
      triggerDownload(blob, `progsoft-export-${Date.now()}.json`);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(null); }
  };

  const handleDelete = async () => {
    if (!confirm) { setConfirm(true); return; }
    setError(null); setBusy('delete');
    try {
      await deleteAccount();
      revokeConsent();
      if (onSignOut) onSignOut();
      else window.location.reload();
    } catch (e: any) { setError(String(e?.message || e)); setConfirm(false); }
    finally { setBusy(null); }
  };

  return (
    <div className="p-4 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg2)] flex flex-col gap-3">
      <div>
        <div className="text-[14px] font-[800] text-[var(--text)]">{t('privacy.title')}</div>
        <div className="mt-1 text-[12px] text-[var(--text-dim)] leading-[1.5]">
          {t('privacy.description')}
        </div>
      </div>

      <AuthGate>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={handleExport}
          className="px-3 py-2 border border-[var(--border)] rounded-2 bg-[var(--bg3)] text-[var(--text)] text-[12px] font-[700] text-left"
          style={{ cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy === 'export' ? t('privacy.exporting') : t('privacy.exportButton')}
        </button>
        <div className="text-[11px] text-[var(--text-dim)]">{t('privacy.exportDescription')}</div>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={handleDelete}
          className="px-3 py-2 border rounded-2 text-[12px] font-[700] text-left"
          style={{
            borderColor: '#c0392b',
            background: confirm ? '#c0392b' : 'var(--bg3)',
            color: confirm ? '#fff' : '#c0392b',
            cursor: busy ? 'wait' : 'pointer'
          }}
        >
          {busy === 'delete' ? t('privacy.deleting') : confirm ? t('privacy.confirmDelete') : t('privacy.deleteButton')}
        </button>
        <div className="text-[11px] text-[var(--text-dim)]">
          {t('privacy.deleteDescription')}
        </div>
        {confirm && (
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="self-start px-2 py-1 border-none bg-transparent text-[var(--text-dim)] cursor-pointer text-[11px] underline"
          >{t('common.cancel')}</button>
        )}
      </div>
      </AuthGate>

      {error && <div className="text-[11px] text-[#c0392b]">{error}</div>}
    </div>
  );
}

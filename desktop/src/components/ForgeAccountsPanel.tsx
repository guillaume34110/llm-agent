import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  listForgeAccounts,
  upsertForgeAccount,
  removeForgeAccount,
  type ForgeProvider,
  type ForgeAccount,
} from '../forge/forge-client';
import ChoicePicker from './ChoicePicker';

const PROVIDER_LABELS: Record<ForgeProvider, { fr: string; en: string }> = {
  github: { fr: 'GitHub', en: 'GitHub' },
  gitlab: { fr: 'GitLab', en: 'GitLab' },
  gitea: { fr: 'Gitea', en: 'Gitea' },
  forgejo: { fr: 'Forgejo', en: 'Forgejo' },
};

const PROVIDERS: ForgeProvider[] = ['github', 'gitlab', 'gitea', 'forgejo'];

export default function ForgeAccountsPanel() {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';

  const [accounts, setAccounts] = useState<ForgeAccount[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [formProvider, setFormProvider] = useState<ForgeProvider>('github');
  const [formHandle, setFormHandle] = useState('');
  const [formExternalId, setFormExternalId] = useState('');
  const [formAccessToken, setFormAccessToken] = useState('');
  const [formScope, setFormScope] = useState('repo');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listForgeAccounts()
      .then((list) => {
        if (!cancelled) setAccounts(list);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRemove(account: ForgeAccount) {
    const providerLabel = PROVIDER_LABELS[account.provider as ForgeProvider][lang];
    const msg = lang === 'fr'
      ? `Retirer le compte @${account.handle} (${providerLabel}) ?`
      : `Unlink account @${account.handle} (${providerLabel})?`;
    if (!window.confirm(msg)) return;
    setFormLoading(true);
    setFormError('');
    try {
      await removeForgeAccount(account.provider as ForgeProvider);
      setAccounts((prev) => (prev ? prev.filter((a) => a.id !== account.id) : null));
    } catch (e: any) {
      setFormError(String(e?.message || e));
    } finally {
      setFormLoading(false);
    }
  }

  async function handleAddAccount() {
    if (!formHandle || !formExternalId || !formAccessToken) {
      setFormError(lang === 'fr' ? 'Tous les champs sont requis' : 'All fields are required');
      return;
    }

    setFormLoading(true);
    setFormError('');
    try {
      await upsertForgeAccount({
        provider: formProvider,
        handle: formHandle,
        externalId: formExternalId,
        accessToken: formAccessToken,
        scope: formScope || undefined,
      });

      // Refresh list
      const updated = await listForgeAccounts();
      setAccounts(updated);

      // Clear form
      setFormHandle('');
      setFormExternalId('');
      setFormAccessToken('');
      setFormScope('repo');
    } catch (e: any) {
      setFormError(String(e?.message || e));
    } finally {
      setFormLoading(false);
    }
  }

  if (error && !accounts) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">
          {lang === 'fr' ? 'Comptes forge' : 'Forge accounts'}
        </div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Erreur de chargement : ' : 'Load error: '}{error}
        </div>
      </div>
    );
  }

  if (!accounts) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">
          {lang === 'fr' ? 'Comptes forge' : 'Forge accounts'}
        </div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Chargement…' : 'Loading…'}
        </div>
      </div>
    );
  }

  return (
    <div className="p-[18px]">
      <div className="text-[13.5px] font-black text-[var(--text)]">
        {lang === 'fr' ? 'Comptes forge' : 'Forge accounts'}
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
        {lang === 'fr'
          ? 'Lie GitHub/GitLab/Gitea pour que l\'agent puisse cloner, lister repos, ouvrir PRs. Le token reste serveur-side chiffré.'
          : 'Link GitHub/GitLab/Gitea so your agent can clone, list repos, open PRs. Token stays server-side encrypted.'}
      </div>

      {/* Accounts list */}
      {accounts.length === 0 ? (
        <div className="mt-4 text-[12px] text-[var(--text-dim)]">
          {lang === 'fr' ? 'Aucun compte lié.' : 'No linked accounts.'}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {accounts.map((account) => (
            <div
              key={`${account.provider}-${account.id}`}
              className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-[var(--text)]">
                    {PROVIDER_LABELS[account.provider as ForgeProvider][lang]}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">
                    @{account.handle}
                  </div>
                  {account.scope && (
                    <div className="mt-1 text-[10px] text-[var(--text-dim)]">
                      {lang === 'fr' ? 'Périmètre : ' : 'Scope: '}{account.scope}
                    </div>
                  )}
                  {account.expiresAt && (
                    <div className="mt-1 text-[10px] text-[var(--text-dim)]">
                      {lang === 'fr' ? 'Expire : ' : 'Expires: '}
                      {new Date(account.expiresAt).toLocaleDateString(
                        lang === 'fr' ? 'fr-FR' : 'en-US'
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(account)}
                  disabled={formLoading}
                  className="flex-shrink-0 px-[10px] py-[5px] rounded-lg text-[11px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-dim)] hover:text-[#e07070] hover:border-[#e07070] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {lang === 'fr' ? 'Retirer' : 'Unlink'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add account form */}
      <div className="mt-4 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
        <div className="text-[12px] font-bold text-[var(--text)] mb-3">
          {lang === 'fr' ? 'Ajouter un compte' : 'Add account'}
        </div>

        <div className="flex flex-col gap-3">
          {/* Provider select */}
          <div>
            <label className="text-[11px] font-bold text-[var(--text)] block mb-1">
              {lang === 'fr' ? 'Forge' : 'Provider'}
            </label>
            <ChoicePicker
              value={formProvider}
              onChange={(v) => setFormProvider(v as ForgeProvider)}
              options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p][lang] }))}
              popoverWidth={260}
            />
          </div>

          {/* Handle input */}
          <div>
            <label className="text-[11px] font-bold text-[var(--text)] block mb-1">
              {lang === 'fr' ? 'Identifiant (@handle)' : 'Handle (@username)'}
            </label>
            <input
              type="text"
              value={formHandle}
              onChange={(e) => setFormHandle(e.target.value)}
              disabled={formLoading}
              placeholder={lang === 'fr' ? 'ex: octocat' : 'ex: octocat'}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[11.5px] text-[var(--text)] placeholder-[var(--text-dim)] disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* External ID input */}
          <div>
            <label className="text-[11px] font-bold text-[var(--text)] block mb-1">
              {lang === 'fr' ? 'ID utilisateur' : 'User ID'}
            </label>
            <input
              type="text"
              value={formExternalId}
              onChange={(e) => setFormExternalId(e.target.value)}
              disabled={formLoading}
              placeholder={lang === 'fr' ? 'ex: 1' : 'ex: 1'}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[11.5px] text-[var(--text)] placeholder-[var(--text-dim)] disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Access token input */}
          <div>
            <label className="text-[11px] font-bold text-[var(--text)] block mb-1">
              {lang === 'fr' ? 'Token personnel' : 'Personal access token'}
            </label>
            <input
              type="password"
              value={formAccessToken}
              onChange={(e) => setFormAccessToken(e.target.value)}
              disabled={formLoading}
              placeholder={lang === 'fr' ? 'ghp_...' : 'ghp_...'}
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[11.5px] text-[var(--text)] placeholder-[var(--text-dim)] disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Scope input */}
          <div>
            <label className="text-[11px] font-bold text-[var(--text)] block mb-1">
              {lang === 'fr' ? 'Périmètre' : 'Scope'}
            </label>
            <input
              type="text"
              value={formScope}
              onChange={(e) => setFormScope(e.target.value)}
              disabled={formLoading}
              placeholder="repo"
              className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg)] text-[11.5px] text-[var(--text)] placeholder-[var(--text-dim)] disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Error message */}
          {formError && (
            <div className="mt-2 text-[11px]" style={{ color: '#e07070' }}>
              {formError}
            </div>
          )}

          {/* Submit button */}
          <button
            type="button"
            onClick={handleAddAccount}
            disabled={formLoading}
            className="mt-2 px-3 py-1.5 rounded-lg text-[11.5px] font-bold border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {formLoading
              ? lang === 'fr'
                ? 'Ajout...'
                : 'Adding...'
              : lang === 'fr'
              ? 'Ajouter'
              : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

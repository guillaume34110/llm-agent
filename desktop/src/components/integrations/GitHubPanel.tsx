import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openGitHubPage } from '../../integrations/app-bridges';
import type { IntegrationAccountsState } from '../../integrations/app-accounts-service';
import {
  createGitHubIssue,
  listGitHubIssues,
  listGitHubNotifications,
  listGitHubRepos,
  type GitHubIssueSummary,
  type GitHubNotificationSummary,
  type GitHubRepoSummary,
} from '../../integrations/github-service';

interface Props {
  accounts: IntegrationAccountsState;
}

export default function GitHubPanel({ accounts }: Props) {
  const { t } = useTranslation();
  const [repos, setRepos] = useState<GitHubRepoSummary[]>([]);
  const [notifications, setNotifications] = useState<GitHubNotificationSummary[]>([]);
  const [issues, setIssues] = useState<GitHubIssueSummary[]>([]);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!accounts.github.token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const [nextRepos, nextNotifications, nextIssues] = await Promise.all([
        listGitHubRepos(8),
        listGitHubNotifications(8),
        listGitHubIssues(8, accounts.github.defaultRepo),
      ]);
      setRepos(nextRepos);
      setNotifications(nextNotifications);
      setIssues(nextIssues);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accounts.github.token, accounts.github.defaultRepo]);

  const createIssue = async () => {
    if (!accounts.github.defaultRepo.trim() || !issueTitle.trim()) return;
    setLoading(true);
    setError('');
    try {
      const issue = await createGitHubIssue(accounts.github.defaultRepo, issueTitle.trim(), issueBody.trim());
      setIssueTitle('');
      setIssueBody('');
      await openGitHubPage(issue.html_url);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex-1">
          <div className="text-[13.5px] font-black text-[var(--text)]">GitHub</div>
          <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
            {t('integrations.github.description')}
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || !accounts.github.token.trim()}
          className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-2.5 py-2 cursor-pointer font-bold"
        >
          {t('common.refresh')}
        </button>
      </div>

      {error && <div className="mt-3 text-[12px] text-[var(--red)]">{error}</div>}
      {!accounts.github.token.trim() && <div className="mt-3 text-[12px] text-[var(--text-dim)]">{t('integrations.github.addTokenHint')}</div>}

      {accounts.github.token.trim() && (
        <div className="mt-3.5 grid gap-4">
          <div className="grid gap-2">
            <div className="text-[11px] text-[var(--text-dim)] font-extrabold uppercase tracking-[0.06em]">{t('integrations.github.recentRepos')}</div>
            <div className="grid gap-2">
              {repos.map(repo => (
                <button key={repo.id} onClick={() => void openGitHubPage(repo.html_url)} className="text-left border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] p-3 cursor-pointer">
                  <div className="text-[12.5px] text-[var(--text)] font-extrabold">{repo.full_name}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">{repo.description || t('integrations.github.noDescription')}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-[11px] text-[var(--text-dim)] font-extrabold uppercase tracking-[0.06em]">{t('integrations.github.notifications')}</div>
            <div className="grid gap-2">
              {notifications.map(item => (
                <div key={item.id} className="border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] p-3">
                  <div className="text-[12.5px] text-[var(--text)] font-extrabold">{item.subject.title}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">{item.repository.full_name} · {item.reason}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-[11px] text-[var(--text-dim)] font-extrabold uppercase tracking-[0.06em]">{t('integrations.github.issues')}</div>
            <div className="grid gap-2">
              {issues.map(issue => (
                <button key={issue.id} onClick={() => void openGitHubPage(issue.html_url)} className="text-left border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] p-3 cursor-pointer">
                  <div className="text-[12.5px] text-[var(--text)] font-extrabold">#{issue.number} · {issue.title}</div>
                  <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">{issue.state}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-3.5 grid gap-2.5">
            <div className="text-[12.5px] text-[var(--text)] font-extrabold">{t('integrations.github.createIssue')}</div>
            <input value={issueTitle} onChange={event => setIssueTitle(event.target.value)} placeholder={t('integrations.github.issueTitlePlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
            <textarea value={issueBody} onChange={event => setIssueBody(event.target.value)} rows={4} placeholder={t('integrations.github.issueBodyPlaceholder', { repo: accounts.github.defaultRepo || 'owner/repo' })} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
            <button
              onClick={() => void createIssue()}
              disabled={loading || !accounts.github.defaultRepo.trim() || !issueTitle.trim()}
              className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold font-[Nunito]"
            >
              {t('integrations.github.createOn', { repo: accounts.github.defaultRepo || 'owner/repo' })}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

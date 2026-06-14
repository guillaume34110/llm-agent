import { getIntegrationAccounts, updateIntegrationAccounts } from './app-accounts-service';

const GITHUB_API = 'https://api.github.com';

export interface GitHubUserSummary {
  login: string;
  avatar_url: string;
  html_url: string;
  name?: string | null;
}

export interface GitHubRepoSummary {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
  description?: string | null;
  updated_at: string;
}

export interface GitHubNotificationSummary {
  id: string;
  repository: { full_name: string; html_url: string };
  subject: { title: string; type: string; url?: string | null };
  reason: string;
  unread: boolean;
  updated_at: string;
}

export interface GitHubIssueSummary {
  id: number;
  html_url: string;
  title: string;
  state: string;
  repository_url: string;
  number: number;
}

function getToken() {
  return getIntegrationAccounts().github.token.trim();
}

function authHeaders() {
  const token = getToken();
  if (!token) throw new Error('Token GitHub local manquant');
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GitHub HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  return response.json() as Promise<T>;
}

export async function validateGitHubAccount() {
  const user = await githubRequest<GitHubUserSummary>('/user');
  const current = getIntegrationAccounts();
  updateIntegrationAccounts({
    github: {
      token: current.github.token,
      defaultRepo: current.github.defaultRepo,
      login: user.login,
      avatarUrl: user.avatar_url,
      profileUrl: user.html_url,
      lastValidatedAt: new Date().toISOString(),
      lastError: '',
    },
  });
  return user;
}

export async function listGitHubRepos(limit = 12) {
  return githubRequest<GitHubRepoSummary[]>(`/user/repos?sort=updated&per_page=${Math.max(1, Math.min(limit, 50))}`);
}

export async function listGitHubNotifications(limit = 12) {
  return githubRequest<GitHubNotificationSummary[]>(`/notifications?all=false&participating=false&per_page=${Math.max(1, Math.min(limit, 50))}`);
}

export async function listGitHubIssues(limit = 12, repoFullName = '') {
  if (repoFullName.trim()) {
    const [owner, repo] = repoFullName.trim().split('/');
    if (!owner || !repo) throw new Error('Repo GitHub invalide, attendu owner/repo');
    return githubRequest<GitHubIssueSummary[]>(`/repos/${owner}/${repo}/issues?state=open&per_page=${Math.max(1, Math.min(limit, 50))}`);
  }
  return githubRequest<GitHubIssueSummary[]>(`/issues?filter=all&state=open&per_page=${Math.max(1, Math.min(limit, 50))}`);
}

export async function createGitHubIssue(repoFullName: string, title: string, body = '') {
  const [owner, repo] = repoFullName.trim().split('/');
  if (!owner || !repo) throw new Error('Repo GitHub invalide, attendu owner/repo');
  return githubRequest<{ html_url: string; number: number }>(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title, body }),
  });
}

export function formatGitHubRepos(repos: GitHubRepoSummary[]) {
  if (!repos.length) return 'OK: aucun repo GitHub';
  return repos.map(repo => `${repo.full_name}${repo.private ? ' [private]' : ''}\n${repo.description || ''}\n${repo.html_url}`).join('\n\n');
}

export function formatGitHubNotifications(items: GitHubNotificationSummary[]) {
  if (!items.length) return 'OK: aucune notification GitHub';
  return items.map(item => `[${item.repository.full_name}] ${item.subject.type} — ${item.subject.title} (${item.reason})`).join('\n');
}

export function formatGitHubIssues(items: GitHubIssueSummary[]) {
  if (!items.length) return 'OK: aucun issue GitHub';
  return items.map(item => `#${item.number} [${item.state}] ${item.title}\n${item.html_url}`).join('\n\n');
}

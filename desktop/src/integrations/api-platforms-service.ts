import { open as openExternal } from '@tauri-apps/plugin-shell';
import { getIntegrationAccounts } from './app-accounts-service';

function safeOpen(url: string) {
  return openExternal(url).catch(() => {
    window.location.href = url;
  });
}

export async function openSlackWorkspace(url = '') {
  const target = url.trim() || getIntegrationAccounts().slack.workspaceUrl.trim() || 'https://app.slack.com/client';
  await safeOpen(target);
  return `OK: Slack ouvert ${target}`;
}

export async function validateSlackWebhook(): Promise<void> {
  const webhookUrl = getIntegrationAccounts().slack.webhookUrl.trim();
  if (!webhookUrl) throw new Error('Slack webhook URL missing');
  if (!/^https:\/\/hooks\.slack\.com\/services\//.test(webhookUrl)) {
    throw new Error('Slack webhook URL invalid (expected https://hooks.slack.com/services/...)');
  }
  // Slack incoming webhooks: empty body → 400 "no_text", invalid URL → 404 "no_service".
  const response = await fetch(webhookUrl, { method: 'POST', body: '' });
  const body = await response.text().catch(() => '');
  if (body === 'no_text') return;
  if (response.ok) return;
  throw new Error(`Slack ${response.status}${body ? `: ${body}` : ''}`);
}

export async function sendSlackWebhookMessage(content: string) {
  const webhookUrl = getIntegrationAccounts().slack.webhookUrl.trim();
  if (!webhookUrl) throw new Error('Webhook Slack local manquant');
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: content }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Slack HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  return 'OK: message Slack envoyé';
}

export async function openTelegramChat(target = '') {
  const accounts = getIntegrationAccounts();
  const username = target.trim() || accounts.telegram.username.trim();
  const url = username ? `https://t.me/${username.replace(/^@/, '')}` : 'https://web.telegram.org/';
  await safeOpen(url);
  return `OK: Telegram ouvert ${url}`;
}

export async function validateTelegramBot(): Promise<{ username: string; first_name: string }> {
  const { telegram } = getIntegrationAccounts();
  const token = telegram.botToken.trim();
  if (!token) throw new Error('Telegram bot token missing');
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  const data = await response.json() as { ok: boolean; result?: { username: string; first_name: string } };
  if (!data.ok || !data.result) throw new Error('Telegram getMe failed');
  return data.result;
}

export async function sendTelegramMessage(text: string) {
  const { telegram } = getIntegrationAccounts();
  if (!telegram.botToken.trim() || !telegram.chatId.trim()) throw new Error('Bot token ou chat id Telegram manquant');
  const response = await fetch(`https://api.telegram.org/bot${telegram.botToken.trim()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: telegram.chatId.trim(), text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Telegram HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  return 'OK: message Telegram envoyé';
}

interface NotionSearchResult {
  id: string;
  url: string;
  object: string;
  properties?: Record<string, any>;
}

async function notionRequest<T>(path: string, body?: Record<string, unknown>) {
  const notion = getIntegrationAccounts().notion;
  if (!notion.token.trim()) throw new Error('Token Notion local manquant');
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${notion.token.trim()}`,
      'Notion-Version': '2022-06-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Notion HTTP ${response.status}${text ? `: ${text}` : ''}`);
  }
  return response.json() as Promise<T>;
}

export async function validateNotionToken(): Promise<{ name: string; type: string }> {
  const result = await notionRequest<{ name?: string; bot?: { owner?: any }; type: string; id: string }>('/users/me');
  return { name: result.name || result.id, type: result.type };
}

export async function searchNotionPages(query: string) {
  const result = await notionRequest<{ results: NotionSearchResult[] }>('/search', {
    query,
    filter: { property: 'object', value: 'page' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  });
  return result.results || [];
}

export async function createNotionPage(title: string, content: string) {
  const notion = getIntegrationAccounts().notion;
  if (!notion.parentPageId.trim()) throw new Error('Parent page id Notion manquant');
  const result = await notionRequest<{ url: string; id: string }>('/pages', {
    parent: { page_id: notion.parentPageId.trim() },
    properties: {
      title: {
        title: [{ text: { content: title } }],
      },
    },
    children: content.trim() ? [{
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content } }],
      },
    }] : [],
  });
  return result;
}

async function dropboxContentRequest(path: string, options: RequestInit) {
  const token = getIntegrationAccounts().dropbox.token.trim();
  if (!token) throw new Error('Token Dropbox local manquant');
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Dropbox HTTP ${response.status}${text ? `: ${text}` : ''}`);
  }
  return response;
}

export async function validateDropboxToken(): Promise<{ email: string; name: string }> {
  const response = await dropboxContentRequest('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
  });
  const data = await response.json() as { email: string; name: { display_name: string } };
  return { email: data.email, name: data.name.display_name };
}

export async function listDropboxFiles(path = '') {
  const defaultPath = getIntegrationAccounts().dropbox.defaultPath.trim() || '';
  const response = await dropboxContentRequest('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path || defaultPath }),
  });
  return response.json() as Promise<{ entries: Array<{ name: string; path_display: string; ['.tag']: string }> }>;
}

export async function uploadDropboxTextFile(path: string, content: string) {
  const defaultBase = getIntegrationAccounts().dropbox.defaultPath.trim() || '/Monkey';
  const normalizedPath = path.startsWith('/') ? path : `${defaultBase.replace(/\/$/, '')}/${path}`;
  const response = await dropboxContentRequest('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: normalizedPath,
        mode: 'overwrite',
        autorename: false,
        mute: false,
      }),
    },
    body: content,
  });
  return response.json() as Promise<{ path_display: string }>;
}

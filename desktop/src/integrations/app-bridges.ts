import { open as openExternal } from '@tauri-apps/plugin-shell';
import { getIntegrationAccounts } from './app-accounts-service';

export function safeOpen(url: string) {
  return openExternal(url).catch(() => {
    window.location.href = url;
  });
}

function encodePhone(phone: string) {
  return phone.replace(/[^\d+]/g, '');
}

export async function composeGmailDraft(input: { to?: string; subject?: string; body?: string }) {
  const accounts = getIntegrationAccounts();
  const to = input.to?.trim() || accounts.gmail.address.trim();
  const params = new URLSearchParams();
  if (to) params.set('to', to);
  if (input.subject?.trim()) params.set('su', input.subject.trim());
  const body = [input.body?.trim() || '', accounts.gmail.signature.trim()].filter(Boolean).join('\n\n');
  if (body) params.set('body', body);
  const url = `https://mail.google.com/mail/?view=cm&fs=1&${params.toString()}`;
  await safeOpen(url);
  return `OK: brouillon Gmail ouvert${to ? ` pour ${to}` : ''}`;
}

export async function sendDiscordWebhookMessage(content: string) {
  const { discord } = getIntegrationAccounts();
  const webhookUrl = discord.webhookUrl.trim();
  if (!webhookUrl) throw new Error('Webhook Discord local manquant');
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: discord.username.trim() || 'MonkeyAgent',
      content,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  return 'OK: message Discord envoyé';
}

export async function validateDiscordWebhook(): Promise<{ name: string; channel_id?: string }> {
  const { discord } = getIntegrationAccounts();
  const webhookUrl = discord.webhookUrl.trim();
  if (!webhookUrl) throw new Error('Webhook Discord URL missing');
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhookUrl)) {
    throw new Error('Webhook Discord URL invalid');
  }
  const response = await fetch(webhookUrl, { method: 'GET' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  return response.json();
}

export async function openDiscordApp(url?: string) {
  const target = url?.trim() || getIntegrationAccounts().discord.defaultUrl.trim() || 'https://discord.com/channels/@me';
  await safeOpen(target);
  return `OK: Discord ouvert ${target}`;
}

export async function composeWhatsAppMessage(input: { phone?: string; text?: string }) {
  const { whatsapp } = getIntegrationAccounts();
  const phone = encodePhone(input.phone?.trim() || whatsapp.defaultPhone.trim());
  if (!phone) throw new Error('Numéro WhatsApp manquant');
  const text = input.text?.trim() || '';
  const url = `https://wa.me/${encodeURIComponent(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  await safeOpen(url);
  return `OK: WhatsApp ouvert pour ${phone}`;
}

export async function openGitHubPage(url = '') {
  const target = url.trim() || 'https://github.com';
  await safeOpen(target);
  return `OK: GitHub ouvert ${target}`;
}

function formatCalendarDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${min}${ss}Z`;
}

export async function composeGoogleCalendarEvent(input: { title?: string; details?: string; start?: string; end?: string }) {
  const base = getIntegrationAccounts().google.calendarUrl.trim() || 'https://calendar.google.com/calendar/u/0/r';
  const params = new URLSearchParams({ action: 'TEMPLATE' });
  if (input.title?.trim()) params.set('text', input.title.trim());
  if (input.details?.trim()) params.set('details', input.details.trim());
  if (input.start) {
    const end = input.end ? formatCalendarDate(input.end) : formatCalendarDate(new Date(new Date(input.start).getTime() + 60 * 60 * 1000).toISOString());
    params.set('dates', `${formatCalendarDate(input.start)}/${end}`);
  }
  const url = `${base.replace(/\/$/, '')}/render?${params.toString()}`;
  await safeOpen(url);
  return 'OK: évènement Google Calendar ouvert';
}

export async function openGoogleDrive(query = '') {
  const base = getIntegrationAccounts().google.driveUrl.trim() || 'https://drive.google.com/drive/my-drive';
  const url = query.trim()
    ? `https://drive.google.com/drive/search?q=${encodeURIComponent(query.trim())}`
    : base;
  await safeOpen(url);
  return `OK: Google Drive ouvert ${url}`;
}

export async function createGoogleDriveDoc(kind: 'doc' | 'sheet' | 'slides' = 'doc') {
  const url = kind === 'sheet'
    ? 'https://sheets.new'
    : kind === 'slides'
      ? 'https://slides.new'
      : 'https://docs.new';
  await safeOpen(url);
  return `OK: nouveau document Google ${kind} ouvert`;
}

export async function openMessengerConversation(handle = '') {
  const target = handle.trim() || getIntegrationAccounts().messenger.handle.trim();
  const url = target ? `https://m.me/${target.replace(/^@/, '')}` : 'https://www.messenger.com/';
  await safeOpen(url);
  return `OK: Messenger ouvert ${url}`;
}

export async function openInstagramTarget(handle = '') {
  const target = handle.trim() || getIntegrationAccounts().instagram.handle.trim();
  const url = target ? `https://www.instagram.com/${target.replace(/^@/, '')}/` : 'https://www.instagram.com/direct/inbox/';
  await safeOpen(url);
  return `OK: Instagram ouvert ${url}`;
}

export async function composeXPost(input: { text?: string; url?: string }) {
  const params = new URLSearchParams();
  if (input.text?.trim()) params.set('text', input.text.trim());
  if (input.url?.trim()) params.set('url', input.url.trim());
  const url = `https://twitter.com/intent/tweet?${params.toString()}`;
  await safeOpen(url);
  return 'OK: composer X ouvert';
}

export async function openLinkedInShare(input: { text?: string; url?: string }) {
  const url = input.url?.trim()
    ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(input.url.trim())}`
    : (getIntegrationAccounts().linkedin.profileUrl.trim() || 'https://www.linkedin.com/feed/');
  await safeOpen(url);
  return `OK: LinkedIn ouvert ${url}`;
}

export async function openZoomMeeting(url = '') {
  const target = url.trim() || getIntegrationAccounts().zoom.meetingUrl.trim() || 'https://zoom.us/meeting/schedule';
  await safeOpen(target);
  return `OK: Zoom ouvert ${target}`;
}

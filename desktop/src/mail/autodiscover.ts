/**
 * Thunderbird ISPDB autodiscover.
 * Resolves IMAP/SMTP host+port+TLS for a given email domain without asking the user.
 * Falls back to common provider patterns when the ISPDB entry is missing.
 */
export interface ServerConfig {
  host: string;
  port: number;
  socket: 'SSL' | 'STARTTLS' | 'plain';
}

export interface MailServerConfig {
  imap: ServerConfig;
  smtp: ServerConfig;
  displayName?: string;
  documentationUrl?: string;
  source: 'ispdb' | 'fallback' | 'manual';
}

const ISPDB_BASE = 'https://autoconfig.thunderbird.net/v1.1/';

// Common provider fallbacks for when ISPDB is offline / unavailable.
const FALLBACKS: Record<string, MailServerConfig> = {
  'gmail.com': {
    imap: { host: 'imap.gmail.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.gmail.com', port: 465, socket: 'SSL' },
    displayName: 'Gmail',
    documentationUrl: 'https://myaccount.google.com/apppasswords',
    source: 'fallback',
  },
  'googlemail.com': {
    imap: { host: 'imap.gmail.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.gmail.com', port: 465, socket: 'SSL' },
    displayName: 'Gmail',
    documentationUrl: 'https://myaccount.google.com/apppasswords',
    source: 'fallback',
  },
  'outlook.com': {
    imap: { host: 'outlook.office365.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.office365.com', port: 587, socket: 'STARTTLS' },
    displayName: 'Outlook',
    source: 'fallback',
  },
  'hotmail.com': {
    imap: { host: 'outlook.office365.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.office365.com', port: 587, socket: 'STARTTLS' },
    displayName: 'Outlook',
    source: 'fallback',
  },
  'live.com': {
    imap: { host: 'outlook.office365.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.office365.com', port: 587, socket: 'STARTTLS' },
    displayName: 'Outlook',
    source: 'fallback',
  },
  'icloud.com': {
    imap: { host: 'imap.mail.me.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.mail.me.com', port: 587, socket: 'STARTTLS' },
    displayName: 'iCloud',
    documentationUrl: 'https://appleid.apple.com/account/manage',
    source: 'fallback',
  },
  'me.com': {
    imap: { host: 'imap.mail.me.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.mail.me.com', port: 587, socket: 'STARTTLS' },
    displayName: 'iCloud',
    source: 'fallback',
  },
  'yahoo.com': {
    imap: { host: 'imap.mail.yahoo.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, socket: 'SSL' },
    displayName: 'Yahoo',
    documentationUrl: 'https://login.yahoo.com/account/security',
    source: 'fallback',
  },
  'free.fr': {
    imap: { host: 'imap.free.fr', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.free.fr', port: 465, socket: 'SSL' },
    displayName: 'Free',
    source: 'fallback',
  },
  'orange.fr': {
    imap: { host: 'imap.orange.fr', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.orange.fr', port: 465, socket: 'SSL' },
    displayName: 'Orange',
    source: 'fallback',
  },
  'laposte.net': {
    imap: { host: 'imap.laposte.net', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.laposte.net', port: 465, socket: 'SSL' },
    displayName: 'La Poste',
    source: 'fallback',
  },
  'fastmail.com': {
    imap: { host: 'imap.fastmail.com', port: 993, socket: 'SSL' },
    smtp: { host: 'smtp.fastmail.com', port: 465, socket: 'SSL' },
    displayName: 'Fastmail',
    source: 'fallback',
  },
  'protonmail.com': {
    imap: { host: '127.0.0.1', port: 1143, socket: 'STARTTLS' },
    smtp: { host: '127.0.0.1', port: 1025, socket: 'STARTTLS' },
    displayName: 'ProtonMail (Bridge requis)',
    documentationUrl: 'https://proton.me/mail/bridge',
    source: 'fallback',
  },
};

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : '';
}

function pickSocket(s?: string): 'SSL' | 'STARTTLS' | 'plain' {
  if (!s) return 'SSL';
  const v = s.toUpperCase();
  if (v === 'SSL' || v === 'TLS') return 'SSL';
  if (v === 'STARTTLS') return 'STARTTLS';
  return 'plain';
}

async function fetchIspdb(domain: string, signal: AbortSignal): Promise<MailServerConfig | null> {
  try {
    const res = await fetch(`${ISPDB_BASE}${encodeURIComponent(domain)}`, { signal });
    if (!res.ok) return null;
    const xml = await res.text();
    return parseIspdbXml(xml);
  } catch {
    return null;
  }
}

function parseIspdbXml(xml: string): MailServerConfig | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;

  const imapNode = Array.from(doc.querySelectorAll('incomingServer')).find(
    n => n.getAttribute('type') === 'imap',
  );
  const smtpNode = Array.from(doc.querySelectorAll('outgoingServer')).find(
    n => n.getAttribute('type') === 'smtp',
  );
  if (!imapNode || !smtpNode) return null;

  const get = (node: Element, tag: string) => node.querySelector(tag)?.textContent?.trim() || '';
  const imap: ServerConfig = {
    host: get(imapNode, 'hostname'),
    port: parseInt(get(imapNode, 'port'), 10) || 993,
    socket: pickSocket(get(imapNode, 'socketType')),
  };
  const smtp: ServerConfig = {
    host: get(smtpNode, 'hostname'),
    port: parseInt(get(smtpNode, 'port'), 10) || 587,
    socket: pickSocket(get(smtpNode, 'socketType')),
  };
  if (!imap.host || !smtp.host) return null;

  const displayName = doc.querySelector('displayName')?.textContent?.trim();
  const documentationUrl = doc.querySelector('documentation')?.getAttribute('url') || undefined;

  return { imap, smtp, displayName, documentationUrl, source: 'ispdb' };
}

export async function autodiscover(email: string, timeoutMs = 4000): Promise<MailServerConfig | null> {
  const domain = domainOf(email);
  if (!domain) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const ispdb = await fetchIspdb(domain, ctl.signal);
    if (ispdb) return ispdb;
  } finally {
    clearTimeout(timer);
  }

  const fb = FALLBACKS[domain];
  if (fb) return fb;
  return null;
}

export function isGmailDomain(email: string): boolean {
  const d = domainOf(email);
  return d === 'gmail.com' || d === 'googlemail.com';
}

/** True when the resolved IMAP host points to Google infra (gmail.com / google.com).
 *  Covers Google Workspace accounts on custom domains where the email itself
 *  is not @gmail.com but autodiscover returns imap.gmail.com. */
export function isGoogleConfig(config: MailServerConfig | null | undefined): boolean {
  const host = (config?.imap?.host || '').toLowerCase();
  if (!host) return false;
  return /(^|\.)(gmail|google)\.com$/.test(host);
}

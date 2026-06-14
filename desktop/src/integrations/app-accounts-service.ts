import { createLocalStore } from '../lib/local-store';

export interface GitHubAccountState {
  token: string;
  defaultRepo: string;
  login: string;
  avatarUrl: string;
  profileUrl: string;
  lastValidatedAt: string;
  lastError: string;
}

export interface GmailAccountState {
  address: string;
  signature: string;
}

export interface GoogleAccountState {
  calendarUrl: string;
  driveUrl: string;
}

export interface DiscordAccountState {
  webhookUrl: string;
  defaultUrl: string;
  username: string;
}

export interface SlackAccountState {
  webhookUrl: string;
  workspaceUrl: string;
}

export interface TelegramAccountState {
  botToken: string;
  chatId: string;
  username: string;
}

export interface NotionAccountState {
  token: string;
  parentPageId: string;
  workspaceUrl: string;
}

export interface DropboxAccountState {
  token: string;
  defaultPath: string;
  appUrl: string;
}

export interface ShortcutAccountState {
  token: string;
  appUrl: string;
  defaultWorkflowStateId: string;
  lastValidatedAt: string;
  lastError: string;
}

export interface WhatsAppAccountState {
  defaultPhone: string;
}

export interface MessengerAccountState {
  handle: string;
}

export interface InstagramAccountState {
  handle: string;
}

export interface XAccountState {
  handle: string;
}

export interface LinkedInAccountState {
  profileUrl: string;
}

export interface ZoomAccountState {
  meetingUrl: string;
}

export interface IntegrationAccountsState {
  github: GitHubAccountState;
  gmail: GmailAccountState;
  google: GoogleAccountState;
  discord: DiscordAccountState;
  slack: SlackAccountState;
  telegram: TelegramAccountState;
  notion: NotionAccountState;
  dropbox: DropboxAccountState;
  shortcut: ShortcutAccountState;
  whatsapp: WhatsAppAccountState;
  messenger: MessengerAccountState;
  instagram: InstagramAccountState;
  x: XAccountState;
  linkedin: LinkedInAccountState;
  zoom: ZoomAccountState;
}

const DEFAULT_ACCOUNTS: IntegrationAccountsState = {
  github: {
    token: '',
    defaultRepo: '',
    login: '',
    avatarUrl: '',
    profileUrl: '',
    lastValidatedAt: '',
    lastError: '',
  },
  gmail: {
    address: '',
    signature: '',
  },
  google: {
    calendarUrl: 'https://calendar.google.com/calendar/u/0/r',
    driveUrl: 'https://drive.google.com/drive/my-drive',
  },
  discord: {
    webhookUrl: '',
    defaultUrl: 'https://discord.com/channels/@me',
    username: '',
  },
  slack: {
    webhookUrl: '',
    workspaceUrl: 'https://app.slack.com/client',
  },
  telegram: {
    botToken: '',
    chatId: '',
    username: '',
  },
  notion: {
    token: '',
    parentPageId: '',
    workspaceUrl: 'https://www.notion.so',
  },
  dropbox: {
    token: '',
    defaultPath: '/Monkey',
    appUrl: 'https://www.dropbox.com/home',
  },
  shortcut: {
    token: '',
    appUrl: 'https://app.shortcut.com',
    defaultWorkflowStateId: '',
    lastValidatedAt: '',
    lastError: '',
  },
  whatsapp: {
    defaultPhone: '',
  },
  messenger: {
    handle: '',
  },
  instagram: {
    handle: '',
  },
  x: {
    handle: '',
  },
  linkedin: {
    profileUrl: 'https://www.linkedin.com/feed/',
  },
  zoom: {
    meetingUrl: 'https://zoom.us/meeting/schedule',
  },
};

const store = createLocalStore<IntegrationAccountsState>('monkey-integration-accounts', DEFAULT_ACCOUNTS);

export function getIntegrationAccounts() {
  return store.read();
}

export function updateIntegrationAccounts(patch: Partial<IntegrationAccountsState>) {
  return store.update(prev => ({
    ...prev,
    ...patch,
    github: { ...prev.github, ...(patch.github || {}) },
    gmail: { ...prev.gmail, ...(patch.gmail || {}) },
    google: { ...prev.google, ...(patch.google || {}) },
    discord: { ...prev.discord, ...(patch.discord || {}) },
    slack: { ...prev.slack, ...(patch.slack || {}) },
    telegram: { ...prev.telegram, ...(patch.telegram || {}) },
    notion: { ...prev.notion, ...(patch.notion || {}) },
    dropbox: { ...prev.dropbox, ...(patch.dropbox || {}) },
    shortcut: { ...prev.shortcut, ...(patch.shortcut || {}) },
    whatsapp: { ...prev.whatsapp, ...(patch.whatsapp || {}) },
    messenger: { ...prev.messenger, ...(patch.messenger || {}) },
    instagram: { ...prev.instagram, ...(patch.instagram || {}) },
    x: { ...prev.x, ...(patch.x || {}) },
    linkedin: { ...prev.linkedin, ...(patch.linkedin || {}) },
    zoom: { ...prev.zoom, ...(patch.zoom || {}) },
  }));
}

export function subscribeIntegrationAccounts(listener: (value: IntegrationAccountsState) => void) {
  return store.subscribe(listener);
}

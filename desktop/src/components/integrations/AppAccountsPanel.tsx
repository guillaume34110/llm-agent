import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationAccountsState } from '../../integrations/app-accounts-service';
import { validateGitHubAccount } from '../../integrations/github-service';
import { validateShortcutAccount } from '../../integrations/shortcut-service';
import { validateDiscordWebhook } from '../../integrations/app-bridges';
import {
  validateSlackWebhook,
  validateTelegramBot,
  validateNotionToken,
  validateDropboxToken,
} from '../../integrations/api-platforms-service';

interface Props {
  accounts: IntegrationAccountsState;
  onUpdate: (patch: Partial<IntegrationAccountsState>) => void;
}

type TestKey = 'github' | 'shortcut' | 'discord' | 'slack' | 'telegram' | 'notion' | 'dropbox';

interface TestState {
  loading: boolean;
  ok: boolean;
  message: string;
}

const INITIAL_TEST: TestState = { loading: false, ok: false, message: '' };

export default function AppAccountsPanel({ accounts, onUpdate }: Props) {
  const { t } = useTranslation();
  const [tests, setTests] = useState<Record<TestKey, TestState>>({
    github: INITIAL_TEST,
    shortcut: INITIAL_TEST,
    discord: INITIAL_TEST,
    slack: INITIAL_TEST,
    telegram: INITIAL_TEST,
    notion: INITIAL_TEST,
    dropbox: INITIAL_TEST,
  });

  const runTest = async (key: TestKey, fn: () => Promise<string>) => {
    setTests(s => ({ ...s, [key]: { loading: true, ok: false, message: '' } }));
    try {
      const message = await fn();
      setTests(s => ({ ...s, [key]: { loading: false, ok: true, message } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTests(s => ({ ...s, [key]: { loading: false, ok: false, message } }));
    }
  };

  const checkGitHub = () => runTest('github', async () => {
    const user = await validateGitHubAccount();
    onUpdate({ github: { login: user.login } as IntegrationAccountsState['github'] });
    return t('integrations.appAccounts.connectedUser', { user: user.login });
  });

  const checkShortcut = () => runTest('shortcut', async () => {
    const workflows = await validateShortcutAccount();
    return t('integrations.appAccounts.connectedWorkflows', { count: workflows.length });
  });

  const checkDiscord = () => runTest('discord', async () => {
    const hook = await validateDiscordWebhook();
    return t('integrations.appAccounts.connectedDiscord', { name: hook.name || 'webhook' });
  });

  const checkSlack = () => runTest('slack', async () => {
    await validateSlackWebhook();
    return t('integrations.appAccounts.connectedSlack');
  });

  const checkTelegram = () => runTest('telegram', async () => {
    const bot = await validateTelegramBot();
    return t('integrations.appAccounts.connectedTelegram', { username: bot.username });
  });

  const checkNotion = () => runTest('notion', async () => {
    const me = await validateNotionToken();
    return t('integrations.appAccounts.connectedNotion', { name: me.name });
  });

  const checkDropbox = () => runTest('dropbox', async () => {
    const me = await validateDropboxToken();
    return t('integrations.appAccounts.connectedDropbox', { email: me.email });
  });

  const renderTestRow = (key: TestKey, labelKey: string, onClick: () => void, disabled: boolean, fallbackStatus: string) => {
    const s = tests[key];
    const statusText = s.message || fallbackStatus || t('integrations.appAccounts.notConnected');
    const color = s.message
      ? (s.ok ? 'var(--accent)' : 'var(--red)')
      : (fallbackStatus ? 'var(--accent)' : 'var(--text-dim)');
    return (
      <div className="flex gap-2.5 items-center flex-wrap">
        <button
          onClick={onClick}
          disabled={s.loading || disabled}
          className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold font-[Nunito] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {s.loading ? t('integrations.appAccounts.connecting') : t(labelKey)}
        </button>
        <span className="text-[11.5px]" style={{ color }}>{statusText}</span>
      </div>
    );
  };

  const inputCls = 'rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]';

  return (
    <section className="border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
      <div className="text-[13.5px] font-black text-[var(--text)]">{t('integrations.appAccounts.title')}</div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
        {t('integrations.appAccounts.description')}
      </div>

      <div className="mt-3.5 grid gap-4">
        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Google</div>
          <input
            value={accounts.google.calendarUrl}
            onChange={e => onUpdate({ google: { calendarUrl: e.target.value } as IntegrationAccountsState['google'] })}
            placeholder={t('integrations.appAccounts.googleCalendarPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.google.driveUrl}
            onChange={e => onUpdate({ google: { driveUrl: e.target.value } as IntegrationAccountsState['google'] })}
            placeholder={t('integrations.appAccounts.googleDrivePlaceholder')}
            className={inputCls}
          />
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">GitHub</div>
          <input
            type="password"
            value={accounts.github.token}
            onChange={e => onUpdate({ github: { token: e.target.value } as IntegrationAccountsState['github'] })}
            placeholder={t('integrations.appAccounts.githubTokenPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.github.defaultRepo}
            onChange={e => onUpdate({ github: { defaultRepo: e.target.value } as IntegrationAccountsState['github'] })}
            placeholder={t('integrations.appAccounts.defaultRepoPlaceholder')}
            className={inputCls}
          />
          {renderTestRow(
            'github',
            'integrations.appAccounts.testGitHub',
            checkGitHub,
            !accounts.github.token.trim(),
            accounts.github.login ? t('integrations.appAccounts.user', { user: accounts.github.login }) : '',
          )}
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Shortcut</div>
          <input
            type="password"
            value={accounts.shortcut.token}
            onChange={e => onUpdate({ shortcut: { token: e.target.value } as IntegrationAccountsState['shortcut'] })}
            placeholder={t('integrations.appAccounts.shortcutTokenPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.shortcut.appUrl}
            onChange={e => onUpdate({ shortcut: { appUrl: e.target.value } as IntegrationAccountsState['shortcut'] })}
            placeholder={t('integrations.appAccounts.shortcutAppUrlPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.shortcut.defaultWorkflowStateId}
            onChange={e => onUpdate({ shortcut: { defaultWorkflowStateId: e.target.value } as IntegrationAccountsState['shortcut'] })}
            placeholder={t('integrations.appAccounts.defaultWorkflowStatePlaceholder')}
            className={inputCls}
          />
          {renderTestRow(
            'shortcut',
            'integrations.appAccounts.testShortcut',
            checkShortcut,
            !accounts.shortcut.token.trim(),
            accounts.shortcut.lastValidatedAt ? t('integrations.appAccounts.validated', { date: new Date(accounts.shortcut.lastValidatedAt).toLocaleString() }) : '',
          )}
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Gmail</div>
          <input
            value={accounts.gmail.address}
            onChange={e => onUpdate({ gmail: { address: e.target.value } as IntegrationAccountsState['gmail'] })}
            placeholder={t('integrations.appAccounts.gmailAddressPlaceholder')}
            className={inputCls}
          />
          <textarea
            value={accounts.gmail.signature}
            onChange={e => onUpdate({ gmail: { signature: e.target.value } as IntegrationAccountsState['gmail'] })}
            rows={3}
            placeholder={t('integrations.appAccounts.signaturePlaceholder')}
            className={`${inputCls} resize-y`}
          />
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Discord</div>
          <input
            value={accounts.discord.webhookUrl}
            onChange={e => onUpdate({ discord: { webhookUrl: e.target.value } as IntegrationAccountsState['discord'] })}
            placeholder={t('integrations.appAccounts.discordWebhookPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.discord.defaultUrl}
            onChange={e => onUpdate({ discord: { defaultUrl: e.target.value } as IntegrationAccountsState['discord'] })}
            placeholder={t('integrations.appAccounts.discordDefaultUrlPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.discord.username}
            onChange={e => onUpdate({ discord: { username: e.target.value } as IntegrationAccountsState['discord'] })}
            placeholder={t('integrations.appAccounts.discordUsernamePlaceholder')}
            className={inputCls}
          />
          {renderTestRow('discord', 'integrations.appAccounts.testDiscord', checkDiscord, !accounts.discord.webhookUrl.trim(), '')}
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Slack</div>
          <input
            value={accounts.slack.webhookUrl}
            onChange={e => onUpdate({ slack: { webhookUrl: e.target.value } as IntegrationAccountsState['slack'] })}
            placeholder={t('integrations.appAccounts.slackWebhookPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.slack.workspaceUrl}
            onChange={e => onUpdate({ slack: { workspaceUrl: e.target.value } as IntegrationAccountsState['slack'] })}
            placeholder={t('integrations.appAccounts.slackWorkspacePlaceholder')}
            className={inputCls}
          />
          {renderTestRow('slack', 'integrations.appAccounts.testSlack', checkSlack, !accounts.slack.webhookUrl.trim(), '')}
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Telegram</div>
          <input
            type="password"
            value={accounts.telegram.botToken}
            onChange={e => onUpdate({ telegram: { botToken: e.target.value } as IntegrationAccountsState['telegram'] })}
            placeholder={t('integrations.appAccounts.telegramTokenPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.telegram.chatId}
            onChange={e => onUpdate({ telegram: { chatId: e.target.value } as IntegrationAccountsState['telegram'] })}
            placeholder={t('integrations.appAccounts.telegramChatIdPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.telegram.username}
            onChange={e => onUpdate({ telegram: { username: e.target.value } as IntegrationAccountsState['telegram'] })}
            placeholder={t('integrations.appAccounts.telegramUsernamePlaceholder')}
            className={inputCls}
          />
          {renderTestRow('telegram', 'integrations.appAccounts.testTelegram', checkTelegram, !accounts.telegram.botToken.trim(), '')}
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Notion</div>
          <input
            type="password"
            value={accounts.notion.token}
            onChange={e => onUpdate({ notion: { token: e.target.value } as IntegrationAccountsState['notion'] })}
            placeholder={t('integrations.appAccounts.notionTokenPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.notion.parentPageId}
            onChange={e => onUpdate({ notion: { parentPageId: e.target.value } as IntegrationAccountsState['notion'] })}
            placeholder={t('integrations.appAccounts.notionParentPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.notion.workspaceUrl}
            onChange={e => onUpdate({ notion: { workspaceUrl: e.target.value } as IntegrationAccountsState['notion'] })}
            placeholder={t('integrations.appAccounts.notionWorkspacePlaceholder')}
            className={inputCls}
          />
          {renderTestRow('notion', 'integrations.appAccounts.testNotion', checkNotion, !accounts.notion.token.trim(), '')}
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Dropbox</div>
          <input
            type="password"
            value={accounts.dropbox.token}
            onChange={e => onUpdate({ dropbox: { token: e.target.value } as IntegrationAccountsState['dropbox'] })}
            placeholder={t('integrations.appAccounts.dropboxTokenPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.dropbox.defaultPath}
            onChange={e => onUpdate({ dropbox: { defaultPath: e.target.value } as IntegrationAccountsState['dropbox'] })}
            placeholder={t('integrations.appAccounts.dropboxFolderPlaceholder')}
            className={inputCls}
          />
          <input
            value={accounts.dropbox.appUrl}
            onChange={e => onUpdate({ dropbox: { appUrl: e.target.value } as IntegrationAccountsState['dropbox'] })}
            placeholder={t('integrations.appAccounts.dropboxAppUrlPlaceholder')}
            className={inputCls}
          />
          {renderTestRow('dropbox', 'integrations.appAccounts.testDropbox', checkDropbox, !accounts.dropbox.token.trim(), '')}
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">WhatsApp</div>
          <input
            value={accounts.whatsapp.defaultPhone}
            onChange={e => onUpdate({ whatsapp: { defaultPhone: e.target.value } as IntegrationAccountsState['whatsapp'] })}
            placeholder={t('integrations.appAccounts.phoneNumberPlaceholder')}
            className={inputCls}
          />
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Messenger</div>
          <input
            value={accounts.messenger.handle}
            onChange={e => onUpdate({ messenger: { handle: e.target.value } as IntegrationAccountsState['messenger'] })}
            placeholder={t('integrations.appAccounts.messengerHandlePlaceholder')}
            className={inputCls}
          />
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Instagram</div>
          <input
            value={accounts.instagram.handle}
            onChange={e => onUpdate({ instagram: { handle: e.target.value } as IntegrationAccountsState['instagram'] })}
            placeholder={t('integrations.appAccounts.instagramHandlePlaceholder')}
            className={inputCls}
          />
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">X / Twitter</div>
          <input
            value={accounts.x.handle}
            onChange={e => onUpdate({ x: { handle: e.target.value } as IntegrationAccountsState['x'] })}
            placeholder={t('integrations.appAccounts.xHandlePlaceholder')}
            className={inputCls}
          />
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">LinkedIn</div>
          <input
            value={accounts.linkedin.profileUrl}
            onChange={e => onUpdate({ linkedin: { profileUrl: e.target.value } as IntegrationAccountsState['linkedin'] })}
            placeholder={t('integrations.appAccounts.linkedinUrlPlaceholder')}
            className={inputCls}
          />
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] font-extrabold text-[var(--text)]">Zoom</div>
          <input
            value={accounts.zoom.meetingUrl}
            onChange={e => onUpdate({ zoom: { meetingUrl: e.target.value } as IntegrationAccountsState['zoom'] })}
            placeholder={t('integrations.appAccounts.zoomUrlPlaceholder')}
            className={inputCls}
          />
        </div>
      </div>
    </section>
  );
}

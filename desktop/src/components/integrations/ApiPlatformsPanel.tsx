import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationAccountsState } from '../../integrations/app-accounts-service';
import {
  createNotionPage,
  listDropboxFiles,
  openSlackWorkspace,
  openTelegramChat,
  searchNotionPages,
  sendSlackWebhookMessage,
  sendTelegramMessage,
  uploadDropboxTextFile,
} from '../../integrations/api-platforms-service';

interface Props {
  accounts: IntegrationAccountsState;
}

export default function ApiPlatformsPanel({ accounts }: Props) {
  const { t } = useTranslation();
  const [slackMessage, setSlackMessage] = useState('');
  const [telegramMessage, setTelegramMessage] = useState('');
  const [notionQuery, setNotionQuery] = useState('');
  const [notionTitle, setNotionTitle] = useState('');
  const [notionContent, setNotionContent] = useState('');
  const [dropboxPath, setDropboxPath] = useState('');
  const [dropboxContent, setDropboxContent] = useState('');
  const [status, setStatus] = useState('');

  const wrap = async (fn: () => Promise<any>) => {
    try {
      const result = await fn();
      if (typeof result === 'string') setStatus(result);
      else if (Array.isArray(result)) setStatus(result.map(item => JSON.stringify(item)).join('\n'));
      else setStatus(JSON.stringify(result, null, 2));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
      <div className="text-[13.5px] font-black text-[var(--text)]">{t('integrations.apiPlatforms.title')}</div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
        {t('integrations.apiPlatforms.description')}
      </div>

      <div className="mt-3.5 grid gap-4">
        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Slack</div>
          <textarea value={slackMessage} onChange={event => setSlackMessage(event.target.value)} rows={3} placeholder={t('integrations.apiPlatforms.slackPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <div className="flex gap-2.5">
            <button onClick={() => void wrap(() => openSlackWorkspace(accounts.slack.workspaceUrl))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.apiPlatforms.openSlack')}</button>
            <button onClick={() => void wrap(() => sendSlackWebhookMessage(slackMessage))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold">{t('common.save')}</button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Telegram</div>
          <textarea value={telegramMessage} onChange={event => setTelegramMessage(event.target.value)} rows={3} placeholder={t('integrations.apiPlatforms.telegramPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <div className="flex gap-2.5">
            <button onClick={() => void wrap(() => openTelegramChat(accounts.telegram.username))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.apiPlatforms.openTelegram')}</button>
            <button onClick={() => void wrap(() => sendTelegramMessage(telegramMessage))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold">{t('common.save')}</button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Notion</div>
          <input value={notionQuery} onChange={event => setNotionQuery(event.target.value)} placeholder={t('integrations.apiPlatforms.notionSearchPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <div className="flex gap-2.5">
            <button onClick={() => void wrap(() => searchNotionPages(notionQuery))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('common.search')}</button>
          </div>
          <input value={notionTitle} onChange={event => setNotionTitle(event.target.value)} placeholder={t('integrations.apiPlatforms.notionTitlePlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <textarea value={notionContent} onChange={event => setNotionContent(event.target.value)} rows={3} placeholder={t('integrations.apiPlatforms.notionContentPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <button onClick={() => void wrap(() => createNotionPage(notionTitle, notionContent))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold">{t('integrations.apiPlatforms.createPage')}</button>
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Dropbox</div>
          <input value={dropboxPath} onChange={event => setDropboxPath(event.target.value)} placeholder={t('integrations.apiPlatforms.dropboxPathPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <textarea value={dropboxContent} onChange={event => setDropboxContent(event.target.value)} rows={3} placeholder={t('integrations.apiPlatforms.dropboxContentPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <div className="flex gap-2.5">
            <button onClick={() => void wrap(async () => (await listDropboxFiles(dropboxPath)).entries.map(entry => entry.path_display || entry.name).join('\n'))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.apiPlatforms.list')}</button>
            <button onClick={() => void wrap(() => uploadDropboxTextFile(dropboxPath, dropboxContent))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold">{t('integrations.apiPlatforms.upload')}</button>
          </div>
        </div>

        {status && (
          <pre className="m-0 whitespace-pre-wrap border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] text-[11.5px] leading-relaxed px-3.5 py-3" style={{ color: status.startsWith('OK:') ? 'var(--accent)' : 'var(--text)' }}>
            {status}
          </pre>
        )}
      </div>
    </section>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open, save } from '@tauri-apps/plugin-dialog';
import { enqueueJob } from '../jobs/job-service';
import { getContacts, saveContact, subscribeContacts, deleteContact, type ContactEntry } from '../integrations/contacts-service';
import { getRecentFiles, subscribeRecentFiles, type RecentFileEntry } from '../integrations/recent-files-service';
import { getIntegrationAccounts, subscribeIntegrationAccounts, updateIntegrationAccounts } from '../integrations/app-accounts-service';
import { composeGmailDraft } from '../integrations/app-bridges';
import { knowledgeService } from '../memory/knowledge.service';
import { pushToast } from '../notifications/notification-center';
import AppAccountsPanel from './integrations/AppAccountsPanel';
import ApiPlatformsPanel from './integrations/ApiPlatformsPanel';
import ConsumerPlatformsPanel from './integrations/ConsumerPlatformsPanel';
import GitHubPanel from './integrations/GitHubPanel';
import MessagingBridgePanel from './integrations/MessagingBridgePanel';
import ShortcutPanel from './integrations/ShortcutPanel';

type Tab = 'comptes' | 'donnees' | 'actions';

function blankContact(): ContactEntry {
  const now = new Date().toISOString();
  return {
    id: '',
    fullName: '',
    emails: [''],
    phones: [''],
    notes: '',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  };
}

const TABS_CONFIG: { id: Tab; labelKey: string }[] = [
  { id: 'comptes', labelKey: 'integrations.tabs.accounts' },
  { id: 'donnees', labelKey: 'integrations.tabs.data' },
  { id: 'actions', labelKey: 'integrations.tabs.actions' },
];

const inputStyle = 'rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] text-[13px]';

const primaryBtn = 'border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3.5 py-2 cursor-pointer font-extrabold font-[Nunito] text-[12.5px]';

const ghostBtn = 'border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2 cursor-pointer font-bold font-[Nunito] text-[12px]';

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-extrabold text-[var(--text)] uppercase tracking-[0.06em]">{title}</div>
          {hint && <div className="mt-0.5 text-[11.5px] text-[var(--text-dim)]">{hint}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function IntegrationsView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('comptes');
  const [accounts, setAccounts] = useState(getIntegrationAccounts());
  const [contacts, setContacts] = useState(getContacts());
  const [recentFiles, setRecentFiles] = useState(getRecentFiles());
  const [draft, setDraft] = useState<ContactEntry | null>(null);
  const [mailTo, setMailTo] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [mailBody, setMailBody] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');

  useEffect(() => subscribeIntegrationAccounts(setAccounts), []);
  useEffect(() => subscribeContacts(setContacts), []);
  useEffect(() => subscribeRecentFiles(setRecentFiles), []);
  useEffect(() => {
    if (!mailTo.trim() && accounts.gmail.address.trim()) setMailTo(accounts.gmail.address.trim());
  }, [accounts.gmail.address]);

  const frequentRecipients = useMemo(
    () => contacts.flatMap(contact => contact.emails.map(email => ({ email, name: contact.fullName }))),
    [contacts]
  );

  const importContactsFile = async () => {
    const selected = await open({ multiple: false, directory: false, title: t('integrations.importContactsTitle'), filters: [{ name: t('integrations.contacts'), extensions: ['vcf', 'csv'] }] });
    if (!selected || Array.isArray(selected)) return;
    enqueueJob('import-contacts', 'Import contacts', { path: String(selected) });
  };
  const exportContactsFile = async () => {
    const path = await save({ title: t('integrations.exportContactsTitle'), defaultPath: 'contacts.vcf' });
    if (!path) return;
    enqueueJob('export-contacts', 'Export contacts', { path });
  };
  const importCalendar = async () => {
    const selected = await open({ multiple: false, directory: false, title: t('integrations.importCalendarTitle'), filters: [{ name: t('integrations.calendar'), extensions: ['ics'] }] });
    if (!selected || Array.isArray(selected)) return;
    enqueueJob('import-calendar', 'Import calendrier', { path: String(selected) });
  };
  const exportCalendar = async () => {
    const path = await save({ title: t('integrations.exportCalendarTitle'), defaultPath: 'agent-calendar.ics' });
    if (!path) return;
    enqueueJob('export-calendar', 'Export calendrier', { path });
  };

  const saveCurrentContact = () => {
    if (!draft || !draft.fullName.trim()) return;
    saveContact({
      id: draft.id || undefined,
      fullName: draft.fullName,
      emails: draft.emails,
      phones: draft.phones,
      notes: draft.notes,
      source: draft.id ? draft.source : 'manual',
    });
    setDraft(null);
  };

  const openMailDraft = async () => {
    await composeGmailDraft({ to: mailTo, subject: mailSubject, body: mailBody });
  };

  const saveNote = async () => {
    if (!noteTitle.trim() || !noteBody.trim()) return;
    await knowledgeService.addDocument({
      title: noteTitle.trim(),
      rawText: noteBody.trim(),
      source: 'note',
      mimeType: 'text/markdown',
      tags: ['note'],
    });
    setNoteTitle('');
    setNoteBody('');
    pushToast({ title: t('integrations.noteSaved'), body: t('integrations.addedToLibrary'), tone: 'success' });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--bg)]">
      {/* Header + tabs */}
      <div className="px-6 pt-4.5 border-b border-[var(--border)]">
        <div className="text-[18px] font-black text-[var(--text)]">{t('integrations.heading')}</div>
        <div className="mt-0.5 text-[12px] text-[var(--text-dim)]">{t('integrations.description')}</div>
        <div className="mt-3.5 flex gap-1">
          {TABS_CONFIG.map(tabConfig => {
            const active = tab === tabConfig.id;
            return (
              <button
                key={tabConfig.id}
                onClick={() => setTab(tabConfig.id)}
                className={`border-0 bg-transparent cursor-pointer px-3.5 py-2 font-[Nunito] text-[13px] -mb-0.25 ${
                  active
                    ? 'border-b-2 border-b-[var(--accent)] text-[var(--text)] font-extrabold'
                    : 'border-b-2 border-b-transparent text-[var(--text-muted)] font-semibold'
                }`}
              >
                {t(tabConfig.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="max-w-[720px] mx-auto grid gap-6">
          {tab === 'comptes' && (
            <AppAccountsPanel accounts={accounts} onUpdate={updateIntegrationAccounts} />
          )}

          {tab === 'donnees' && (
            <>
              <Section
                title={t('integrations.contacts')}
                hint={t('integrations.contactsHint')}
                action={
                  <div className="flex gap-1.5">
                    <button onClick={importContactsFile} className={ghostBtn}>{t('integrations.import')}</button>
                    <button onClick={exportContactsFile} className={ghostBtn}>{t('integrations.export')}</button>
                    <button onClick={() => setDraft(blankContact())} className={primaryBtn}>+ {t('integrations.new')}</button>
                  </div>
                }
              >
                {contacts.length === 0 && (
                  <div className="text-[12.5px] text-[var(--text-dim)] py-2">{t('integrations.noContacts')}</div>
                )}
                {contacts.length > 0 && (
                  <div className="grid gap-1">
                    {contacts.slice(0, 12).map(contact => (
                      <button
                        key={contact.id}
                        onClick={() => setDraft(contact)}
                        className="text-left border-0 bg-transparent border-b border-[var(--border)] px-1 py-2.5 cursor-pointer flex items-baseline gap-3"
                      >
                        <div className="text-[13px] text-[var(--text)] font-bold flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{contact.fullName}</div>
                        <div className="text-[11.5px] text-[var(--text-dim)] overflow-hidden text-ellipsis whitespace-nowrap">
                          {contact.emails[0] || contact.phones[0] || '—'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {draft && (
                  <div className="mt-2 p-3.5 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg2)] grid gap-2.5">
                    <input value={draft.fullName} onChange={e => setDraft(prev => prev && ({ ...prev, fullName: e.target.value }))} placeholder={t('integrations.fullName')} className={inputStyle} />
                    <input value={draft.emails[0] || ''} onChange={e => setDraft(prev => prev && ({ ...prev, emails: [e.target.value] }))} placeholder={t('integrations.email')} className={inputStyle} />
                    <input value={draft.phones[0] || ''} onChange={e => setDraft(prev => prev && ({ ...prev, phones: [e.target.value] }))} placeholder={t('integrations.phone')} className={inputStyle} />
                    <textarea value={draft.notes} onChange={e => setDraft(prev => prev && ({ ...prev, notes: e.target.value }))} rows={3} placeholder={t('integrations.notes')} className={inputStyle + ' resize-y'} />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setDraft(null)} className={ghostBtn}>{t('common.cancel')}</button>
                      {draft.id && (
                        <button onClick={() => { deleteContact(draft.id); setDraft(null); }} className={ghostBtn + ' text-[var(--red)] border-[var(--red-soft)]'}>{t('common.delete')}</button>
                      )}
                      <button onClick={saveCurrentContact} className={primaryBtn}>{t('common.save')}</button>
                    </div>
                  </div>
                )}
              </Section>

              <Section
                title={t('integrations.calendar')}
                hint={t('integrations.calendarHint')}
                action={
                  <div className="flex gap-1.5">
                    <button onClick={importCalendar} className={ghostBtn}>{t('integrations.importICS')}</button>
                    <button onClick={exportCalendar} className={ghostBtn}>{t('integrations.exportICS')}</button>
                  </div>
                }
              >
                <div />
              </Section>

              <Section title={t('integrations.recentFiles')} hint={t('integrations.recentFilesHint')}>
                {recentFiles.length === 0 && <div className="text-[12.5px] text-[var(--text-dim)] py-2">{t('integrations.noRecentFiles')}</div>}
                {recentFiles.length > 0 && (
                  <div className="grid gap-1">
                    {recentFiles.slice(0, 12).map((file: RecentFileEntry) => (
                      <div key={file.id} className="border-b border-[var(--border)] px-1 py-2.5 flex items-baseline gap-3">
                        <div className="text-[13px] text-[var(--text)] font-bold flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{file.name}</div>
                        <div className="text-[11.5px] text-[var(--text-dim)]">
                          {Math.max(1, Math.round(file.sizeBytes / 1024))} Ko
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}

          {tab === 'actions' && (
            <>
              <Section title={t('integrations.composeMail')} hint={t('integrations.composeMailHint')}>
                <input value={mailTo} onChange={e => setMailTo(e.target.value)} placeholder={t('integrations.to')} className={inputStyle} />
                <input value={mailSubject} onChange={e => setMailSubject(e.target.value)} placeholder={t('integrations.subject')} className={inputStyle} />
                <textarea value={mailBody} onChange={e => setMailBody(e.target.value)} rows={5} placeholder={t('integrations.body')} className={inputStyle + ' resize-y'} />
                {frequentRecipients.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {frequentRecipients.slice(0, 6).map(r => (
                      <button key={`${r.email}-${r.name}`} onClick={() => setMailTo(r.email)} className={ghostBtn + ' rounded-full px-2.5 py-1.25 text-[11.5px]'}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex justify-end">
                  <button onClick={openMailDraft} className={primaryBtn}>{t('integrations.openDraft')}</button>
                </div>
              </Section>

              <Section title={t('integrations.quickNote')} hint={t('integrations.quickNoteHint')}>
                <input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder={t('integrations.noteTitlePlaceholder')} className={inputStyle} />
                <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} rows={5} placeholder={t('integrations.content')} className={inputStyle + ' resize-y'} />
                <div className="flex justify-end">
                  <button onClick={saveNote} className={primaryBtn}>{t('integrations.save')}</button>
                </div>
              </Section>

              <Section title={t('integrations.platforms')} hint={t('integrations.platformsHint')}>
                <ApiPlatformsPanel accounts={accounts} />
              </Section>

              <GitHubPanel accounts={accounts} />

              <Section title={t('integrations.messaging')} hint={t('integrations.messagingHint')}>
                <MessagingBridgePanel accounts={accounts} />
              </Section>

              <Section title={t('integrations.google')} hint={t('integrations.googleHint')}>
                <ConsumerPlatformsPanel accounts={accounts} />
              </Section>

              <Section title={t('integrations.shortcuts')}>
                <ShortcutPanel accounts={accounts} onUpdate={updateIntegrationAccounts} />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

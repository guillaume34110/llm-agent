import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationAccountsState } from '../../integrations/app-accounts-service';
import {
  composeGoogleCalendarEvent,
  composeXPost,
  createGoogleDriveDoc,
  openGoogleDrive,
  openInstagramTarget,
  openLinkedInShare,
  openMessengerConversation,
  openZoomMeeting,
} from '../../integrations/app-bridges';

interface Props {
  accounts: IntegrationAccountsState;
}

export default function ConsumerPlatformsPanel({ accounts }: Props) {
  const { t } = useTranslation();
  const [calendarTitle, setCalendarTitle] = useState('');
  const [calendarDetails, setCalendarDetails] = useState('');
  const [calendarStart, setCalendarStart] = useState('');
  const [calendarEnd, setCalendarEnd] = useState('');
  const [driveQuery, setDriveQuery] = useState('');
  const [messengerHandle, setMessengerHandle] = useState(accounts.messenger.handle || '');
  const [instagramHandle, setInstagramHandle] = useState(accounts.instagram.handle || '');
  const [xText, setXText] = useState('');
  const [xUrl, setXUrl] = useState('');
  const [linkedInUrl, setLinkedInUrl] = useState('');
  const [zoomUrl, setZoomUrl] = useState(accounts.zoom.meetingUrl || '');
  const [status, setStatus] = useState('');

  const wrap = async (fn: () => Promise<string>) => {
    try {
      setStatus(await fn());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
      <div className="text-[13.5px] font-black text-[var(--text)]">{t('integrations.consumerPlatforms.title')}</div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
        {t('integrations.consumerPlatforms.description')}
      </div>

      <div className="mt-3.5 grid gap-4">
        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Google Calendar</div>
          <input value={calendarTitle} onChange={event => setCalendarTitle(event.target.value)} placeholder={t('integrations.consumerPlatforms.eventTitlePlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <textarea value={calendarDetails} onChange={event => setCalendarDetails(event.target.value)} rows={3} placeholder={t('integrations.consumerPlatforms.detailsPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <div className="grid grid-cols-2 gap-2.5">
            <input type="datetime-local" value={calendarStart} onChange={event => setCalendarStart(event.target.value)} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
            <input type="datetime-local" value={calendarEnd} onChange={event => setCalendarEnd(event.target.value)} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          </div>
          <button onClick={() => void wrap(() => composeGoogleCalendarEvent({ title: calendarTitle, details: calendarDetails, start: calendarStart, end: calendarEnd }))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold">{t('integrations.consumerPlatforms.createEvent')}</button>
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Google Drive</div>
          <input value={driveQuery} onChange={event => setDriveQuery(event.target.value)} placeholder={t('integrations.consumerPlatforms.driveSearchPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <div className="flex gap-2.5 flex-wrap">
            <button onClick={() => void wrap(() => openGoogleDrive(driveQuery))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.consumerPlatforms.openSearch')}</button>
            <button onClick={() => void wrap(() => createGoogleDriveDoc('doc'))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold">Doc</button>
            <button onClick={() => void wrap(() => createGoogleDriveDoc('sheet'))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold">Sheet</button>
            <button onClick={() => void wrap(() => createGoogleDriveDoc('slides'))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold">Slides</button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Messenger / Instagram</div>
          <div className="grid grid-cols-2 gap-2.5">
            <input value={messengerHandle} onChange={event => setMessengerHandle(event.target.value)} placeholder="Handle Messenger" className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
            <input value={instagramHandle} onChange={event => setInstagramHandle(event.target.value)} placeholder="Handle Instagram" className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          </div>
          <div className="flex gap-2.5">
            <button onClick={() => void wrap(() => openMessengerConversation(messengerHandle))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.consumerPlatforms.openMessenger')}</button>
            <button onClick={() => void wrap(() => openInstagramTarget(instagramHandle))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.consumerPlatforms.openInstagram')}</button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">X / LinkedIn / Zoom</div>
          <textarea value={xText} onChange={event => setXText(event.target.value)} rows={3} placeholder={t('integrations.consumerPlatforms.xTextPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <input value={xUrl} onChange={event => setXUrl(event.target.value)} placeholder={t('integrations.consumerPlatforms.urlPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <input value={linkedInUrl} onChange={event => setLinkedInUrl(event.target.value)} placeholder={t('integrations.consumerPlatforms.linkedInUrlPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <input value={zoomUrl} onChange={event => setZoomUrl(event.target.value)} placeholder="Meeting / scheduling URL Zoom" className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <div className="flex gap-2.5 flex-wrap">
            <button onClick={() => void wrap(() => composeXPost({ text: xText, url: xUrl }))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.consumerPlatforms.composeX')}</button>
            <button onClick={() => void wrap(() => openLinkedInShare({ text: xText, url: linkedInUrl || xUrl }))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.consumerPlatforms.openLinkedIn')}</button>
            <button onClick={() => void wrap(() => openZoomMeeting(zoomUrl))} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">{t('integrations.consumerPlatforms.openZoom')}</button>
          </div>
        </div>

        {status && <div className="text-[12px]" style={{ color: status.startsWith('OK:') ? 'var(--accent)' : 'var(--red)' }}>{status}</div>}
      </div>
    </section>
  );
}

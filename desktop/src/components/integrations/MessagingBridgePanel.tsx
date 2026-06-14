import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationAccountsState } from '../../integrations/app-accounts-service';
import { composeGmailDraft, composeWhatsAppMessage, openDiscordApp, sendDiscordWebhookMessage } from '../../integrations/app-bridges';

interface Props {
  accounts: IntegrationAccountsState;
}

export default function MessagingBridgePanel({ accounts }: Props) {
  const { t } = useTranslation();
  const [gmailTo, setGmailTo] = useState(accounts.gmail.address || '');
  const [gmailSubject, setGmailSubject] = useState('');
  const [gmailBody, setGmailBody] = useState('');
  const [discordMessage, setDiscordMessage] = useState('');
  const [whatsPhone, setWhatsPhone] = useState(accounts.whatsapp.defaultPhone || '');
  const [whatsText, setWhatsText] = useState('');
  const [status, setStatus] = useState('');

  const wrap = async (fn: () => Promise<string>) => {
    try {
      setStatus(await fn());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (!gmailTo.trim() && accounts.gmail.address.trim()) setGmailTo(accounts.gmail.address.trim());
    if (!whatsPhone.trim() && accounts.whatsapp.defaultPhone.trim()) setWhatsPhone(accounts.whatsapp.defaultPhone.trim());
  }, [accounts.gmail.address, accounts.whatsapp.defaultPhone]);

  return (
    <section className="border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
      <div className="text-[13.5px] font-black text-[var(--text)]">{t('integrations.messagingBridge.title')}</div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
        {t('integrations.messagingBridge.description')}
      </div>

      <div className="mt-3.5 grid gap-4">
        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Gmail</div>
          <input value={gmailTo} onChange={event => setGmailTo(event.target.value)} placeholder={t('integrations.to')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <input value={gmailSubject} onChange={event => setGmailSubject(event.target.value)} placeholder={t('integrations.subject')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <textarea value={gmailBody} onChange={event => setGmailBody(event.target.value)} rows={4} placeholder={t('integrations.body')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <button onClick={() => void wrap(() => composeGmailDraft({ to: gmailTo, subject: gmailSubject, body: gmailBody }))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold font-[Nunito]">
            {t('integrations.messagingBridge.openGmailDraft')}
          </button>
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">Discord</div>
          <textarea value={discordMessage} onChange={event => setDiscordMessage(event.target.value)} rows={4} placeholder={t('integrations.messagingBridge.discordMessagePlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <div className="flex gap-2.5">
            <button onClick={() => void wrap(() => openDiscordApp())} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold font-[Nunito]">
              {t('integrations.messagingBridge.openDiscord')}
            </button>
            <button onClick={() => void wrap(() => sendDiscordWebhookMessage(discordMessage))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold font-[Nunito]">
              {t('integrations.messagingBridge.sendWebhook')}
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-[12.5px] text-[var(--text)] font-extrabold">WhatsApp</div>
          <input value={whatsPhone} onChange={event => setWhatsPhone(event.target.value)} placeholder={t('integrations.messagingBridge.phoneNumberPlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]" />
          <textarea value={whatsText} onChange={event => setWhatsText(event.target.value)} rows={3} placeholder={t('integrations.messagingBridge.whatsappMessagePlaceholder')} className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y" />
          <button onClick={() => void wrap(() => composeWhatsAppMessage({ phone: whatsPhone, text: whatsText }))} className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold font-[Nunito]">
            {t('integrations.messagingBridge.openWhatsApp')}
          </button>
        </div>

        {status && <div className="text-[12px]" style={{ color: status.startsWith('OK:') ? 'var(--accent)' : 'var(--red)' }}>{status}</div>}
      </div>
    </section>
  );
}

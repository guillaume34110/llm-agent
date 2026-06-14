import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppPreferences } from '../preferences/preferences-service';
import { subscribeLocale, type Locale } from '../i18n/i18n';
import IntegrationsView from './IntegrationsView';
import MailAccountsPanel from './MailAccountsPanel';
import CustomEndpointsPanel from './CustomEndpointsPanel';
import OpenAiConnectorPanel from './OpenAiConnectorPanel';
import ChoicePicker from './ChoicePicker';
import AnimalPicker from './AnimalPicker';
import PrivacyPanel from './PrivacyPanel';
import ForgeAccountsPanel from './ForgeAccountsPanel';
import LegalPanel from './LegalPanel';
import { getCurrentAnimal, subscribe as subscribeAnimal } from '../animals/animal-service';
import AuditLogPanel from './AuditLogPanel';
import FaqPanel from './FaqPanel';

const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français', en: 'English',
};

interface Props {
  preferences: AppPreferences;
  onUpdatePreferences: (patch: Partial<AppPreferences>) => void;
  onOpenOnboarding: () => void;
}

export default function SettingsView({ preferences, onUpdatePreferences, onOpenOnboarding }: Props) {
  const { t: tSettings } = useTranslation();
  const [animalName, setAnimalName] = useState(() => getCurrentAnimal().displayName);
  const [showSkin, setShowSkin] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [, forceTick] = useState(0);
  useEffect(() => subscribeAnimal(a => setAnimalName(a.displayName)), []);

  useEffect(() => {
    return subscribeLocale(() => forceTick(t => t + 1));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('settings-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const matchesSearch = (sectionTitle: string): boolean => {
    const query = searchQ.trim().toLowerCase();
    return query === '' || sectionTitle.toLowerCase().includes(query);
  };

  return (
    <div className="flex-1 overflow-auto flex flex-col relative isolate">
      <div className="px-[20px] py-[18px] border-b border-[var(--border)] bg-[var(--bg2)] flex items-center justify-between gap-3 relative z-10">
        <div>
          <div className="text-[18px] font-black text-[var(--text)]">{tSettings('settings.title')}</div>
          <div className="mt-1 text-[12px] text-[var(--text-dim)]">
            {tSettings('settings.subtitle', { animalName })}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <input
            id="settings-search-input"
            type="text"
            placeholder={tSettings('settings.search.placeholder')}
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="px-[10px] py-[6px] rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] text-[12.5px] w-[220px] font-inherit"
          />
          <div className="flex gap-1 p-[3px] rounded-full bg-[var(--bg3)] border border-[var(--border)]">
            {(['simple','advanced'] as const).map(m => (
              <button
                key={m}
                onClick={() => onUpdatePreferences({ uiMode: m })}
                title={m === 'simple' ? tSettings('settings.simple') : tSettings('settings.advanced')}
                className={`px-3 py-[5px] rounded-full border-none cursor-pointer text-[12px] font-[800] font-[Nunito] ${preferences.uiMode === m ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-transparent text-[var(--text-muted)]'}`}
              >{m === 'simple' ? tSettings('settings.simple') : tSettings('settings.advanced')}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 gap-[18px] max-w-[860px] w-full box-border relative z-10">
        {matchesSearch(tSettings('settings.skin')) && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-[18px]">
          <button
            type="button"
            onClick={() => setShowSkin(s => !s)}
            className="w-full text-left bg-transparent border-none text-[var(--text)] text-[13.5px] font-black cursor-pointer p-0 flex items-center gap-2"
          >
            <span className="w-3">{showSkin ? '▾' : '▸'}</span>
            {tSettings('settings.skin')}
          </button>
          {!showSkin && (
            <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
              {tSettings('settings.skinDescription', { animalName })}
            </div>
          )}
          {showSkin && (
            <div className="mt-3">
              <AnimalPicker />
            </div>
          )}
        </section>
        )}

        {matchesSearch(tSettings('settings.appearance')) && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-[18px]">
          <div className="text-[13.5px] font-black text-[var(--text)]">{tSettings('settings.appearance')}</div>
          <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
            {tSettings('settings.appearanceDescription')}
          </div>
          <div className="mt-3 grid gap-[10px]">
            <ChoicePicker
              value={preferences.chatStyle}
              placeholder={tSettings('settings.appearance.chat')}
              options={[
                { value: 'bubbles', label: tSettings('settings.appearance.bubbles') },
                { value: 'flat', label: tSettings('settings.appearance.flat') },
                { value: 'compact', label: tSettings('settings.appearance.compact') },
              ]}
              onChange={(v) => onUpdatePreferences({ chatStyle: v as AppPreferences['chatStyle'] })}
            />
          </div>
          <div className="mt-3">
            <div className="text-[12px] text-[var(--text-muted)] mb-[6px]">{tSettings('settings.locale')}</div>
            <div className="flex gap-[6px] flex-wrap">
              {(Object.keys(LOCALE_LABELS) as Locale[]).map(loc => (
                <button
                  key={loc}
                  onClick={() => onUpdatePreferences({ locale: loc })}
                  aria-pressed={preferences.locale === loc}
                  className={`px-3 py-[6px] rounded-[var(--r)] text-[12px] font-bold font-[Nunito] cursor-pointer ${preferences.locale === loc ? 'border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]' : 'border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)]'}`}
                >
                  {LOCALE_LABELS[loc]}
                </button>
              ))}
            </div>
          </div>
        </section>
        )}

        {matchesSearch(tSettings('settings.faqSupport')) && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-[18px]">
          <div className="text-[13.5px] font-black text-[var(--text)]">{tSettings('settings.faqSupport')}</div>
          <FaqPanel />
        </section>
        )}

        {preferences.uiMode === 'advanced' && matchesSearch('Endpoints LLM custom') && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] overflow-hidden">
          <CustomEndpointsPanel />
        </section>
        )}

        {matchesSearch(tSettings('settings.behavior')) && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-[18px]">
          <div className="text-[13.5px] font-black text-[var(--text)]">{tSettings('settings.behavior')}</div>
          <div className="mt-3 grid gap-[10px]">
            <label className="flex items-center gap-[10px] text-[var(--text-muted)] text-[12.5px] font-bold">
              <input
                type="checkbox"
                checked={preferences.autoSpeakResponses}
                onChange={event => onUpdatePreferences({ autoSpeakResponses: event.target.checked })}
              />
              {tSettings('settings.behavior.autoSpeak')}
            </label>
            <label className="flex items-center gap-[10px] text-[var(--text-muted)] text-[12.5px] font-bold">
              <input
                type="checkbox"
                checked={preferences.reminderNotifications}
                onChange={event => onUpdatePreferences({ reminderNotifications: event.target.checked })}
              />
              {tSettings('settings.behavior.reminderNotifications')}
            </label>
          </div>
        </section>
        )}

        {matchesSearch(tSettings('settings.help')) && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-[18px]">
          <div className="text-[13.5px] font-black text-[var(--text)]">{tSettings('settings.help')}</div>
          <div className="mt-2 text-[12.5px] text-[var(--text-muted)] leading-relaxed">
            {tSettings('settings.help.description')}
          </div>
          <button
            onClick={onOpenOnboarding}
            className="mt-3 border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-[10px] cursor-pointer font-bold font-[Nunito]"
          >
            {tSettings('settings.help.reopenButton')}
          </button>
        </section>
        )}

        {preferences.uiMode === 'advanced' && matchesSearch(tSettings('settings.mailAccounts')) && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] overflow-hidden">
          <MailAccountsPanel />
        </section>
        )}

{preferences.uiMode === 'advanced' && matchesSearch(tSettings('settings.integrationsSection')) && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] overflow-hidden">
          <IntegrationsView />
        </section>
        )}

        {preferences.uiMode === 'advanced' && matchesSearch('openai connector api bearer langchain litellm') && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] overflow-hidden">
          <OpenAiConnectorPanel />
        </section>
        )}

        {matchesSearch(tSettings('settings.security')) && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-[18px]">
          <div className="flex items-center text-[13.5px] font-black text-[var(--text)]">
            {tSettings('settings.security')}
            <span title={tSettings('settings.security.hint')} className="ml-[6px] text-[11px] opacity-50 text-[var(--text-dim)] cursor-help rounded-full border border-[var(--border)] px-[5px]">?</span>
          </div>
          <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
            {tSettings('settings.security.description')}
          </div>
          <AuditLogPanel />
        </section>
        )}

        {matchesSearch(tSettings('settings.privacy')) && (
        <section className="w-full box-border min-w-0">
          <PrivacyPanel />
        </section>
        )}

        {matchesSearch('forge github gitlab gitea oauth pat token') && (
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] overflow-hidden">
          <ForgeAccountsPanel />
        </section>
        )}

        {matchesSearch(tSettings('settings.legal')) && (
        <section className="w-full box-border min-w-0">
          <LegalPanel />
        </section>
        )}
      </div>
    </div>
  );
}

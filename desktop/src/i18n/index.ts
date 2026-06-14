import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import fr from './locales/fr.json';
import en from './locales/en.json';

export const SUPPORTED_LANGS = ['fr', 'en'] as const;
export type Lang = typeof SUPPORTED_LANGS[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    fallbackLng: 'fr',
    supportedLngs: SUPPORTED_LANGS as unknown as string[],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'monkey-lang',
    },
  });

function applyDir(lng: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.dir = 'ltr';
  document.documentElement.lang = lng;
}
applyDir(i18n.language || 'fr');
i18n.on('languageChanged', applyDir);

export default i18n;

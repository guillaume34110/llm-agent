import { describe, it, expect, vi, beforeAll } from 'vitest';
import i18next from 'i18next';
import { classifyAgentError } from './error-classifier';
import enLocale from '../i18n/locales/en.json';
import frLocale from '../i18n/locales/fr.json';

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));
vi.mock('../animals/animal-service', () => ({
  getCurrentAnimal: () => ({ id: 'fox' }),
}));
vi.mock('../personas/persona-service', () => ({
  getActivePersonaId: () => '',
}));

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { agentStream } from './agent';

const fetchMock = tauriFetch as unknown as ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: enLocale },
      fr: { translation: frLocale },
    },
    interpolation: { escapeValue: false },
  });
});

describe('agentScreen.error.networkError — e2e', () => {
  describe('agentStream surfaces network failures as error events', () => {
    it('yields {type:"error", message:"sidecar fetch failed: ..."} when fetch throws', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:3471'));

      const events: any[] = [];
      for await (const ev of agentStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        events.push(ev);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].message).toMatch(/sidecar fetch failed/i);
      expect(events[0].message).toMatch(/ECONNREFUSED/);
    });

    it('yields error with sidecar HTTP status on non-2xx', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'service unavailable',
      } as any);

      const events: any[] = [];
      for await (const ev of agentStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        events.push(ev);
      }

      expect(events[0].type).toBe('error');
      expect(events[0].message).toMatch(/sidecar HTTP 503/);
    });
  });

  describe('classifyAgentError maps network-error keywords to networkError key', () => {
    it.each([
      'sidecar fetch failed: ECONNREFUSED 127.0.0.1:3471',
      'fetch failed',
      'NETWORK error',
      'connection timeout after 30s',
      'econnrefused',
    ])('classifies "%s" as agentScreen.error.networkError', (raw) => {
      const result = classifyAgentError(raw);
      expect(result.key).toBe('agentScreen.error.networkError');
      expect(result.vars).toBeUndefined();
    });

    it('does NOT classify rate limit or auth as networkError', () => {
      expect(classifyAgentError('429 rate_limit').key).toBe('agentScreen.error.rateLimited');
      expect(classifyAgentError('401 unauthorized').key).toBe('agentScreen.error.sessionExpired');
    });

    it('falls back to generic with raw error in vars', () => {
      const r = classifyAgentError('weird unexpected explosion');
      expect(r.key).toBe('agentScreen.error.generic');
      expect(r.vars).toEqual({ error: 'weird unexpected explosion' });
    });
  });

  describe('i18next resolves agentScreen.error.networkError', () => {
    it('en → "Network error"', () => {
      i18next.changeLanguage('en');
      expect(i18next.t('agentScreen.error.networkError')).toBe('Network error');
    });

    it('fr → "Erreur réseau"', () => {
      i18next.changeLanguage('fr');
      expect(i18next.t('agentScreen.error.networkError')).toBe('Erreur réseau');
    });

    it('does NOT return the raw key (regression guard against singular/plural mismatch)', () => {
      i18next.changeLanguage('en');
      const v = i18next.t('agentScreen.error.networkError');
      expect(v).not.toBe('agentScreen.error.networkError');
    });

    it('all 3 sibling error keys resolve in both locales', () => {
      const keys = ['rateLimited', 'networkError', 'sessionExpired'];
      for (const lang of ['en', 'fr'] as const) {
        i18next.changeLanguage(lang);
        for (const k of keys) {
          const full = `agentScreen.error.${k}`;
          expect(i18next.t(full), `${lang}:${full}`).not.toBe(full);
          expect(i18next.t(full), `${lang}:${full}`).not.toBe('');
        }
      }
    });

    it('generic key interpolates raw error', () => {
      i18next.changeLanguage('en');
      const raw = 'kaboom';
      const out = i18next.t('agentScreen.error.generic', { error: raw });
      expect(out).toContain('kaboom');
      expect(out).not.toBe('agentScreen.error.generic');
    });
  });

  describe('full path: agentStream error → classifier → i18n', () => {
    it('network failure becomes "Network error" in en', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      i18next.changeLanguage('en');

      const events: any[] = [];
      for await (const ev of agentStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        events.push(ev);
      }

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toBeTruthy();

      const { key, vars } = classifyAgentError(errorEvent.message);
      expect(key).toBe('agentScreen.error.networkError');
      const friendly = vars ? i18next.t(key, vars) : i18next.t(key);
      expect(friendly).toBe('Network error');
    });

    it('same path in fr → "Erreur réseau"', async () => {
      fetchMock.mockRejectedValueOnce(new Error('timeout'));
      i18next.changeLanguage('fr');

      const events: any[] = [];
      for await (const ev of agentStream({ messages: [{ role: 'user', content: 'hi' }] })) {
        events.push(ev);
      }

      const errorEvent = events.find(e => e.type === 'error');
      const { key, vars } = classifyAgentError(errorEvent.message);
      const friendly = vars ? i18next.t(key, vars) : i18next.t(key);
      expect(friendly).toBe('Erreur réseau');
    });
  });
});

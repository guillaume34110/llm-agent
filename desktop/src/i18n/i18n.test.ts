import { describe, it, expect, beforeEach, vi } from 'vitest';
import { t, setLocale, getLocale, subscribeLocale } from './i18n';

describe('i18n', () => {
  beforeEach(() => {
    setLocale('fr');
  });

  it('default locale is fr', () => {
    expect(getLocale()).toBe('fr');
  });

  it('t returns FR string in fr locale', () => {
    setLocale('fr');
    expect(t('app.loading')).toBe('Démarrage du moteur local…');
  });

  it('t returns EN string after setLocale to en', () => {
    setLocale('en');
    expect(t('app.loading')).toBe('Starting local engine…');
  });

  it('t returns key as fallback for unknown keys', () => {
    expect(t('unknown.key')).toBe('unknown.key');
  });

  it('t ignores unused vars and returns string unchanged', () => {
    setLocale('fr');
    const result = t('app.loading', { unused: 'value' });
    expect(result).toBe('Démarrage du moteur local…');
  });

  it('subscribeLocale fires callback on setLocale', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeLocale(callback);

    setLocale('en');
    expect(callback).toHaveBeenCalledTimes(1);

    setLocale('fr');
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();
    setLocale('en');
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

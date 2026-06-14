import React, { useEffect, useState } from 'react';
import { api } from './api';
import type { Screen } from './types';
import LoginScreen from './screens/LoginScreen';
import AgentScreen from './screens/AgentScreen';
import AnimalAvatar from './components/AnimalAvatar';
import { hydrateOwnedAnimals, applyTheme as applyAnimalTheme, getCurrentAnimal } from './animals/animal-service';
import { getPreferences, subscribePreferences } from './preferences/preferences-service';
import { startWhatsAppBridge } from './whatsapp/wa-bridge';
import { initWidgetMode, getWidgetMode, subscribeWidgetMode, type WidgetMode } from './widget/widget-mode';
import CornerExpandButton from './components/CornerExpandButton';
import ConsentGate from './components/ConsentGate';
import { hasValidConsent } from './compliance/consent-service';
import { t, subscribeLocale } from './i18n/i18n';
import { subscribeUnauthorized } from './auth/auth-events';
import { isGuestMode } from './auth/guest-mode';

function applyTheme(theme: 'dark' | 'light') {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  applyAnimalTheme(getCurrentAnimal());
}

function applyChatStyle(style: 'bubbles' | 'flat' | 'compact') {
  document.documentElement.setAttribute('data-chat-style', style);
}

const MAX_RETRIES = 25; // ~20s

export default function App() {
  const [screen, setScreen] = useState<Screen | 'loading' | 'error'>('loading');
  const [loadingMsg, setLoadingMsg] = useState(() => t('app.loading'));
  const [widgetMode, setWidgetModeState] = useState<WidgetMode>(() => getWidgetMode());
  const [consentOk, setConsentOk] = useState<boolean>(() => hasValidConsent());
  const [, forceTick] = useState(0);
  const retryCount = React.useRef(0);

  useEffect(() => {
    void initWidgetMode();
    return subscribeWidgetMode(setWidgetModeState);
  }, []);

  useEffect(() => {
    return subscribeLocale(() => forceTick(t => t + 1));
  }, []);

  const checkStatus = async () => {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 3000);
      const s = await api.status();
      clearTimeout(tid);
      retryCount.current = 0;
      try {
        await api.getProfile();
        void hydrateOwnedAnimals();
        setScreen('agent');
      } catch {
        // Guest mode: no account, local-only features still work.
        setScreen(isGuestMode() ? 'agent' : 'login');
      }
    } catch {
      retryCount.current += 1;
      if (retryCount.current >= MAX_RETRIES) {
        setScreen('error');
        return;
      }
      if (retryCount.current === 3) setLoadingMsg(t('app.loading.models'));
      if (retryCount.current === 7) setLoadingMsg(t('app.loading.db'));
      if (retryCount.current === 14) setLoadingMsg(t('app.loading.almost'));
      if (retryCount.current === 20) setLoadingMsg(t('app.loading.hold'));
      setTimeout(checkStatus, 800);
    }
  };

  const restart = () => {
    retryCount.current = 0;
    setLoadingMsg(t('app.loading'));
    setScreen('loading');
    checkStatus();
  };

  useEffect(() => { checkStatus(); }, []);
  useEffect(() => {
    return subscribeUnauthorized(() => {
      // A stray backend 401 must not kick a guest out of the app. AuthGate's
      // CTA calls exitGuestMode() before signaling, so it still routes here.
      if (isGuestMode()) return;
      setScreen((s) => (s === 'login' ? s : 'login'));
    });
  }, []);
  useEffect(() => { startWhatsAppBridge(); }, []);
  useEffect(() => {
    import('./custom-endpoints/custom-endpoints.service').then(m => m.syncToSidecar()).catch(() => {});
  }, []);
  useEffect(() => {
    const p = getPreferences();
    const now = Date.now();
    const INACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
    if (p.lastActivityTs && (now - p.lastActivityTs) > INACTIVE_MS && p.uiMode === 'advanced') {
      import('./preferences/preferences-service').then(m => m.updatePreferences({ uiMode: 'simple', lastActivityTs: now }));
    } else {
      import('./preferences/preferences-service').then(m => m.updatePreferences({ lastActivityTs: now }));
    }
    applyTheme(p.theme);
    applyChatStyle(p.chatStyle);
    return subscribePreferences(np => {
      applyTheme(np.theme);
      applyChatStyle(np.chatStyle);
    });
  }, []);

  if (!consentOk) return <ConsentGate onAccept={() => setConsentOk(true)} />;

  if (screen === 'loading') return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', flexDirection: 'column', gap: 14 }}>
      <div style={{ opacity: 0.5 }}><AnimalAvatar size={42} /></div>
      <div style={{ display: 'flex', gap: 5 }}>
        <span className="dot" /><span className="dot" /><span className="dot" />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 4 }}>{loadingMsg}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-dim, #666)', marginTop: 2, opacity: 0.7 }}>{t('app.privacy.tagline')}</div>
    </div>
  );

  if (screen === 'error') return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', flexDirection: 'column', gap: 16 }}>
      <div style={{ opacity: 0.4 }}><AnimalAvatar size={42} /></div>
      <div style={{ fontSize: 14, color: 'var(--text-muted, #888)', textAlign: 'center', maxWidth: 260 }}>
        {t('app.error.server')}
      </div>
      <button onClick={restart} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent, #3a7c52)', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
        {t('app.error.retry')}
      </button>
    </div>
  );

  if (screen === 'login') return (
    <>
      <LoginScreen onLoggedIn={() => { void hydrateOwnedAnimals(); setScreen('agent'); }} />
      <CornerExpandButton />
    </>
  );
  return (
    <>
      <AgentScreen onSignOut={() => setScreen('login')} compact={widgetMode === 'widget'} />
      <CornerExpandButton />
    </>
  );
}

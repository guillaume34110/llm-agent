import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import MonkeyLogo from '../components/MonkeyLogo';
import { enterGuestMode, exitGuestMode } from '../auth/guest-mode';

export default function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const submit = async () => {
    if (!email || !password) return;
    if (mode === 'register' && password.length < 8) {
      setErr(t('loginScreen.passwordTooShort', 'Mot de passe : 8 caractères minimum'));
      return;
    }
    setLoading(true); setErr(null);
    try {
      if (mode === 'register') await api.register(email, password);
      else await api.login(email, password);
      exitGuestMode();
      onLoggedIn();
    } catch (e: any) {
      setErr(e.message || t('loginScreen.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(m => (m === 'login' ? 'register' : 'login'));
    setErr(null);
  };

  const fieldStyle = (id: string): React.CSSProperties => ({
    width: '100%', background: 'var(--bg3)',
    border: `1px solid ${focused === id ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 'var(--r)', padding: '10px 13px',
    color: 'var(--text)', fontFamily: 'Nunito', fontSize: 14, outline: 'none',
    transition: 'border-color 0.2s',
  });

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', userSelect: 'none' }}>
      <div className="fade-up" style={{
        width: 340, background: 'var(--bg2)', borderRadius: 'var(--rl)',
        border: '1px solid var(--border)', padding: '36px 32px',
        boxShadow: '0 32px 80px oklch(4% 0.02 148 / 0.7)',
        display: 'flex', flexDirection: 'column', gap: 13,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <MonkeyLogo size={40} />
          <h1 style={{ fontWeight: 900, fontSize: 20, marginTop: 10, letterSpacing: '-0.3px' }}>
            {mode === 'register' ? t('loginScreen.registerTitle', 'Créer un compte') : t('loginScreen.title')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 5, fontWeight: 500 }}>
            {mode === 'register' ? t('loginScreen.registerSubtitle', 'Crée ton compte Progsoft') : t('loginScreen.subtitle')}
          </p>
        </div>

        <input
          type="email"
          autoFocus
          placeholder={t('loginScreen.emailPlaceholder')}
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          onFocus={() => setFocused('email')}
          onBlur={() => setFocused(null)}
          style={fieldStyle('email')}
        />
        <input
          type="password"
          placeholder={t('loginScreen.passwordPlaceholder')}
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          onFocus={() => setFocused('password')}
          onBlur={() => setFocused(null)}
          style={fieldStyle('password')}
        />

        {err && (
          <div style={{ background: 'var(--red-soft)', border: '1px solid oklch(62% 0.19 25 / 0.3)', borderRadius: 'var(--r)', padding: '8px 12px', color: 'var(--red)', fontSize: 13, fontWeight: 600 }}>
            {err}
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading || !email || !password}
          style={{
            padding: '11px 0', border: 'none', borderRadius: 'var(--rm)',
            background: (!email || !password) ? 'var(--accent-dim)' : 'var(--accent)',
            color: 'white', fontFamily: 'Nunito', fontWeight: 800, fontSize: 14.5,
            cursor: (!email || !password) ? 'not-allowed' : 'pointer',
            boxShadow: (!email || !password) ? 'none' : '0 4px 14px var(--accent-glow)',
            opacity: loading ? 0.7 : 1, transition: 'all 0.18s',
          }}
        >
          {mode === 'register'
            ? (loading ? t('loginScreen.registering', 'Création…') : t('loginScreen.registerButton', 'Créer le compte'))
            : (loading ? t('loginScreen.loggingIn') : t('loginScreen.loginButton'))}
        </button>

        <button
          onClick={toggleMode}
          disabled={loading}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontFamily: 'Nunito', fontWeight: 600, fontSize: 13,
            cursor: loading ? 'default' : 'pointer', marginTop: 2, padding: 0,
          }}
        >
          {mode === 'login'
            ? t('loginScreen.toRegister', "Pas de compte ? S'inscrire")
            : t('loginScreen.toLogin', 'Déjà un compte ? Se connecter')}
        </button>

        <button
          onClick={() => { enterGuestMode(); onLoggedIn(); }}
          disabled={loading}
          style={{
            padding: '9px 0', borderRadius: 'var(--rm)',
            background: 'none', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontFamily: 'Nunito', fontWeight: 700, fontSize: 13,
            cursor: loading ? 'default' : 'pointer', marginTop: 4,
            transition: 'all 0.18s',
          }}
        >
          {t('loginScreen.guestButton', 'Se connecter sans compte')}
        </button>
      </div>
    </div>
  );
}

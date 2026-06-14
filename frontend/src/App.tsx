import React, { useEffect } from 'react';
import MonkeyLogo from './components/MonkeyLogo';
import Landing from './components/Landing';
import AccountPortal from './components/AccountPortal';
import { Button, Field, Input, Tabs } from './ui';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { fetchMe, register, login, changePassword, forgotPassword, resetPassword } from './store/slices/authSlice';

function friendlyError(e: any, fallback: string): string {
  const msg = e?.response?.data?.message || e?.message || fallback;
  const map: Record<string, string> = {
    'Invalid credentials': 'Email ou mot de passe incorrect.',
    'User already exists': 'Un compte existe déjà avec cet email.',
    'Insufficient credits': 'Crédits insuffisants. Veuillez recharger votre compte.',
    'Current password incorrect': 'Mot de passe actuel incorrect.',
    'Unauthorized': 'Session expirée. Veuillez vous reconnecter.',
  };
  return map[msg] || msg;
}

function FormShell({ children, width = 380 }: { children: React.ReactNode; width?: number }) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-[var(--bg)]">
      <div
        className="fade-in bg-[var(--bg2)] border border-[var(--border)] rounded-[16px] p-9 flex flex-col gap-3.5"
        style={{ width, boxShadow: 'var(--shadow-card)' }}
      >
        {children}
      </div>
    </div>
  );
}

function FormHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center mb-2">
      <MonkeyLogo size={36} />
      <h2 className="font-extrabold text-[19px] mt-2.5 text-[var(--text)]">{title}</h2>
      {subtitle && <p className="text-[var(--text-muted)] text-[13px] mt-1.5">{subtitle}</p>}
    </div>
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] px-3 py-2 text-[13px] font-semibold"
      style={{ background: 'oklch(40% 0.18 25 / 0.15)', border: '1px solid oklch(55% 0.18 25 / 0.4)', color: 'oklch(70% 0.16 25)' }}>
      {children}
    </div>
  );
}

function ForgotPassword({ onBack }: { onBack: () => void }) {
  const dispatch = useAppDispatch();
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim()) { setErr('Veuillez saisir votre email.'); return; }
    setLoading(true); setErr(null);
    try {
      await dispatch(forgotPassword(email)).unwrap();
      setDone(true);
    } catch (e: any) {
      setErr(friendlyError(e, 'Une erreur est survenue.'));
    } finally { setLoading(false); }
  };

  return (
    <FormShell>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <FormHeader title="Mot de passe oublié" />
        {done ? (
          <div className="text-center text-[var(--green)] font-semibold text-[14px] py-2">
            Si ce compte existe, un email a été envoyé.
          </div>
        ) : (
          <>
            <Field label="Email">
              <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="vous@exemple.fr" autoComplete="email" />
            </Field>
            {err && <ErrorMsg>{err}</ErrorMsg>}
            <Button type="submit" loading={loading} full>Envoyer le lien</Button>
          </>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="self-center">
          ← Retour à la connexion
        </Button>
      </form>
    </FormShell>
  );
}

function ResetPassword({ token }: { token: string }) {
  const dispatch = useAppDispatch();
  const [pass, setPass] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pass !== confirm) { setErr('Les mots de passe ne correspondent pas.'); return; }
    if (pass.length < 8) { setErr('8 caractères minimum.'); return; }
    setLoading(true); setErr(null);
    try {
      await dispatch(resetPassword({ token, password: pass })).unwrap();
      setDone(true);
      window.history.replaceState({}, '', '/');
    } catch (e: any) {
      setErr(friendlyError(e, 'Lien invalide ou expiré.'));
    } finally { setLoading(false); }
  };

  return (
    <FormShell>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <FormHeader title="Nouveau mot de passe" />
        {done ? (
          <div className="text-center text-[var(--green)] font-semibold text-[14px] py-2">
            Mot de passe mis à jour. <a href="/" className="text-[var(--green)] underline">Se connecter</a>
          </div>
        ) : (
          <>
            <Field label="Nouveau mot de passe">
              <Input type="password" value={pass} onChange={e => setPass(e.target.value)} />
            </Field>
            <Field label="Confirmation">
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
            </Field>
            {err && <ErrorMsg>{err}</ErrorMsg>}
            <Button type="submit" loading={loading} full>Définir le mot de passe</Button>
          </>
        )}
      </form>
    </FormShell>
  );
}

function Auth() {
  const dispatch = useAppDispatch();
  const [email, setEmail] = React.useState('');
  const [pass, setPass] = React.useState('');
  const [rememberMe, setRememberMe] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'login' | 'register' | 'forgot'>('login');
  const [showForm, setShowForm] = React.useState(false);

  if (!showForm) return <Landing onSignIn={() => setShowForm(true)} />;
  if (mode === 'forgot') return <ForgotPassword onBack={() => setMode('login')} />;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim()) { setErr('Veuillez saisir votre email.'); return; }
    if (!pass) { setErr('Veuillez saisir votre mot de passe.'); return; }
    setLoading(true); setErr(null);
    try {
      if (mode === 'register') await dispatch(register({ email, password: pass })).unwrap();
      else await dispatch(login({ email, password: pass, rememberMe })).unwrap();
      await dispatch(fetchMe());
    } catch (e: any) {
      setErr(friendlyError(e, mode === 'register' ? 'Échec de la création du compte.' : 'Échec de la connexion.'));
    } finally { setLoading(false); }
  };

  return (
    <FormShell width={400}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="text-center mb-4">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <MonkeyLogo size={44} />
            <span className="text-[28px] font-black tracking-[-0.5px] text-[var(--text)]">Monkey</span>
          </div>
          <p className="text-[var(--text-muted)] text-[13.5px] font-medium">
            Progsoft AI — votre assistant intelligent
          </p>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1">
            <Tabs<'login' | 'register'>
              tabs={[{ value: 'login', label: 'Connexion' }, { value: 'register', label: 'Inscription' }]}
              value={mode === 'forgot' ? 'login' : mode}
              onChange={v => { setMode(v); setErr(null); }}
            />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
            ← Retour
          </Button>
        </div>

        <Field label="Email">
          <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="vous@exemple.fr" autoComplete="email" />
        </Field>
        <Field label="Mot de passe">
          <Input value={pass} onChange={e => setPass(e.target.value)} type="password" placeholder="••••••••"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </Field>

        {mode === 'login' && (
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer text-[13.5px] text-[var(--text-muted)] font-semibold">
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
                style={{ accentColor: 'var(--green)' }} className="w-[15px] h-[15px]" />
              Se souvenir de moi
            </label>
            <button type="button" onClick={() => { setMode('forgot'); setErr(null); }}
              className="bg-transparent border-none text-[var(--text-dim)] text-[12.5px] cursor-pointer font-[Nunito] font-semibold hover:text-[var(--text)]">
              Mot de passe oublié ?
            </button>
          </div>
        )}

        {err && <ErrorMsg>{err}</ErrorMsg>}

        <Button type="submit" loading={loading} full size="lg" className="mt-1">
          {mode === 'login' ? 'Se connecter' : 'Créer un compte'}
        </Button>

        {mode === 'login' && (
          <p className="text-center mt-1 text-[12.5px] text-[var(--text-dim)]">
            Compte admin ? Vous devrez changer votre mot de passe à la première connexion.
          </p>
        )}
      </form>
    </FormShell>
  );
}

function ChangePassword() {
  const dispatch = useAppDispatch();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (next !== confirm) { setErr('Les mots de passe ne correspondent pas.'); return; }
    if (next.length < 8) { setErr('Nouveau mot de passe : 8 caractères minimum.'); return; }
    setLoading(true); setErr(null);
    try {
      await dispatch(changePassword({ currentPassword: current, newPassword: next })).unwrap();
      await dispatch(fetchMe());
    } catch (e: any) {
      setErr(friendlyError(e, 'Échec du changement de mot de passe.'));
    } finally { setLoading(false); }
  };

  return (
    <FormShell>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <FormHeader title="Changement de mot de passe requis" subtitle="Pour votre sécurité, veuillez définir un nouveau mot de passe." />
        <Field label="Mot de passe actuel">
          <Input type="password" value={current} onChange={e => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nouveau mot de passe">
          <Input type="password" value={next} onChange={e => setNext(e.target.value)} />
        </Field>
        <Field label="Confirmation">
          <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
        </Field>
        {err && <ErrorMsg>{err}</ErrorMsg>}
        <Button type="submit" loading={loading} full>Enregistrer</Button>
      </form>
    </FormShell>
  );
}

export default function App() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s: any) => s.auth.user);
  const authLoading = useAppSelector((s: any) => s.auth.loading);

  const resetToken = React.useMemo(() => new URLSearchParams(window.location.search).get('token'), []);

  useEffect(() => { dispatch(fetchMe()); }, [dispatch]);

  if (resetToken) return <ResetPassword token={resetToken} />;

  if (authLoading) return (
    <div className="w-full h-full flex items-center justify-center bg-[var(--bg)] text-[var(--text-muted)] text-[14px]">
      Chargement…
    </div>
  );
  if (!user) return <Auth />;
  if (user.mustChangePassword) return <ChangePassword />;
  return <AccountPortal />;
}

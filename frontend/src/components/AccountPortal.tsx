import React, { useState } from 'react';
import axios from 'axios';
import { LogOut } from 'lucide-react';
import MonkeyLogo from './MonkeyLogo';
import UsageWidget from './UsageWidget';
import DownloadMonkey from './DownloadMonkey';
import BuyCredits from './BuyCredits';
import { Button, Card, Field, Input, Tabs } from '../ui';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { logout, changePassword } from '../store/slices/authSlice';

type Section = 'overview' | 'password' | 'privacy';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AccountPortal() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s: any) => s.auth.user);
  const [section, setSection] = useState<Section>('overview');
  const [showBuy, setShowBuy] = useState(false);

  return (
    <div className="w-full min-h-full bg-[var(--bg)] flex flex-col items-center px-5 pt-8 pb-16 overflow-auto">
      <header className="w-full max-w-[760px] flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <MonkeyLogo size={32} />
          <span className="text-[19px] font-black tracking-[-0.4px] text-[var(--text)]">Monkey — Compte</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => dispatch(logout())}>
          <LogOut size={14} /> Se déconnecter
        </Button>
      </header>

      <div className="w-full max-w-[760px] text-[13px] font-semibold text-[var(--text-muted)] mb-4">
        Connecté : <span className="text-[var(--text)]">{user?.email}</span>
      </div>

      <div className="w-full max-w-[760px] mb-4">
        <Tabs<Section>
          tabs={[
            { value: 'overview', label: 'Vue d\'ensemble' },
            { value: 'password', label: 'Mot de passe' },
            { value: 'privacy', label: 'Confidentialité' },
          ]}
          value={section}
          onChange={setSection}
        />
      </div>

      <main className="w-full max-w-[760px] flex flex-col gap-4">
        {section === 'overview' && (
          <>
            <Card title="Crédits & consommation">
              <UsageWidget />
              <div><Button onClick={() => setShowBuy(true)}>Recharger des crédits</Button></div>
            </Card>
            <Card title="Télécharger l'application">
              <DownloadMonkey />
            </Card>
          </>
        )}
        {section === 'password' && <PasswordSection />}
        {section === 'privacy' && <PrivacySection />}
      </main>

      {showBuy && <BuyCredits onClose={() => setShowBuy(false)} />}
    </div>
  );
}

function PasswordSection() {
  const dispatch = useAppDispatch();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setMsg({ type: 'err', text: 'Les mots de passe ne correspondent pas.' }); return; }
    if (next.length < 8) { setMsg({ type: 'err', text: '8 caractères minimum.' }); return; }
    setLoading(true); setMsg(null);
    try {
      await dispatch(changePassword({ currentPassword: current, newPassword: next })).unwrap();
      setCurrent(''); setNext(''); setConfirm('');
      setMsg({ type: 'ok', text: 'Mot de passe mis à jour.' });
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || 'Échec du changement.' });
    } finally { setLoading(false); }
  };

  return (
    <Card title="Changer le mot de passe">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Mot de passe actuel">
          <Input type="password" value={current} onChange={e => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nouveau mot de passe">
          <Input type="password" value={next} onChange={e => setNext(e.target.value)} />
        </Field>
        <Field label="Confirmation">
          <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} />
        </Field>
        {msg && (
          <div className={`text-[13px] font-semibold ${msg.type === 'ok' ? 'text-[var(--green)]' : ''}`}
            style={msg.type === 'err' ? { color: 'oklch(70% 0.16 25)' } : undefined}>
            {msg.text}
          </div>
        )}
        <div><Button type="submit" loading={loading}>Enregistrer</Button></div>
      </form>
    </Card>
  );
}

function PrivacySection() {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const exportData = async () => {
    setExporting(true); setErr(null);
    try {
      const res = await axios.get('/api/account/export', { withCredentials: true, responseType: 'blob' });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(res.data, `monkey-account-${stamp}.json`);
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Échec de l\'export.');
    } finally { setExporting(false); }
  };

  const deleteAccount = async () => {
    if (confirmText !== 'SUPPRIMER') { setErr('Tapez SUPPRIMER pour confirmer.'); return; }
    setDeleting(true); setErr(null);
    try {
      await axios.delete('/api/account', { withCredentials: true });
      window.location.href = '/';
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Échec de la suppression.');
      setDeleting(false);
    }
  };

  return (
    <>
      <Card title="Exporter vos données (RGPD art. 15)">
        <p className="text-[13px] text-[var(--text-muted)] leading-[1.5] m-0">
          Téléchargez l'ensemble des données stockées côté serveur : profil, transactions de crédits, logs d'appels LLM (sans payload).
        </p>
        <div><Button onClick={exportData} loading={exporting}>Télécharger mes données</Button></div>
      </Card>

      <Card title="Supprimer le compte (RGPD art. 17)">
        <p className="text-[13px] text-[var(--text-muted)] leading-[1.5] m-0">
          Anonymise votre profil et supprime les logs d'appels et liens d'authentification. Les transactions de crédits sont conservées 7 ans pour obligation fiscale. Les paiements XMR sont irréversibles — aucun remboursement.
        </p>
        {!confirmDelete ? (
          <div><Button variant="danger" onClick={() => setConfirmDelete(true)}>Supprimer mon compte</Button></div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <Field label="Tapez SUPPRIMER pour confirmer">
              <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} className="max-w-[220px]" />
            </Field>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={deleteAccount}
                disabled={confirmText !== 'SUPPRIMER'}
                loading={deleting}
              >
                Confirmer
              </Button>
              <Button variant="secondary" onClick={() => { setConfirmDelete(false); setConfirmText(''); setErr(null); }}>
                Annuler
              </Button>
            </div>
          </div>
        )}
        {err && <div className="text-[13px] font-semibold" style={{ color: 'oklch(70% 0.16 25)' }}>{err}</div>}
      </Card>
    </>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ArrowRight, Check, Download, Minus, X } from 'lucide-react';
import MonkeyLogo from './MonkeyLogo';

// ─── Animation primitives ────────────────────────────────────────────────────

const E = 'cubic-bezier(.22,1,.36,1)';

function AnimIn({
  children, delay = 0, duration = 600, style, className,
}: {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setOn(true); obs.disconnect(); } },
      { threshold: 0.08 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...(on
          ? { animation: `slideUp ${duration}ms ${E} ${delay}ms both` }
          : { opacity: 0 }),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Lang = 'en' | 'fr';
type Platform = 'macos' | 'windows' | 'linux';
type Cell = 'yes' | 'no' | 'partial';

interface InstallStepData {
  num: number;
  title: string;
  desc: string;
  code?: string;
}

interface LandingProps {
  onSignIn: () => void;
}

// ─── i18n ────────────────────────────────────────────────────────────────────

const T = {
  en: {
    nav: {
      features: 'Features', install: 'Install', github: 'GitHub',
      signIn: 'Sign in', download: 'Download',
    },
    hero: {
      eyebrow: 'Open source · AGPLv3 · No telemetry',
      h1: ['Your AI.', 'Your machine.', 'Your rules.'],
      subtitle: 'An autonomous agent that runs entirely on your hardware. No API key. No subscription. No data sent. Ever.',
      downloadBtn: (os: string) => `↓ Download for ${os}`,
      githubBtn: 'View on GitHub',
      badges: ['Runs 100% offline', 'Llama 3.1, Mistral, Qwen', 'macOS · Windows · Linux', 'Free forever'],
      scroll: 'Scroll',
      unavailable: 'Build coming soon',
    },
    features: {
      label: 'What Monkey does',
      h2a: 'Everything you need.',
      h2b: 'Nothing in the cloud.',
      desc: 'All your data stays local. Memory, files, conversations — encrypted on your disk, never transmitted.',
      items: [
        { icon: '🔒', title: 'Local-first', desc: 'Memory, files, conversations — everything stays on your machine. Encrypted at rest, never transmitted.' },
        { icon: '🤖', title: 'Autonomous agent', desc: 'Plans, executes, audits. You validate the plan — the agent handles execution across dozens of steps.' },
        { icon: '📅', title: 'Calendar integration', desc: 'Recurring tasks, automatic reports, natural-language scheduling. "Brief me every Monday at 9am."' },
        { icon: '🎙️', title: 'Voice — no cloud', desc: 'Dictation and readback via Whisper.cpp, locally. Speak your prompt, hear the answer. No internet required.' },
        { icon: '💬', title: 'WhatsApp + Email bridges', desc: 'Trigger the agent from your phone or inbox. Reply to an email, get a full autonomous task executed.' },
        { icon: '🔌', title: 'Custom endpoints', desc: "Plug in any OpenAI-compatible model — local Ollama, a remote friend's machine, or your own server." },
      ],
    },
    comparison: {
      label: 'How it compares',
      h2a: 'Monkey vs the',
      h2b: 'alternatives',
      desc: 'The only assistant that combines local execution, autonomous agent capabilities, and voice — with zero data leaving your machine.',
      cols: ['Capability', '🐒 Monkey', 'ChatGPT', 'Ollama', 'OpenClaw', 'HermesAgent'],
      rows: [
        { label: 'Local-first (no data sent)', monkey: 'yes' as Cell, chatgpt: 'no' as Cell, ollama: 'yes' as Cell, openclaw: 'no' as Cell, hermesagent: 'yes' as Cell },
        { label: 'Autonomous agent (multi-step)', monkey: 'yes' as Cell, chatgpt: 'partial' as Cell, ollama: 'no' as Cell, openclaw: 'yes' as Cell, hermesagent: 'partial' as Cell },
        { label: 'Voice (offline, no cloud STT)', monkey: 'yes' as Cell, chatgpt: 'yes' as Cell, ollama: 'no' as Cell, openclaw: 'no' as Cell, hermesagent: 'no' as Cell },
        { label: 'Calendar + scheduling', monkey: 'yes' as Cell, chatgpt: 'partial' as Cell, ollama: 'no' as Cell, openclaw: 'no' as Cell, hermesagent: 'no' as Cell },
        { label: 'Open source (AGPLv3)', monkey: 'yes' as Cell, chatgpt: 'no' as Cell, ollama: 'yes' as Cell, openclaw: 'partial' as Cell, hermesagent: 'partial' as Cell },
        { label: 'Free forever', monkey: 'yes' as Cell, chatgpt: 'no' as Cell, ollama: 'yes' as Cell, openclaw: 'partial' as Cell, hermesagent: 'yes' as Cell },
      ],
    },
    install: {
      label: 'Installation',
      h2a: 'Up and running in',
      h2b: '2 minutes',
      desc: "Monkey is unsigned — no expensive Apple or Microsoft certificates. Your OS will warn you. Here's how to bypass it safely.",
      warningTitle: 'Why the warning?',
      warningBody: "Code-signing certificates cost $99–$299/year. As a free open-source project, we skip them. The app is fully auditable on GitHub — you can build it yourself from source.",
      tabs: { macos: '🍎 macOS', windows: '🪟 Windows', linux: '🐧 Linux' } as Record<Platform, string>,
      steps: {
        macos: [
          { num: 1, title: 'Download the .dmg', desc: 'Click the download button above. Save Monkey-x.x.x.dmg to your Downloads folder.' },
          { num: 2, title: 'Open — ignore the warning', desc: 'Double-click the .dmg. macOS shows "cannot be opened because it is from an unidentified developer". Click OK to dismiss.' },
          { num: 3, title: 'Allow in System Settings', desc: "Go to System Settings → Privacy & Security. Scroll down — you'll see \"Monkey was blocked\". Click Open Anyway.", code: 'System Settings → Privacy & Security' },
          { num: 4, title: 'Confirm & launch', desc: 'A final dialog asks "Are you sure?" — click Open. Monkey launches. You only need to do this once.' },
        ] as InstallStepData[],
        windows: [
          { num: 1, title: 'Download the .msi', desc: 'Click the download button above. Save Monkey-x.x.x.msi to your Downloads folder.' },
          { num: 2, title: 'Click "More info" on SmartScreen', desc: 'Windows SmartScreen shows a blue warning. Click "More info" to reveal the "Run anyway" button.', code: 'SmartScreen → More info → Run anyway' },
          { num: 3, title: 'Follow the installer wizard', desc: 'Accept the license, choose install path. Monkey will be available from the Start menu.' },
        ] as InstallStepData[],
        linux: [
          { num: 1, title: 'Download the .AppImage', desc: 'Click the download button above. Save Monkey-x.x.x.AppImage anywhere (e.g. ~/Applications/).' },
          { num: 2, title: 'Make executable', desc: 'Open a terminal and run:', code: 'chmod +x Monkey-x.x.x.AppImage' },
          { num: 3, title: 'Run it', desc: 'Double-click the file, or from terminal:', code: './Monkey-x.x.x.AppImage' },
        ] as InstallStepData[],
      },
      buildLabel: 'Prefer to build from source?',
      buildLink: 'Build instructions on GitHub →',
    },
    privacy: {
      label: 'Privacy & trust',
      h2a: 'Built on',
      h2b: 'radical transparency',
      items: [
        { icon: '🔍', title: 'AGPLv3 — fully auditable', desc: "Every line of code is public. Fork it, audit it, modify it. No hidden network calls, no obfuscated binaries." },
        { icon: '📵', title: 'Zero telemetry', desc: "No analytics, no crash reports, no usage tracking. The app never makes a network request you didn't ask for." },
        { icon: '💾', title: 'Local storage only', desc: "Memory, conversations, files — stored encrypted on your disk. Even if our server disappeared, your data stays intact." },
        { icon: '🌐', title: 'P2P compute (coming soon)', desc: 'Share your GPU, earn credits. Prompts stay end-to-end encrypted via Noise Protocol — the matchmaker never sees content.' },
      ],
      ctaEyebrow: 'Free · Open source · No account required',
      ctaH2: 'Ready to own your AI?',
      ctaBody: "Download Monkey, install Ollama, and you're running fully offline in under 5 minutes.",
      ctaGithub: '★ Star on GitHub',
    },
    footer: {
      privacy: 'Privacy',
      github: 'GitHub',
      license: 'AGPLv3 License',
      copy: '© 2026 Progsoft. Free forever.',
    },
    modal: {
      title: (os: string) => `Installing on ${os}`,
      subtitle: "Monkey is unsigned. Your OS will warn you — here's how to allow it:",
      continueBtn: (os: string) => `Continue — download for ${os}`,
      cancel: 'Cancel',
    },
  },
  fr: {
    nav: {
      features: 'Fonctionnalités', install: 'Installer', github: 'GitHub',
      signIn: 'Se connecter', download: 'Télécharger',
    },
    hero: {
      eyebrow: 'Open source · AGPLv3 · Aucune télémétrie',
      h1: ['Ton IA.', 'Ta machine.', 'Tes règles.'],
      subtitle: 'Un agent autonome qui tourne entièrement sur ton matériel. Sans clé API. Sans abonnement. Aucune donnée envoyée. Jamais.',
      downloadBtn: (os: string) => `↓ Télécharger pour ${os}`,
      githubBtn: 'Voir sur GitHub',
      badges: ['100% hors ligne', 'Llama 3.1, Mistral, Qwen', 'macOS · Windows · Linux', 'Gratuit pour toujours'],
      scroll: 'Défiler',
      unavailable: 'Build bientôt disponible',
    },
    features: {
      label: 'Ce que fait Monkey',
      h2a: "Tout ce qu'il vous faut.",
      h2b: 'Rien dans le cloud.',
      desc: 'Toutes vos données restent locales. Mémoire, fichiers, conversations — chiffrés sur votre disque, jamais transmis.',
      items: [
        { icon: '🔒', title: 'Local-first', desc: "Mémoire, fichiers, conversations — tout reste sur votre machine. Chiffré au repos, jamais transmis." },
        { icon: '🤖', title: 'Agent autonome', desc: "Planifie, exécute, audite. Vous validez le plan — l'agent gère l'exécution sur des dizaines d'étapes." },
        { icon: '📅', title: 'Calendrier intégré', desc: 'Tâches récurrentes, rapports automatiques, planification en langage naturel. "Briefing chaque lundi à 9h."' },
        { icon: '🎙️', title: 'Voix — sans cloud', desc: "Dictée et lecture via Whisper.cpp, en local. Parlez votre prompt, écoutez la réponse. Sans internet." },
        { icon: '💬', title: 'Bridges WhatsApp + Email', desc: "Déclenchez l'agent depuis votre téléphone ou votre boîte mail. Répondez à un email, obtenez une tâche exécutée." },
        { icon: '🔌', title: 'Endpoints custom', desc: "Branchez n'importe quel modèle compatible OpenAI — Ollama local, la machine d'un ami, votre propre serveur." },
      ],
    },
    comparison: {
      label: 'Comparaison',
      h2a: 'Monkey face aux',
      h2b: 'alternatives',
      desc: "Le seul assistant qui combine exécution locale, agent autonome et voix — sans qu'une seule donnée quitte votre machine.",
      cols: ['Capacité', '🐒 Monkey', 'ChatGPT', 'Ollama', 'OpenClaw', 'HermesAgent'],
      rows: [
        { label: 'Local-first (aucune donnée envoyée)', monkey: 'yes' as Cell, chatgpt: 'no' as Cell, ollama: 'yes' as Cell, openclaw: 'no' as Cell, hermesagent: 'yes' as Cell },
        { label: 'Agent autonome (plans multi-étapes)', monkey: 'yes' as Cell, chatgpt: 'partial' as Cell, ollama: 'no' as Cell, openclaw: 'yes' as Cell, hermesagent: 'partial' as Cell },
        { label: 'Voix hors ligne (sans cloud STT)', monkey: 'yes' as Cell, chatgpt: 'yes' as Cell, ollama: 'no' as Cell, openclaw: 'no' as Cell, hermesagent: 'no' as Cell },
        { label: 'Calendrier + planification', monkey: 'yes' as Cell, chatgpt: 'partial' as Cell, ollama: 'no' as Cell, openclaw: 'no' as Cell, hermesagent: 'no' as Cell },
        { label: 'Open source (AGPLv3)', monkey: 'yes' as Cell, chatgpt: 'no' as Cell, ollama: 'yes' as Cell, openclaw: 'partial' as Cell, hermesagent: 'partial' as Cell },
        { label: 'Gratuit pour toujours', monkey: 'yes' as Cell, chatgpt: 'no' as Cell, ollama: 'yes' as Cell, openclaw: 'partial' as Cell, hermesagent: 'yes' as Cell },
      ],
    },
    install: {
      label: 'Installation',
      h2a: 'Opérationnel en',
      h2b: '2 minutes',
      desc: "Monkey n'est pas signé — pas de certificats Apple ou Microsoft. Votre OS va avertir. Voici comment contourner en toute sécurité.",
      warningTitle: 'Pourquoi cet avertissement ?',
      warningBody: "Les certificats de signature coûtent 99–299 $/an. En tant que projet open source gratuit, nous les ignorons. L'application est entièrement auditable sur GitHub — vous pouvez la compiler vous-même.",
      tabs: { macos: '🍎 macOS', windows: '🪟 Windows', linux: '🐧 Linux' } as Record<Platform, string>,
      steps: {
        macos: [
          { num: 1, title: 'Télécharger le .dmg', desc: 'Cliquez sur le bouton de téléchargement. Enregistrez Monkey-x.x.x.dmg dans votre dossier Téléchargements.' },
          { num: 2, title: "Ouvrir — ignorer l'avertissement", desc: 'Double-cliquez sur le .dmg. macOS affiche "ne peut pas être ouvert car provient d\'un développeur non identifié". Cliquez OK.' },
          { num: 3, title: 'Autoriser dans Réglages Système', desc: "Allez dans Réglages Système → Confidentialité et sécurité. Descendez — vous verrez \"Monkey a été bloqué\". Cliquez Ouvrir quand même.", code: 'Réglages Système → Confidentialité et sécurité' },
          { num: 4, title: 'Confirmer et lancer', desc: "Une dernière fenêtre demande \"Êtes-vous sûr ?\" — cliquez Ouvrir. Monkey se lance. Cette procédure n'est nécessaire qu'une fois." },
        ] as InstallStepData[],
        windows: [
          { num: 1, title: 'Télécharger le .msi', desc: 'Cliquez sur le bouton de téléchargement. Enregistrez Monkey-x.x.x.msi dans votre dossier Téléchargements.' },
          { num: 2, title: 'Cliquer "Informations supplémentaires"', desc: 'SmartScreen affiche un avertissement bleu. Cliquez "Informations supplémentaires" pour faire apparaître "Exécuter quand même".', code: 'SmartScreen → Infos supplémentaires → Exécuter quand même' },
          { num: 3, title: "Suivre l'assistant d'installation", desc: "Acceptez la licence, choisissez le répertoire. Monkey sera disponible depuis le menu Démarrer." },
        ] as InstallStepData[],
        linux: [
          { num: 1, title: 'Télécharger le .AppImage', desc: 'Cliquez sur le bouton de téléchargement. Enregistrez Monkey-x.x.x.AppImage où vous voulez (ex : ~/Applications/).' },
          { num: 2, title: 'Rendre exécutable', desc: 'Ouvrez un terminal et exécutez :', code: 'chmod +x Monkey-x.x.x.AppImage' },
          { num: 3, title: 'Lancer', desc: 'Double-cliquez sur le fichier, ou depuis le terminal :', code: './Monkey-x.x.x.AppImage' },
        ] as InstallStepData[],
      },
      buildLabel: 'Préférez compiler depuis les sources ?',
      buildLink: 'Instructions sur GitHub →',
    },
    privacy: {
      label: 'Confidentialité et confiance',
      h2a: 'Bâti sur la',
      h2b: 'transparence radicale',
      items: [
        { icon: '🔍', title: 'AGPLv3 — entièrement auditable', desc: "Chaque ligne de code est publique. Forkez-le, auditez-le, modifiez-le. Aucun appel réseau caché, aucun binaire obfusqué." },
        { icon: '📵', title: 'Zéro télémétrie', desc: "Pas d'analytics, pas de rapports de crash, pas de traçage d'utilisation. L'app ne fait jamais de requête réseau sans votre accord." },
        { icon: '💾', title: 'Stockage local uniquement', desc: "Mémoire, conversations, fichiers — chiffrés sur votre disque. Même si notre serveur disparaissait, vos données restent intactes." },
        { icon: '🌐', title: 'Réseau P2P (bientôt)', desc: 'Partagez votre GPU, gagnez des crédits. Les prompts restent chiffrés de bout en bout via Noise Protocol — le matchmaker ne voit rien.' },
      ],
      ctaEyebrow: 'Gratuit · Open source · Sans compte requis',
      ctaH2: 'Prêt à maîtriser votre IA ?',
      ctaBody: 'Téléchargez Monkey, installez Ollama, et vous tournez entièrement hors ligne en moins de 5 minutes.',
      ctaGithub: '★ Star sur GitHub',
    },
    footer: {
      privacy: 'Confidentialité',
      github: 'GitHub',
      license: 'Licence AGPLv3',
      copy: '© 2026 Progsoft. Gratuit pour toujours.',
    },
    modal: {
      title: (os: string) => `Installation sur ${os}`,
      subtitle: "Monkey n'est pas signé. Votre OS va alerter — voici comment l'autoriser :",
      continueBtn: (os: string) => `Continuer — télécharger pour ${os}`,
      cancel: 'Annuler',
    },
  },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  return 'linux';
}

const PLATFORM_LABELS: Record<Platform, string> = {
  macos: 'macOS', windows: 'Windows', linux: 'Linux',
};

// ─── ComparisonChip ──────────────────────────────────────────────────────────

function ComparisonChip({ v }: { v: Cell }) {
  if (v === 'yes') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: 'oklch(62% 0.17 148 / 0.12)', color: 'var(--green)', border: '1px solid oklch(62% 0.17 148 / 0.25)' }}>
      <Check size={11} strokeWidth={3} /> Yes
    </span>
  );
  if (v === 'no') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: 'oklch(50% 0.15 25 / 0.1)', color: 'oklch(65% 0.15 25)', border: '1px solid oklch(50% 0.15 25 / 0.2)' }}>
      <X size={11} strokeWidth={3} /> No
    </span>
  );
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700, background: 'oklch(72% 0.14 82 / 0.1)', color: 'oklch(72% 0.14 82)', border: '1px solid oklch(72% 0.14 82 / 0.2)' }}>
      <Minus size={11} strokeWidth={3} /> Partial
    </span>
  );
}

// ─── DownloadModal ───────────────────────────────────────────────────────────

function DownloadModal({ os, lang, onConfirm, onClose }: {
  os: Platform; lang: Lang; onConfirm: () => void; onClose: () => void;
}) {
  const s = T[lang];
  const steps = s.install.steps[os];
  const osLabel = PLATFORM_LABELS[os];

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 16, padding: 32, maxWidth: 520, width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)', letterSpacing: -0.5, marginBottom: 6 }}>
            {s.modal.title(osLabel)}
          </h3>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', fontWeight: 500 }}>{s.modal.subtitle}</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {steps.map(step => (
            <div key={step.num} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 7, background: 'oklch(62% 0.17 148 / 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: 'var(--green)' }}>
                {step.num}
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>{step.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{step.desc}</div>
                {step.code && (
                  <code style={{ display: 'inline-block', marginTop: 5, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--green)', background: 'oklch(62% 0.17 148 / 0.07)', padding: '3px 9px', borderRadius: 5, border: '1px solid oklch(62% 0.17 148 / 0.15)' }}>
                    {step.code}
                  </code>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onConfirm}
            style={{ flex: 1, background: 'var(--green)', color: '#000', border: 'none', borderRadius: 9, padding: '11px 20px', fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          >
            <Download size={15} />
            {s.modal.continueBtn(osLabel)}
          </button>
          <button
            onClick={onClose}
            style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 9, padding: '11px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            {s.modal.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Nav ─────────────────────────────────────────────────────────────────────

function Nav({ lang, onLangChange, onSignIn, onDownload, downloadAvailable }: {
  lang: Lang; onLangChange: (l: Lang) => void; onSignIn: () => void;
  onDownload: () => void; downloadAvailable: boolean;
}) {
  const s = T[lang].nav;
  return (
    <nav style={{ position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 48px', background: 'rgba(8,8,8,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
      <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        <MonkeyLogo size={26} />
        <span style={{ fontSize: 16, fontWeight: 900, color: 'var(--text)', letterSpacing: -0.4, fontFamily: 'Inter, Nunito, sans-serif' }}>Monkey</span>
      </a>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        {(['features', 'install'] as const).map(k => (
          <a key={k} href={`#${k}`} style={{ color: 'var(--text-muted)', fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>
            {s[k]}
          </a>
        ))}
        <a href="https://github.com/guillaume34110/llm-agent-" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', fontSize: 13.5, fontWeight: 600, textDecoration: 'none' }}>
          {s.github} ↗
        </a>
        <button onClick={onSignIn} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
          {s.signIn}
        </button>
        <div style={{ display: 'flex', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, padding: 3, gap: 2 }}>
          {(['en', 'fr'] as Lang[]).map(l => (
            <button key={l} onClick={() => onLangChange(l)} style={{ padding: '3px 9px', borderRadius: 4, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', background: lang === l ? 'var(--green)' : 'transparent', color: lang === l ? '#000' : 'var(--text-muted)', fontFamily: 'inherit', transition: 'all .15s' }}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={onDownload}
          disabled={!downloadAvailable}
          style={{ background: 'var(--green)', color: '#000', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 800, cursor: downloadAvailable ? 'pointer' : 'not-allowed', opacity: downloadAvailable ? 1 : 0.5, fontFamily: 'inherit' }}
        >
          ↓ {s.download}
        </button>
      </div>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero({ lang, os, available, loading, onDownload, onGithub }: {
  lang: Lang; os: Platform; available: Record<Platform, boolean>;
  loading: boolean; onDownload: () => void; onGithub: () => void;
}) {
  const s = T[lang].hero;
  const canDownload = !loading && available[os];

  return (
    <section id="download" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '80px 24px', position: 'relative', overflow: 'hidden' }}>
      {/* Radial glow — breathing */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 800, height: 800, background: 'radial-gradient(circle, oklch(62% 0.17 148 / 0.14) 0%, transparent 68%)', pointerEvents: 'none', animation: 'glowBreathe 5s ease-in-out infinite' }} />
      {/* Secondary smaller glow */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 340, height: 340, background: 'radial-gradient(circle, oklch(62% 0.17 148 / 0.08) 0%, transparent 70%)', pointerEvents: 'none', animation: 'glowBreathe 3.5s ease-in-out infinite reverse' }} />

      {/* Eyebrow — slideUp 0ms */}
      <div style={{ animation: `slideUp 500ms ${E} 0ms both`, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 28, padding: '6px 16px', border: '1px solid oklch(62% 0.17 148 / 0.25)', borderRadius: 99, background: 'oklch(62% 0.17 148 / 0.06)', position: 'relative' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s infinite', display: 'inline-block' }} />
        {s.eyebrow}
      </div>

      {/* H1 — 3 words staggered */}
      <h1 style={{ animation: `slideUp 600ms ${E} 100ms both`, fontSize: 'clamp(40px, 7vw, 80px)', fontWeight: 900, lineHeight: 1.05, letterSpacing: -2.5, color: 'var(--text)', marginBottom: 24, maxWidth: 900, position: 'relative', fontFamily: 'Inter, Nunito, sans-serif' }}>
        <span style={{ display: 'inline-block', animation: `slideUp 550ms ${E} 120ms both` }}>{s.h1[0]}</span>{' '}
        <span style={{ display: 'inline-block', animation: `slideUp 550ms ${E} 200ms both` }}>{s.h1[1]}</span>{' '}
        <span style={{ display: 'inline-block', animation: `slideUp 550ms ${E} 280ms both`, color: 'var(--green)' }}>{s.h1[2]}</span>
      </h1>

      {/* Subtitle */}
      <p style={{ animation: `slideUp 600ms ${E} 360ms both`, fontSize: 'clamp(15px, 2vw, 18px)', color: 'var(--text-muted)', maxWidth: 520, lineHeight: 1.7, marginBottom: 48, fontWeight: 500, position: 'relative' }}>
        {s.subtitle}
      </p>

      {/* CTAs */}
      <div style={{ animation: `slideUp 600ms ${E} 460ms both`, display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center', position: 'relative', marginBottom: 48 }}>
        <button
          onClick={canDownload ? onDownload : undefined}
          disabled={!canDownload}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--green)', color: '#000', padding: '14px 28px', borderRadius: 10, fontSize: 15, fontWeight: 800, border: 'none', cursor: canDownload ? 'pointer' : 'not-allowed', opacity: canDownload ? 1 : 0.6, boxShadow: '0 0 32px oklch(62% 0.17 148 / 0.35)', fontFamily: 'inherit', transition: 'transform .15s, box-shadow .15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 48px oklch(62% 0.17 148 / 0.5)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = ''; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 32px oklch(62% 0.17 148 / 0.35)'; }}
        >
          <Download size={16} />
          {loading ? '…' : canDownload ? s.downloadBtn(PLATFORM_LABELS[os]) : s.unavailable}
        </button>
        <button
          onClick={onGithub}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', color: 'var(--text-muted)', padding: '14px 28px', borderRadius: 10, fontSize: 15, fontWeight: 700, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', transition: 'border-color .15s, color .15s, transform .15s' }}
          onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = 'oklch(62% 0.17 148 / 0.5)'; b.style.color = 'var(--text)'; b.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = ''; b.style.color = ''; b.style.transform = ''; }}
        >
          <ArrowRight size={16} />
          {s.githubBtn}
        </button>
      </div>

      {/* Badges — staggered */}
      <div style={{ animation: `slideUp 600ms ${E} 560ms both`, display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', position: 'relative' }}>
        {s.badges.map((b, i) => (
          <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', animation: `slideUp 500ms ${E} ${580 + i * 60}ms both` }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'oklch(62% 0.17 148 / 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)', fontSize: 9, fontWeight: 900 }}>✓</div>
            {b}
          </div>
        ))}
      </div>

      {/* Scroll hint */}
      <div style={{ position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)', color: 'var(--border)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, animation: `float 2.5s ease-in-out infinite, slideUp 600ms ${E} 900ms both` }}>
        <span>{s.scroll}</span>
        <div style={{ width: 1, height: 28, background: 'linear-gradient(to bottom, var(--border), transparent)' }} />
      </div>
    </section>
  );
}

// ─── FeaturesSection ─────────────────────────────────────────────────────────

function FeaturesSection({ lang }: { lang: Lang }) {
  const s = T[lang].features;
  return (
    <section id="features" style={{ padding: '100px 24px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <AnimIn><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 14 }}>{s.label}</div></AnimIn>
        <AnimIn delay={80}><h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 900, letterSpacing: -1, color: 'var(--text)', marginBottom: 14, lineHeight: 1.1, fontFamily: 'Inter, Nunito, sans-serif' }}>
          {s.h2a}<br /><span style={{ color: 'var(--green)' }}>{s.h2b}</span>
        </h2></AnimIn>
        <AnimIn delay={140}><p style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 540, lineHeight: 1.7, marginBottom: 56, fontWeight: 500 }}>{s.desc}</p></AnimIn>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
          {s.items.map((item, i) => (
            <AnimIn key={item.title} delay={i * 70} style={{ background: 'var(--bg2)', position: 'relative' }}>
              <div
                style={{ padding: 32, position: 'relative', transition: 'background .2s', height: '100%' }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.background = 'var(--bg3)';
                  const line = e.currentTarget.querySelector('.top-line') as HTMLElement;
                  if (line) line.style.opacity = '1';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.background = '';
                  const line = e.currentTarget.querySelector('.top-line') as HTMLElement;
                  if (line) line.style.opacity = '0';
                }}
              >
                <div className="top-line" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--green)', opacity: 0, transition: 'opacity .2s' }} />
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'oklch(62% 0.17 148 / 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, fontSize: 18, transition: 'transform .2s', }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.12)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; }}
                >
                  {item.icon}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginBottom: 8, fontFamily: 'Inter, Nunito, sans-serif' }}>{item.title}</div>
                <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.65, fontWeight: 500 }}>{item.desc}</div>
              </div>
            </AnimIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── ComparisonSection ───────────────────────────────────────────────────────

function ComparisonSection({ lang }: { lang: Lang }) {
  const s = T[lang].comparison;
  return (
    <section style={{ padding: '100px 24px', background: 'var(--bg2)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <AnimIn><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 14 }}>{s.label}</div></AnimIn>
        <AnimIn delay={80}><h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 900, letterSpacing: -1, color: 'var(--text)', marginBottom: 14, lineHeight: 1.1, fontFamily: 'Inter, Nunito, sans-serif' }}>
          {s.h2a} <span style={{ color: 'var(--green)' }}>{s.h2b}</span>
        </h2></AnimIn>
        <AnimIn delay={140}><p style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 600, lineHeight: 1.7, marginBottom: 48, fontWeight: 500 }}>{s.desc}</p></AnimIn>

        <AnimIn delay={200}><div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, fontFamily: 'Inter, Nunito, sans-serif' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '16px 20px', textAlign: 'left', fontWeight: 800, fontSize: 13, color: 'var(--text-muted)', letterSpacing: '.03em', width: '25%' }}>{s.cols[0]}</th>
                <th style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 800, fontSize: 13, color: 'var(--green)', width: '15%' }}>{s.cols[1]}</th>
                <th style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 800, fontSize: 13, color: 'var(--text-muted)', width: '15%' }}>{s.cols[2]}</th>
                <th style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 800, fontSize: 13, color: 'var(--text-muted)', width: '15%' }}>{s.cols[3]}</th>
                <th style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 800, fontSize: 13, color: 'var(--text-muted)', width: '15%' }}>{s.cols[4]}</th>
                <th style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 800, fontSize: 13, color: 'var(--text-muted)', width: '15%' }}>{s.cols[5]}</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row, i) => (
                <tr key={row.label} style={{ borderBottom: i < s.rows.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '14px 20px', color: 'var(--text)', fontWeight: 600 }}>{row.label}</td>
                  <td style={{ padding: '14px 20px', textAlign: 'center', background: 'oklch(62% 0.17 148 / 0.04)' }}><ComparisonChip v={row.monkey} /></td>
                  <td style={{ padding: '14px 20px', textAlign: 'center' }}><ComparisonChip v={row.chatgpt} /></td>
                  <td style={{ padding: '14px 20px', textAlign: 'center' }}><ComparisonChip v={row.ollama} /></td>
                  <td style={{ padding: '14px 20px', textAlign: 'center' }}><ComparisonChip v={row.openclaw} /></td>
                  <td style={{ padding: '14px 20px', textAlign: 'center' }}><ComparisonChip v={row.hermesagent} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></AnimIn>
      </div>
    </section>
  );
}

// ─── InstallGuide ────────────────────────────────────────────────────────────

function InstallGuide({ lang, defaultTab }: { lang: Lang; defaultTab: Platform }) {
  const [tab, setTab] = useState<Platform>(defaultTab);
  const s = T[lang].install;
  const steps = s.steps[tab];

  return (
    <section id="install" style={{ padding: '100px 24px', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <AnimIn><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 14 }}>{s.label}</div></AnimIn>
        <AnimIn delay={80}><h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 900, letterSpacing: -1, color: 'var(--text)', marginBottom: 14, lineHeight: 1.1, fontFamily: 'Inter, Nunito, sans-serif' }}>
          {s.h2a} <span style={{ color: 'var(--green)' }}>{s.h2b}</span>
        </h2></AnimIn>
        <AnimIn delay={140}><p style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 600, lineHeight: 1.7, marginBottom: 36, fontWeight: 500 }}>{s.desc}</p></AnimIn>

        {/* Warning banner */}
        <AnimIn delay={180}><div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: 'oklch(72% 0.14 82 / 0.07)', border: '1px solid oklch(72% 0.14 82 / 0.2)', borderRadius: 10, padding: '14px 18px', marginBottom: 36, fontSize: 13.5, color: 'oklch(72% 0.14 82)', fontWeight: 600, marginTop: 0 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
          <div>
            <strong>{s.warningTitle}</strong>
            {' '}{s.warningBody}
          </div>
        </div></AnimIn>

        {/* OS Tabs */}
        <AnimIn delay={220}><div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', width: 'fit-content', marginBottom: 32 }}>
          {(['macos', 'windows', 'linux'] as Platform[]).map((p, i) => (
            <button
              key={p}
              onClick={() => setTab(p)}
              style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, border: 'none', borderRight: i < 2 ? '1px solid var(--border)' : 'none', cursor: 'pointer', background: tab === p ? 'var(--bg3)' : 'var(--bg2)', color: tab === p ? 'var(--text)' : 'var(--text-muted)', transition: 'all .15s', fontFamily: 'inherit' }}
            >
              {s.tabs[p]}
            </button>
          ))}
        </div></AnimIn>

        {/* Steps */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 28 }}>
          {steps.map((step, i) => (
            <AnimIn key={step.num} delay={i * 80} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: 20 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'oklch(62% 0.17 148 / 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: 'var(--green)', marginBottom: 12 }}>
                  {step.num}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 6, fontFamily: 'Inter, Nunito, sans-serif' }}>{step.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>{step.desc}</div>
                {step.code && (
                  <code style={{ display: 'inline-block', marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: 'var(--green)', background: 'oklch(62% 0.17 148 / 0.07)', padding: '4px 10px', borderRadius: 5, border: '1px solid oklch(62% 0.17 148 / 0.15)' }}>
                    {step.code}
                  </code>
                )}
              </div>
            </AnimIn>
          ))}
        </div>

        {/* Build from source strip */}
        <AnimIn delay={120}><div style={{ padding: '14px 20px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 13.5, color: 'var(--text-muted)', fontWeight: 500 }}>{s.buildLabel}</span>
          <a href="https://github.com/guillaume34110/llm-agent-" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--green)', fontSize: 13.5, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
            {s.buildLink}
          </a>
        </div></AnimIn>
      </div>
    </section>
  );
}

// ─── PrivacySection ──────────────────────────────────────────────────────────

function PrivacySection({ lang, os, available, loading, onDownload }: {
  lang: Lang; os: Platform; available: Record<Platform, boolean>;
  loading: boolean; onDownload: () => void;
}) {
  const s = T[lang].privacy;
  const sh = T[lang].hero;
  const canDownload = !loading && available[os];

  return (
    <section style={{ padding: '100px 24px', background: 'var(--bg2)', borderTop: '1px solid var(--border)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <AnimIn><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 14 }}>{s.label}</div></AnimIn>
        <AnimIn delay={80}><h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 900, letterSpacing: -1, color: 'var(--text)', marginBottom: 56, lineHeight: 1.1, fontFamily: 'Inter, Nunito, sans-serif' }}>
          {s.h2a} <span style={{ color: 'var(--green)' }}>{s.h2b}</span>
        </h2></AnimIn>

        {/* 4-col privacy grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 32, marginBottom: 60 }}>
          {s.items.map((item, i) => (
            <AnimIn key={item.title} delay={i * 90}>
              <div style={{ fontSize: 24, marginBottom: 12, transition: 'transform .25s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.15) rotate(-5deg)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ''; }}
              >{item.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 6, fontFamily: 'Inter, Nunito, sans-serif' }}>{item.title}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{item.desc}</div>
            </AnimIn>
          ))}
        </div>

        {/* Final CTA box */}
        <AnimIn delay={80}><div style={{ textAlign: 'center', padding: '60px 40px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 20, position: 'relative', overflow: 'hidden' }}>
          {/* Bottom glow */}
          <div style={{ position: 'absolute', bottom: -60, left: '50%', transform: 'translateX(-50%)', width: 400, height: 200, background: 'radial-gradient(circle, oklch(62% 0.17 148 / 0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

          <div style={{ position: 'relative' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 20, padding: '6px 16px', border: '1px solid oklch(62% 0.17 148 / 0.25)', borderRadius: 99, background: 'oklch(62% 0.17 148 / 0.06)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 2s infinite', display: 'inline-block' }} />
              {s.ctaEyebrow}
            </div>
            <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 36px)', fontWeight: 900, letterSpacing: -1, color: 'var(--text)', marginBottom: 12, fontFamily: 'Inter, Nunito, sans-serif' }}>{s.ctaH2}</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32, fontSize: 15, fontWeight: 500 }}>{s.ctaBody}</p>
            <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={canDownload ? onDownload : undefined}
                disabled={!canDownload}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--green)', color: '#000', border: 'none', padding: '14px 28px', borderRadius: 10, fontSize: 15, fontWeight: 800, cursor: canDownload ? 'pointer' : 'not-allowed', opacity: canDownload ? 1 : 0.6, boxShadow: '0 0 30px oklch(62% 0.17 148 / 0.25)', fontFamily: 'inherit' }}
              >
                <Download size={16} />
                {loading ? '…' : canDownload ? sh.downloadBtn(PLATFORM_LABELS[os]) : sh.unavailable}
              </button>
              <a href="https://github.com/guillaume34110/llm-agent-" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'transparent', color: 'var(--text-muted)', padding: '14px 28px', borderRadius: 10, fontSize: 15, fontWeight: 700, border: '1px solid var(--border)', textDecoration: 'none' }}>
                {s.ctaGithub}
              </a>
            </div>
          </div>
        </div></AnimIn>
      </div>
    </section>
  );
}

// ─── SiteFooter ──────────────────────────────────────────────────────────────

function SiteFooter({ lang }: { lang: Lang }) {
  const s = T[lang].footer;
  return (
    <footer style={{ borderTop: '1px solid var(--border)', padding: '22px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 12.5, color: 'var(--text-dim)', background: 'var(--bg)', fontFamily: 'Inter, Nunito, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <MonkeyLogo size={20} />
        <span>Monkey — Progsoft AI</span>
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        {[
          { label: s.privacy, href: '/privacy' },
          { label: s.github, href: 'https://github.com/guillaume34110/llm-agent-' },
          { label: s.license, href: 'https://github.com/guillaume34110/llm-agent-/blob/main/LICENSE' },
        ].map(link => (
          <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-dim)', textDecoration: 'none' }}>
            {link.label}
          </a>
        ))}
      </div>
      <span>{s.copy}</span>
    </footer>
  );
}

// ─── Landing (main) ──────────────────────────────────────────────────────────

export default function Landing({ onSignIn }: LandingProps) {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem('lang');
    return (saved === 'en' || saved === 'fr') ? saved : 'en';
  });
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState<Record<Platform, boolean>>({ macos: false, windows: false, linux: false });
  const [showModal, setShowModal] = useState(false);
  const os = React.useMemo(detectPlatform, []);

  useEffect(() => {
    axios.get('/api/downloads/app')
      .then(r => {
        const map: Record<Platform, boolean> = { macos: false, windows: false, linux: false };
        for (const rel of r.data) map[rel.platform as Platform] = true;
        setAvailable(map);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const handleLangChange = (l: Lang) => {
    setLang(l);
    localStorage.setItem('lang', l);
  };

  const handleDownload = () => {
    if (available[os]) setShowModal(true);
  };

  const handleConfirmDownload = () => {
    setShowModal(false);
    window.location.href = `/api/downloads/app/${os}`;
  };

  const handleGithub = () => {
    window.open('https://github.com/guillaume34110/llm-agent-', '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ width: '100%', height: '100%', overflowY: 'auto', background: 'var(--bg)', fontFamily: 'Inter, Nunito, sans-serif' }}>
      {showModal && (
        <DownloadModal
          os={os}
          lang={lang}
          onConfirm={handleConfirmDownload}
          onClose={() => setShowModal(false)}
        />
      )}
      <Nav
        lang={lang}
        onLangChange={handleLangChange}
        onSignIn={onSignIn}
        onDownload={handleDownload}
        downloadAvailable={!loading && available[os]}
      />
      <Hero
        lang={lang}
        os={os}
        available={available}
        loading={loading}
        onDownload={handleDownload}
        onGithub={handleGithub}
      />
      <FeaturesSection lang={lang} />
      <ComparisonSection lang={lang} />
      <InstallGuide lang={lang} defaultTab={os} />
      <PrivacySection
        lang={lang}
        os={os}
        available={available}
        loading={loading}
        onDownload={handleDownload}
      />
      <SiteFooter lang={lang} />
    </div>
  );
}

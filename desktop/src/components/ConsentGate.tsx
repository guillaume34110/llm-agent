import React, { useState } from 'react';
import { writeConsent } from '../compliance/consent-service';

interface Props {
  onAccept: () => void;
}

export default function ConsentGate({ onAccept }: Props) {
  const [age, setAge] = useState(false);
  const [consent, setConsent] = useState(false);
  const canAccept = age && consent;

  const accept = () => {
    if (!canAccept) return;
    writeConsent({ ageConfirmed: true, consentDataProcessing: true });
    onAccept();
  };

  const quit = () => {
    // Best-effort exit. Tauri window close fallback to window.close().
    import('@tauri-apps/api/window')
      .then(m => m.getCurrentWindow().close())
      .catch(() => window.close());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      className="fixed inset-0 z-[9999] bg-[rgba(0,0,0,0.65)] flex items-center justify-center p-[20px]"
    >
      <div
        className="max-w-[520px] w-full bg-[var(--bg,#1a1a1a)] text-[var(--text,#eee)] border border-[var(--border,#333)] rounded-[12px] p-[24px] shadow-[0_12px_40px_rgba(0,0,0,0.5)] text-[14px] leading-[1.5]"
      >
        <h2 id="consent-title" className="mt-0 text-[18px]">
          Welcome — please read before continuing
        </h2>
        <p className="opacity-[0.85]">
          This application runs open-weight LLMs <strong>locally on your machine</strong> or
          via the peer-to-peer community network (end-to-end encrypted). The Progsoft server
          does <strong>not</strong> store your conversation content — all personal data stays
          on this device. The app is free, no subscription, no top-ups.
        </p>
        <p className="opacity-[0.85]">
          Responses are AI-generated and may contain errors. Do not use them as a substitute for
          professional advice (legal, medical, financial).
        </p>
        <label className="flex items-start gap-[10px] my-[14px] cursor-pointer">
          <input
            type="checkbox"
            checked={age}
            onChange={e => setAge(e.target.checked)}
            className="mt-[3px]"
            data-testid="consent-age"
          />
          <span>I confirm I am at least <strong>16 years old</strong>.</span>
        </label>
        <label className="flex items-start gap-[10px] my-[14px] cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
            className="mt-[3px]"
            data-testid="consent-data"
          />
          <span>
            I understand my prompts are sent to the ProgsoftAI backend (and its subprocessors listed in the legal notice) and accept the&nbsp;
            <a href="#" onClick={e => { e.preventDefault(); /* TODO step 5: open ToS modal */ }} className="text-[var(--accent,#6ab07a)]">Terms of Service</a>
            &nbsp;and&nbsp;
            <a href="#" onClick={e => { e.preventDefault(); /* TODO step 5: open Privacy modal */ }} className="text-[var(--accent,#6ab07a)]">Privacy Policy</a>.
          </span>
        </label>
        <div className="flex gap-[10px] justify-end mt-[18px]">
          <button
            onClick={quit}
            className="px-[16px] py-[8px] rounded-[8px] border border-[var(--border,#444)] bg-transparent text-[var(--text,#eee)] cursor-pointer"
            data-testid="consent-quit"
          >
            Quit
          </button>
          <button
            onClick={accept}
            disabled={!canAccept}
            style={{
              background: canAccept ? 'var(--accent, #3a7c52)' : 'var(--border, #444)',
              cursor: canAccept ? 'pointer' : 'not-allowed',
              opacity: canAccept ? 1 : 0.6,
            }}
            className="px-[20px] py-[8px] rounded-[8px] border-none text-white"
            data-testid="consent-accept"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

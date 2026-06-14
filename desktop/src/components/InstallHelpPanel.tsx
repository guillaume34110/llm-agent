// In-app bypass guide for the unsigned indie build. Shown in Settings so
// users who already got the app running can share clear instructions with
// friends who hit the Gatekeeper / SmartScreen warning on first launch.
//
// Same source of truth as desktop/install-help/INSTALL.txt — keep both in
// sync when you change one.

import React, { useMemo, useState } from 'react';
import { Shield, Apple, Monitor, Terminal, Copy, Check } from 'lucide-react';

type Os = 'macos' | 'windows' | 'linux';

function detectOs(): Os {
  const p = navigator.platform.toLowerCase();
  if (p.includes('mac')) return 'macos';
  if (p.includes('win')) return 'windows';
  return 'linux';
}

function CmdLine({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex items-center gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--r)] px-[10px] py-[6px] font-mono text-[11px]">
      <code className="flex-1 text-[var(--text)] break-all">{cmd}</code>
      <button
        onClick={onCopy}
        title="Copy"
        className="border-none bg-transparent text-[var(--text-dim)] cursor-pointer p-1"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

export default function InstallHelpPanel() {
  const initial = useMemo(detectOs, []);
  const [os, setOs] = useState<Os>(initial);

  return (
    <div className="p-[18px] grid gap-[14px]">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
          <Shield size={18} strokeWidth={2.4} className="text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-[900] text-[var(--text)]">Install / bypass guide</div>
          <div className="mt-[4px] text-[11.5px] text-[var(--text-dim)] leading-[1.5]">
            MonkeyAgent ships unsigned. macOS and Windows show a warning on first launch — that's
            normal for indie / open-source apps without paid signing certs. Use the steps
            below once, then it never warns again.
          </div>
        </div>
      </div>

      <div className="flex gap-1 border border-[var(--border)] rounded-[var(--r)] p-1 w-fit">
        {([
          ['macos', 'macOS', Apple],
          ['windows', 'Windows', Monitor],
          ['linux', 'Linux', Terminal],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setOs(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r)] border-none cursor-pointer text-[11.5px] font-[700] ${
              os === key
                ? 'bg-[var(--accent)] text-[var(--on-accent,white)]'
                : 'bg-transparent text-[var(--text-muted)]'
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {os === 'macos' && (
        <div className="grid gap-3 text-[12px] text-[var(--text)] leading-[1.55]">
          <div>
            <div className="font-[800] mb-1">Easiest</div>
            <div className="text-[var(--text-dim)]">
              Open MonkeyAgent.dmg, double-click <code className="font-mono bg-[var(--bg)] px-1 rounded">macos-install.command</code>{' '}
              inside it. It removes the quarantine flag and launches the app.
            </div>
          </div>
          <div>
            <div className="font-[800] mb-1">Manual (Terminal)</div>
            <div className="text-[var(--text-dim)] mb-1.5">
              Drag MonkeyAgent.app to <code className="font-mono bg-[var(--bg)] px-1 rounded">/Applications</code>, then run:
            </div>
            <CmdLine cmd="xattr -dr com.apple.quarantine /Applications/MonkeyAgent.app" />
          </div>
          <div>
            <div className="font-[800] mb-1">No-Terminal alternative</div>
            <div className="text-[var(--text-dim)]">
              Double-click MonkeyAgent.app, see the warning, click Cancel. Then{' '}
              <b>System Settings → Privacy &amp; Security</b> → scroll down → <b>Open anyway</b>.
            </div>
          </div>
        </div>
      )}

      {os === 'windows' && (
        <div className="grid gap-3 text-[12px] text-[var(--text)] leading-[1.55]">
          <div>
            <div className="font-[800] mb-1">Easiest</div>
            <div className="text-[var(--text-dim)]">
              Download the <code className="font-mono bg-[var(--bg)] px-1 rounded">MonkeyAgent-Setup.zip</code>{' '}
              bundle, extract it, double-click <code className="font-mono bg-[var(--bg)] px-1 rounded">windows-install.bat</code>.
              It unblocks the MSI and launches the installer.
            </div>
          </div>
          <div>
            <div className="font-[800] mb-1">Manual</div>
            <div className="text-[var(--text-dim)]">
              Right-click MonkeyAgent.msi → <b>Properties</b> → check <b>Unblock</b> → OK. Then run the
              installer. If SmartScreen still appears: <b>More info → Run anyway</b>.
            </div>
          </div>
          <div>
            <div className="font-[800] mb-1">PowerShell</div>
            <CmdLine cmd="Unblock-File -Path .\MonkeyAgent.msi; .\MonkeyAgent.msi" />
          </div>
        </div>
      )}

      {os === 'linux' && (
        <div className="grid gap-3 text-[12px] text-[var(--text)] leading-[1.55]">
          <div className="text-[var(--text-dim)]">
            No bypass needed — Linux does not gate unsigned binaries. Just make the AppImage
            executable and run it:
          </div>
          <CmdLine cmd="chmod +x MonkeyAgent-*.AppImage && ./MonkeyAgent-*.AppImage" />
        </div>
      )}

      <div className="text-[11px] text-[var(--text-dim)] border-t border-[var(--border)] pt-3 leading-[1.55]">
        <b>Why no signature?</b> Apple Developer ID and Windows code-signing certificates
        cost $99–$500/year each and would just pass cost onto users. The MonkeyAgent binary is
        open source — verify or build it yourself at{' '}
        <a
          href="https://github.com/guillaume34110/llm-agent-"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] underline"
        >
          github.com/guillaume34110/llm-agent-
        </a>
        .
      </div>
    </div>
  );
}

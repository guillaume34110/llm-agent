import React, { useEffect, useState } from 'react';
import axios from 'axios';
import MonkeyLogo from './MonkeyLogo';

interface AppReleaseInfo {
  platform: string;
  version: string;
  filename: string;
  size: number;
  sha256: string;
}

const PLATFORM_LABELS: Record<string, { icon: string; label: string; ext: string }> = {
  linux:   { icon: '🐧', label: 'Linux',   ext: '.AppImage' },
  macos:   { icon: '🍎', label: 'macOS',   ext: '.dmg' },
  windows: { icon: '🪟', label: 'Windows', ext: '.msi' },
};

function detectOS(): string {
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return 'windows';
  if (/Mac|iPhone|iPad/i.test(ua)) return 'macos';
  return 'linux';
}

export default function DownloadMonkey() {
  const [releases, setReleases] = useState<AppReleaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const currentOS = detectOS();

  useEffect(() => {
    axios.get('/api/downloads/app', { withCredentials: true })
      .then(r => setReleases(r.data))
      .catch(() => setReleases([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 14, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <MonkeyLogo size={20} />
        <p style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Agent Monkey Desktop
        </p>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10, fontWeight: 500 }}>
        L'assistant local pour tous — automatisez, gérez, créez.
      </p>

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '4px 2px' }}>
          Vérification des builds…
        </div>
      )}

      {!loading && releases.length === 0 && (
        Object.entries(PLATFORM_LABELS).map(([platform, meta]) => {
          const isRec = platform === currentOS;
          return (
            <div
              key={platform}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                borderRadius: 'var(--radius-sm)', background: 'var(--bg3)',
                border: `1px solid ${isRec ? 'var(--green)' : 'var(--border)'}`,
                marginBottom: 6, opacity: 0.5,
              }}
            >
              <span style={{ fontSize: 15 }}>{meta.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
                  {meta.label}{meta.ext}
                  {isRec && <span style={{ marginLeft: 6, color: 'var(--green)', fontWeight: 700, fontSize: 10 }}>✓ recommandé</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Bientôt disponible</div>
              </div>
              <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>↓</span>
            </div>
          );
        })
      )}

      {!loading && releases.map(r => {
        const meta = PLATFORM_LABELS[r.platform] || { icon: '💾', label: r.platform, ext: '' };
        const isRec = r.platform === currentOS;
        return (
          <a
            key={r.platform}
            href={`/api/downloads/app/${r.platform}`}
            download={r.filename}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
              borderRadius: 'var(--radius-sm)', background: 'var(--bg3)',
              border: `1px solid ${isRec ? 'var(--green)' : 'var(--border)'}`,
              marginBottom: 6, textDecoration: 'none', transition: 'border-color 0.15s',
            }}
            onMouseOver={e => (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--green)'}
            onMouseOut={e => (e.currentTarget as HTMLAnchorElement).style.borderColor = isRec ? 'var(--green)' : 'var(--border)'}
          >
            <span style={{ fontSize: 15 }}>{meta.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>
                {meta.label}{meta.ext}
                {isRec && <span style={{ marginLeft: 6, color: 'var(--green)', fontWeight: 700, fontSize: 10 }}>✓ recommandé</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                v{r.version} · {(r.size / 1024 / 1024).toFixed(1)} MB
              </div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>↓</span>
          </a>
        );
      })}
    </div>
  );
}

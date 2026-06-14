import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getConnectorStatus,
  startConnector,
  stopConnector,
  regenerateConnectorKey,
  type ConnectorInfo,
} from '../openai/connector-client';

function inputCls(): string {
  return 'px-[10px] py-[8px] bg-[var(--bg2)] border border-[var(--border)] rounded-[var(--r)] text-[var(--text)] text-[12.5px] font-Nunito';
}

function btnCls(variant: 'primary' | 'ghost' | 'danger' = 'ghost'): string {
  const base = 'px-[12px] py-[6px] rounded-[var(--r)] text-[12px] font-[800] font-Nunito cursor-pointer border border-[var(--border)]';
  if (variant === 'primary') return `${base} bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]`;
  if (variant === 'danger') return `${base} bg-transparent text-[oklch(70%_0.16_25)] border-[oklch(40%_0.12_25)]`;
  return `${base} bg-[var(--bg2)] text-[var(--text-muted)]`;
}

export default function OpenAiConnectorPanel() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ConnectorInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setInfo(await getConnectorStatus());
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onStart = async () => {
    setErr(null);
    setBusy('start');
    try {
      setInfo(await startConnector());
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const onStop = async () => {
    setErr(null);
    setBusy('stop');
    try {
      await stopConnector();
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const onRegenerate = async () => {
    setErr(null);
    setBusy('regen');
    try {
      await regenerateConnectorKey();
      if (info?.running) {
        await stopConnector();
        setInfo(await startConnector());
      } else {
        await refresh();
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1200);
    } catch {}
  };

  const url = info?.url ?? 'http://127.0.0.1:?/v1';
  const apiKey = info?.apiKey ?? '';
  const maskedKey = apiKey ? `${apiKey.slice(0, 6)}${'•'.repeat(Math.max(0, apiKey.length - 10))}${apiKey.slice(-4)}` : '';

  const exampleCurl = info?.url
    ? `curl ${url}/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"phi-4-mini-instruct","messages":[{"role":"user","content":"hello"}]}'`
    : '';

  return (
    <div className="p-[18px]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[13.5px] font-black text-[var(--text)]">
            {t('openaiConnector.title', 'OpenAI-compatible connector')}
          </div>
          <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed max-w-[640px]">
            {t(
              'openaiConnector.description',
              'Expose an OpenAI-compatible /v1 endpoint on 127.0.0.1 so any external app (LangChain, LiteLLM, IDE plugins, curl scripts) can route through MonkeyAgent: local llama → your other devices → friend providers. Bind is loopback-only, Bearer-auth required, no cloud fallback, prompts never logged.',
            )}
          </div>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          {info?.running ? (
            <span className="text-[11px] font-black text-[oklch(70%_0.18_140)] px-[8px] py-[3px] rounded-full bg-[oklch(30%_0.10_140/0.25)] border border-[oklch(40%_0.14_140)]">
              {t('openaiConnector.statusOn', 'ON')}
            </span>
          ) : (
            <span className="text-[11px] font-black text-[var(--text-dim)] px-[8px] py-[3px] rounded-full bg-[var(--bg2)] border border-[var(--border)]">
              {t('openaiConnector.statusOff', 'OFF')}
            </span>
          )}
          {info?.running ? (
            <button
              type="button"
              className={btnCls('danger')}
              disabled={busy !== null}
              onClick={onStop}
            >
              {busy === 'stop' ? t('openaiConnector.stopping', 'Stopping…') : t('openaiConnector.stop', 'Stop')}
            </button>
          ) : (
            <button
              type="button"
              className={btnCls('primary')}
              disabled={busy !== null}
              onClick={onStart}
            >
              {busy === 'start' ? t('openaiConnector.starting', 'Starting…') : t('openaiConnector.start', 'Start')}
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="mt-3 p-[10px] rounded-[var(--r)] border border-[oklch(40%_0.14_25)] bg-[oklch(20%_0.08_25/0.4)] text-[12px] text-[oklch(80%_0.14_25)]">
          {err}
        </div>
      )}

      {info && (
        <div className="mt-4 grid grid-cols-1 gap-3">
          <div>
            <div className="text-[11px] font-black text-[var(--text-dim)] uppercase tracking-wide mb-1">
              {t('openaiConnector.baseUrl', 'Base URL')}
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                readOnly
                value={info.url ?? t('openaiConnector.notRunning', '(not running — press Start)')}
                className={`${inputCls()} flex-1 font-mono text-[12px]`}
              />
              <button
                type="button"
                className={btnCls('ghost')}
                disabled={!info.url}
                onClick={() => info.url && copy('url', info.url)}
              >
                {copied === 'url' ? t('openaiConnector.copied', 'Copied') : t('openaiConnector.copy', 'Copy')}
              </button>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-black text-[var(--text-dim)] uppercase tracking-wide mb-1 flex items-center gap-2">
              {t('openaiConnector.apiKey', 'API key')}
              <span className="text-[10px] font-normal text-[var(--text-dim)] normal-case">
                {t('openaiConnector.apiKeyHint', '(Bearer token — keep private)')}
              </span>
            </div>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                readOnly
                value={revealKey ? apiKey : maskedKey}
                className={`${inputCls()} flex-1 font-mono text-[12px]`}
              />
              <button
                type="button"
                className={btnCls('ghost')}
                onClick={() => setRevealKey((v) => !v)}
              >
                {revealKey ? t('openaiConnector.hide', 'Hide') : t('openaiConnector.reveal', 'Reveal')}
              </button>
              <button
                type="button"
                className={btnCls('ghost')}
                onClick={() => copy('key', apiKey)}
              >
                {copied === 'key' ? t('openaiConnector.copied', 'Copied') : t('openaiConnector.copy', 'Copy')}
              </button>
              <button
                type="button"
                className={btnCls('danger')}
                disabled={busy !== null}
                onClick={onRegenerate}
                title={t('openaiConnector.regenerateHint', 'Generate a new key and restart the connector')}
              >
                {busy === 'regen' ? t('openaiConnector.regenerating', 'Regenerating…') : t('openaiConnector.regenerate', 'Regenerate')}
              </button>
            </div>
          </div>

          {info.running && exampleCurl && (
            <div>
              <div className="text-[11px] font-black text-[var(--text-dim)] uppercase tracking-wide mb-1">
                {t('openaiConnector.example', 'Example')}
              </div>
              <pre className="m-0 p-[10px] rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[11.5px] font-mono text-[var(--text-muted)] overflow-auto whitespace-pre-wrap break-all leading-relaxed">
                {exampleCurl}
              </pre>
              <button
                type="button"
                className={`${btnCls('ghost')} mt-2`}
                onClick={() => copy('curl', exampleCurl)}
              >
                {copied === 'curl' ? t('openaiConnector.copied', 'Copied') : t('openaiConnector.copyCurl', 'Copy curl')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

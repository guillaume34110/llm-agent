// Bundled LLM runtime manager.
// Lists the closed catalog of open-weights GGUF models the app is allowed to
// run, lets the user download (streamed in Rust), verify SHA256, then
// activate via the in-process llama-server sidecar.
//
// Activation kills any previously running runtime — only one model active at
// a time. No external daemon, no PATH lookup, no side-loading.

import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Power, Download, Trash2, Check, Loader2, AlertTriangle, Shield } from 'lucide-react';
import { CATALOG, verifyDigest, type CatalogModel } from '../models/catalog';

interface LlamaStatus {
  running: boolean;
  pid: number | null;
  port: number | null;
  modelPath: string | null;
}

interface DownloadProgressEvt {
  modelId: string;
  downloaded: number;
  total: number;
}

type RowPhase = 'idle' | 'downloading' | 'verifying' | 'activating' | 'deleting';
interface RowState {
  phase: RowPhase;
  downloaded?: number;
  total?: number;
  error?: string;
  installed?: boolean;
  digestMismatch?: boolean;
}

function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(0)} kB`;
  return `${b} B`;
}

export default function LlmRuntimePanel() {
  const [status, setStatus] = useState<LlamaStatus>({ running: false, pid: null, port: null, modelPath: null });
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [probe, setProbe] = useState<{ freeDiskBytes: number; totalRamBytes: number } | null>(null);

  async function refreshProbe() {
    try {
      const p = await invoke<{ freeDiskBytes: number; totalRamBytes: number }>('llama_runtime_probe_resources');
      setProbe(p);
    } catch { /* ignore */ }
  }

  async function refreshStatus() {
    try {
      const s = await invoke<LlamaStatus>('llama_runtime_status');
      setStatus(s);
    } catch { /* ignore */ }
  }

  async function refreshInstalled() {
    const next: Record<string, RowState> = {};
    for (const m of CATALOG) {
      try {
        const exists = await invoke<boolean>('llama_runtime_model_file_exists', { targetName: m.ggufFile });
        next[m.id] = { ...(rows[m.id] || { phase: 'idle' }), installed: exists };
      } catch {
        next[m.id] = { ...(rows[m.id] || { phase: 'idle' }), installed: false };
      }
    }
    setRows(prev => {
      const merged: Record<string, RowState> = { ...prev };
      for (const id of Object.keys(next)) merged[id] = { ...prev[id], ...next[id] };
      return merged;
    });
  }

  useEffect(() => {
    refreshStatus();
    refreshInstalled();
    refreshProbe();
    const t = setInterval(refreshStatus, 5000);
    let unlisten: UnlistenFn | undefined;
    listen<DownloadProgressEvt>('llama-download-progress', evt => {
      const { modelId, downloaded, total } = evt.payload;
      setRows(prev => {
        const r = prev[modelId];
        if (!r || r.phase !== 'downloading') return prev;
        return { ...prev, [modelId]: { ...r, downloaded, total } };
      });
    }).then(fn => { unlisten = fn; });
    return () => {
      clearInterval(t);
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeModelPath = status.modelPath;
  const isActive = (m: CatalogModel) =>
    !!activeModelPath && activeModelPath.toLowerCase().endsWith(m.ggufFile.toLowerCase());

  function patch(id: string, patch: Partial<RowState>) {
    setRows(prev => ({ ...prev, [id]: { ...(prev[id] || { phase: 'idle' }), ...patch } }));
  }

  async function onDownload(m: CatalogModel) {
    if (probe && probe.freeDiskBytes > 0 && probe.freeDiskBytes < m.sizeBytes + 256 * 1024 * 1024) {
      patch(m.id, { phase: 'idle', error: `Not enough disk space: need ${fmtBytes(m.sizeBytes)}, free ${fmtBytes(probe.freeDiskBytes)}` });
      return;
    }
    patch(m.id, { phase: 'downloading', error: undefined, digestMismatch: false, downloaded: 0, total: m.sizeBytes });
    try {
      const finalPath = await invoke<string>('llama_runtime_download_model', {
        modelId: m.id,
        url: m.downloadUrl,
        targetName: m.ggufFile,
        expectedSize: m.sizeBytes,
      });
      patch(m.id, { phase: 'verifying' });
      if (m.sha256) {
        const computed = await invoke<string>('llama_runtime_sha256_file', { path: finalPath });
        if (!verifyDigest(m, computed)) {
          patch(m.id, { phase: 'idle', error: 'SHA256 mismatch — file rejected', digestMismatch: true, installed: false });
          await invoke('llama_runtime_delete_model', { targetName: m.ggufFile }).catch(() => {});
          return;
        }
      }
      patch(m.id, { phase: 'idle', installed: true });
    } catch (e: any) {
      patch(m.id, { phase: 'idle', error: String(e?.message || e) });
    }
  }

  async function onActivate(m: CatalogModel) {
    if (probe && probe.totalRamBytes > 0 && probe.totalRamBytes < m.minRamGb * 1024 * 1024 * 1024) {
      patch(m.id, { phase: 'idle', error: `Not enough RAM: model needs ${m.minRamGb} GB, machine has ${(probe.totalRamBytes / 1e9).toFixed(1)} GB` });
      return;
    }
    patch(m.id, { phase: 'activating', error: undefined });
    try {
      // Resolve absolute path: ask Rust for models_dir then join. Simpler — ask
      // for file existence first (we know the relative name) and let
      // llama_runtime_start canonicalize against models_dir on its side.
      const modelsDir = await invoke<string>('llama_runtime_models_dir');
      const sep = modelsDir.includes('\\') ? '\\' : '/';
      const modelPath = `${modelsDir}${sep}${m.ggufFile}`;
      const start = async (gpuLayers: number, contextLen: number) => {
        await invoke<LlamaStatus>('llama_runtime_start', {
          modelPath,
          contextLen,
          gpuLayers,
          threads: null,
          embedding: m.modality === 'embed',
        });
      };
      try {
        await start(m.defaultGpuLayers, Math.min(m.contextLen, 8192));
      } catch (err: any) {
        const first = String(err?.message || err || '');
        if (!/llama-server exited immediately \(code signal\):/i.test(first)) throw err;
        const failures: string[] = [first];
        const attempts: Array<{ gpuLayers: number; contextLen: number; threads: number | null }> = [
          { gpuLayers: 0, contextLen: Math.min(m.contextLen, 4096), threads: null },
          { gpuLayers: 0, contextLen: Math.min(m.contextLen, 2048), threads: null },
          { gpuLayers: 0, contextLen: Math.min(m.contextLen, 1024), threads: 1 },
        ];
        for (const attempt of attempts) {
          try {
            await invoke<LlamaStatus>('llama_runtime_start', {
              modelPath,
              contextLen: attempt.contextLen,
              gpuLayers: attempt.gpuLayers,
              threads: attempt.threads,
              embedding: m.modality === 'embed',
            });
            failures.length = 0;
            break;
          } catch (retryErr: any) {
            failures.push(String(retryErr?.message || retryErr || ''));
          }
        }
        if (failures.length > 0) {
          throw new Error(failures.join(' | CPU fallback failed: '));
        }
      }
      patch(m.id, { phase: 'idle' });
      refreshStatus();
    } catch (e: any) {
      patch(m.id, { phase: 'idle', error: String(e?.message || e) });
    }
  }

  async function onStop() {
    try {
      await invoke<LlamaStatus>('llama_runtime_stop');
      refreshStatus();
    } catch { /* ignore */ }
  }

  async function onDelete(m: CatalogModel) {
    if (isActive(m)) {
      patch(m.id, { error: 'Stop the runtime before deleting the active model.' });
      return;
    }
    if (!confirm(`Delete ${m.displayName} from disk?`)) return;
    patch(m.id, { phase: 'deleting' });
    try {
      await invoke('llama_runtime_delete_model', { targetName: m.ggufFile });
      patch(m.id, { phase: 'idle', installed: false });
    } catch (e: any) {
      patch(m.id, { phase: 'idle', error: String(e?.message || e) });
    }
  }

  const activeRow = useMemo(() => CATALOG.find(isActive), [activeModelPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-[18px] grid gap-[14px]">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
          <Shield size={18} strokeWidth={2.4} className="text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-[900] text-[var(--text)]">Local LLM runtime</div>
          <div className="mt-[4px] text-[11.5px] text-[var(--text-dim)] leading-[1.5]">
            Bundled llama-server. Closed catalog of open-weights GGUF models, hash-pinned and verified before activation. No external daemon.
          </div>
        </div>
      </div>

      <div className="px-3 py-2 rounded-[var(--rm)] bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[11px] text-[var(--text-dim)] flex items-center gap-2 flex-wrap">
        <span className={`font-[800] ${status.running ? 'text-[#10b981]' : 'text-[var(--text-dim)]'}`}>
          {status.running ? '● Running' : '○ Idle'}
        </span>
        {status.running && activeRow && <span>· {activeRow.displayName}</span>}
        {status.running && status.port && <span>· port {status.port}</span>}
        {probe && (
          <span>· {fmtBytes(probe.freeDiskBytes)} free disk · {(probe.totalRamBytes / 1e9).toFixed(0)} GB RAM</span>
        )}
        {status.running && (
          <button
            onClick={onStop}
            className="ml-auto border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[10px] py-[4px] cursor-pointer font-[700] text-[11px]"
          >
            <Power size={11} className="inline mr-1" strokeWidth={2.6} /> Stop
          </button>
        )}
      </div>

      <div className="grid gap-[8px]">
        {CATALOG.map(m => {
          const r = rows[m.id] || { phase: 'idle' };
          const installed = !!r.installed;
          const active = isActive(m);
          const downloading = r.phase === 'downloading';
          const verifying = r.phase === 'verifying';
          const activating = r.phase === 'activating';
          const deleting = r.phase === 'deleting';
          const pct = downloading && r.total ? Math.min(100, Math.floor((r.downloaded || 0) / r.total * 100)) : 0;
          const hashPinned = !!m.sha256;
          return (
            <div
              key={m.id}
              className="border border-[var(--border)] rounded-[var(--r)] p-[10px_12px] bg-[var(--bg2)] grid gap-[6px]"
            >
              <div className="flex items-center gap-[10px] flex-wrap">
                <div className="font-[800] text-[13px] text-[var(--text)]">{m.displayName}</div>
                <div className="text-[10px] text-[var(--text-dim)]">{m.id}</div>
                {active && (
                  <span className="text-[10px] font-[700] text-[#10b981] border border-[#10b981] rounded-[4px] px-[6px] py-[1px]">
                    active
                  </span>
                )}
                {installed && !active && (
                  <span className="text-[10px] font-[700] text-[var(--text-dim)] border border-[var(--border)] rounded-[4px] px-[6px] py-[1px]">
                    installed
                  </span>
                )}
                {!hashPinned && (
                  <span
                    title="SHA256 not yet pinned — release CI populates this. Activation will be blocked in release builds."
                    className="text-[10px] font-[700] text-[#f59e0b] border border-[#f59e0b] rounded-[4px] px-[6px] py-[1px]"
                  >
                    awaiting signature
                  </span>
                )}
                <div className="ml-auto flex gap-[6px]">
                  {!installed && (
                    <button
                      onClick={() => onDownload(m)}
                      disabled={downloading || verifying}
                      className="border border-[var(--border)] bg-[var(--accent)] text-[var(--on-accent,white)] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px] disabled:opacity-50"
                    >
                      {downloading
                        ? <><Loader2 size={11} className="inline mr-1 animate-spin" /> {pct}%</>
                        : verifying
                          ? <><Loader2 size={11} className="inline mr-1 animate-spin" /> Verifying…</>
                          : <><Download size={11} className="inline mr-1" /> Download · {fmtBytes(m.sizeBytes)}</>}
                    </button>
                  )}
                  {installed && !active && (
                    <button
                      onClick={() => onActivate(m)}
                      disabled={activating || !hashPinned}
                      title={!hashPinned ? 'Hash not pinned — cannot activate in production' : ''}
                      className="border border-[var(--border)] bg-[var(--accent)] text-[var(--on-accent,white)] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px] disabled:opacity-50"
                    >
                      {activating
                        ? <><Loader2 size={11} className="inline mr-1 animate-spin" /> Activating…</>
                        : <><Check size={11} className="inline mr-1" /> Activate</>}
                    </button>
                  )}
                  {installed && (
                    <button
                      onClick={() => onDelete(m)}
                      disabled={deleting || active}
                      className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px] disabled:opacity-40"
                    >
                      <Trash2 size={11} className="inline mr-1" /> Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="flex gap-[10px] text-[10.5px] text-[var(--text-dim)] flex-wrap">
                <span>{m.family}</span>
                <span>ctx {m.contextLen.toLocaleString()}</span>
                <span>min {m.minRamGb} GB RAM</span>
                <span>{m.license}</span>
              </div>
              {downloading && (
                <div className="grid gap-[4px]">
                  <div className="h-[6px] bg-[var(--bg3)] rounded-[3px] overflow-hidden">
                    <div style={{ width: `${Math.max(2, pct)}%` }} className="h-full bg-[var(--accent)] transition-[width] duration-300" />
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)]">
                    {fmtBytes(r.downloaded || 0)} / {fmtBytes(r.total || m.sizeBytes)} · {pct}%
                  </div>
                </div>
              )}
              {r.error && (
                <div className="flex items-start gap-2 text-[11px] text-[#ef4444]">
                  <AlertTriangle size={11} className="flex-shrink-0 mt-[1px]" />
                  <span>{r.error}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

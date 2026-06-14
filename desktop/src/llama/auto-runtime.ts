// Turnkey local-LLM orchestrator.
//
// `ensureActiveModel` is the single entry point: probes hardware, picks the
// best whitelisted model, downloads it if missing (with streamed progress),
// purges other catalog models to free disk, then starts llama-server.
//
// The caller (ProviderHostingPanel) never has to know which model was
// chosen — it just awaits the returned info.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { CATALOG, type CatalogModel, verifyDigest } from '../models/catalog';
import { pickBestModel, explainPicker, type ShareMode } from '../models/auto-picker';
import { resolveModelIdAlias } from '../models/model-id-alias';
import { findUserModel } from '../models/userModels';
import { waitForReady } from './client';
import {
  getCatalogDlStats,
  isCatalogDownloading,
  startCatalogDownload,
  subscribeCatalogDownloads,
} from './catalog-downloads';

interface LlamaInfo {
  baseUrl: string;
  bearerToken: string;
  port: number;
  modelPath: string;
}

interface ResourceProbe {
  freeDiskBytes: number;
  totalRamBytes: number;
}

interface DownloadProgressEvt {
  modelId: string;
  downloaded: number;
  total: number;
}

export interface AutoProgress {
  phase: 'probing' | 'downloading' | 'verifying' | 'cleaning' | 'starting' | 'ready';
  modelId?: string;
  modelLabel?: string;
  pct?: number;
  bytesDone?: number;
  bytesTotal?: number;
  bytesPerSec?: number;
  etaSec?: number;
}

// Wraps an AutoProgress emitter with sliding-window rate computation so any
// surface that displays the progress (TopBar, ProviderHostingPanel CheckRow,
// LocalRuntimeToggle…) gets bytes/sec + ETA without re-sampling itself.
// Resets the buffer on phase change so we don't carry stale samples across
// downloads or modalities.
export function withDownloadRate(
  emit: (p: AutoProgress) => void,
  windowMs = 5_000,
): (p: AutoProgress) => void {
  let samples: Array<{ t: number; bytes: number }> = [];
  let lastPhase: string | undefined;
  let lastModelId: string | undefined;
  return (p) => {
    if (p.phase !== lastPhase || p.modelId !== lastModelId) {
      samples = [];
      lastPhase = p.phase;
      lastModelId = p.modelId;
    }
    if (p.phase !== 'downloading' || typeof p.bytesDone !== 'number') {
      emit(p);
      return;
    }
    const now = Date.now();
    samples.push({ t: now, bytes: p.bytesDone });
    while (samples.length > 2 && now - samples[0].t > windowMs) samples.shift();
    let bytesPerSec = 0;
    let etaSec = 0;
    if (samples.length >= 2) {
      const oldest = samples[0];
      const newest = samples[samples.length - 1];
      const dt = (newest.t - oldest.t) / 1000;
      const db = newest.bytes - oldest.bytes;
      if (dt > 0 && db > 0) {
        bytesPerSec = db / dt;
        const total = p.bytesTotal ?? 0;
        if (total > p.bytesDone) etaSec = (total - p.bytesDone) / bytesPerSec;
      }
    }
    emit({ ...p, bytesPerSec, etaSec });
  };
}

export interface EnsureResult {
  modelId: string;
  modelLabel: string;
  info: LlamaInfo;
}

interface StartRuntimeArgs extends Record<string, unknown> {
  modelPath: string;
  contextLen: number;
  gpuLayers: number;
  threads?: number;
  embedding: boolean;
}

function isSignalCrash(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  return /llama-server exited immediately \(code signal\):/i.test(msg);
}

async function startRuntimeWithCpuFallback(args: StartRuntimeArgs): Promise<void> {
  try {
    await invoke('llama_runtime_start', args);
    return;
  } catch (err) {
    if (!isSignalCrash(err)) throw err;
    const failures: string[] = [String((err as any)?.message || err || 'unknown start error')];
    const base = args.contextLen || 4096;
    const attempts: Array<{ gpuLayers: number; contextLen: number; threads?: number }> = [
      { gpuLayers: 0, contextLen: Math.min(base, 4096) },
      { gpuLayers: 0, contextLen: Math.min(base, 2048) },
      { gpuLayers: 0, contextLen: Math.min(base, 1024), threads: 1 },
    ];
    for (const attempt of attempts) {
      try {
        await invoke('llama_runtime_start', {
          ...args,
          ...attempt,
        });
        return;
      } catch (retryErr) {
        const retryMsg = String((retryErr as any)?.message || retryErr || 'unknown fallback error');
        failures.push(retryMsg);
        if (!isSignalCrash(retryErr)) {
          throw new Error(failures.join(' | CPU fallback failed: '));
        }
      }
    }
    throw new Error(failures.join(' | CPU fallback failed: '));
  }
}

function resolveCatalogByFile(modelPath: string): CatalogModel | undefined {
  const fname = modelPath.split(/[\\/]/).pop() || '';
  return CATALOG.find(m => m.ggufFile.toLowerCase() === fname.toLowerCase());
}

export interface EnsureOptions {
  // Restrict the candidate pool. Default = full catalog. For provider
  // hosting, pass `shareableOnly: true` to exclude restrictively-licensed
  // weights (Llama Community, Gemma).
  shareableOnly?: boolean;
  // dedicated = box is donated to the network (full RAM/bandwidth).
  // shared    = user's daily driver, picker assumes 50% of resources.
  mode?: ShareMode;
  // Explicit chat model override. When set and present in the candidate pool
  // (chat modality only) the picker is skipped entirely. Falls back to
  // auto-pick when the id is unknown or non-chat.
  preferModelId?: string;
}

export async function ensureActiveModel(
  onProgress?: (p: AutoProgress) => void,
  opts: EnsureOptions = {},
): Promise<EnsureResult> {
  // Normalize alias (e.g. 'qwen3:4b' from canonical preferences) to catalog id.
  if (opts.preferModelId && !opts.preferModelId.startsWith('user:')) {
    opts = { ...opts, preferModelId: resolveModelIdAlias(opts.preferModelId, CATALOG.map(m => m.id)) };
  }

  // User-loaded model bypass — no catalog flow (no download / no digest /
  // no cleanup). We trust the user since this is friend-graph sharing.
  if (opts.preferModelId?.startsWith('user:')) {
    const um = findUserModel(opts.preferModelId);
    if (!um) throw new Error(`unknown user model ${opts.preferModelId}`);
    onProgress?.({ phase: 'probing', modelId: um.id, modelLabel: um.displayName });
    // Stop any active runtime first to free the slot.
    await invoke('llama_runtime_stop').catch(() => {});
    onProgress?.({ phase: 'starting', modelId: um.id, modelLabel: um.displayName });
    await startRuntimeWithCpuFallback({
      modelPath: um.absolutePath,
      contextLen: 4096,
      gpuLayers: -1,
      threads: undefined,
      embedding: um.modality === 'embed',
    });
    const info = await invoke<LlamaInfo | null>('llama_runtime_info');
    if (!info) throw new Error('llama_runtime_start succeeded but info is null');
    await waitForReady(info.baseUrl, info.bearerToken);
    onProgress?.({ phase: 'ready', modelId: um.id, modelLabel: um.displayName, pct: 100 });
    return { modelId: um.id, modelLabel: um.displayName, info };
  }

  const mode: ShareMode = opts.mode ?? 'dedicated';
  const candidates = opts.shareableOnly
    ? CATALOG.filter(m => m.shareable)
    : CATALOG;
  const candidateIds = new Set(candidates.map(m => m.id));

  // 1. Already active?
  const existing = await invoke<LlamaInfo | null>('llama_runtime_info').catch(() => null);
  if (existing) {
    const hit = resolveCatalogByFile(existing.modelPath);
    const matchesExplicit = opts.preferModelId ? hit?.id === opts.preferModelId : true;
    if (hit && candidateIds.has(hit.id) && matchesExplicit) {
      onProgress?.({ phase: 'ready', modelId: hit.id, modelLabel: hit.displayName, pct: 100 });
      return { modelId: hit.id, modelLabel: hit.displayName, info: existing };
    }
    // Active model wrong for the request — stop it and re-boot with the picked one.
    await invoke('llama_runtime_stop').catch(() => {});
  }

  // 2. Probe hardware → pick model (or honor explicit pick).
  onProgress?.({ phase: 'probing' });
  const probe = await invoke<ResourceProbe>('llama_runtime_probe_resources');
  let chosen: CatalogModel;
  if (opts.preferModelId) {
    const wanted = candidates.find(m => m.id === opts.preferModelId && m.modality === 'chat');
    chosen = wanted ?? pickBestModel(probe, candidates, mode);
  } else {
    chosen = pickBestModel(probe, candidates, mode);
  }
  console.log('[auto-runtime] mode', mode, 'chosen', chosen.id, 'probe', probe, 'explicit?', opts.preferModelId ?? 'no');
  console.log('[auto-runtime] verdict', explainPicker(probe, candidates, mode));
  onProgress?.({ phase: 'probing', modelId: chosen.id, modelLabel: chosen.displayName });

  // 2b. Ollama-backed models: pull via bundled Ollama instead of llama-server.
  // The bundled llama.cpp build (b9279) can't decode Ministral-3-2512 tokens;
  // Ollama 0.24+ ships a newer build. Auto-spawned at Tauri boot, just need
  // to ensure the tag is pulled. Returns synthetic LlamaInfo so callers that
  // expect non-null can proceed — agent.ts checks `model.backend === 'ollama'`
  // and skips setting llama_base_url, routing directly to llm.py's _chat_ollama.
  if (chosen.backend === 'ollama' && chosen.ollamaTag) {
    const tag = chosen.ollamaTag;
    const status = await invoke<{ running: boolean }>('ollama_runtime_status');
    if (!status.running) {
      throw new Error(`Ollama not running. Restart the app or run \`ollama serve\` manually.`);
    }
    // Delegate the actual pull to the catalog-downloads singleton so two
    // surfaces racing on the same model (panel "Host" + this activation path)
    // share a single in-flight stream instead of opening two. The singleton
    // is no-op if the tag is already installed.
    if (isCatalogDownloading(chosen.id) || !(await invoke<boolean>('ollama_model_installed', { modelTag: tag }))) {
      const unsub = subscribeCatalogDownloads(() => {
        const s = getCatalogDlStats(chosen.id);
        onProgress?.({
          phase: 'downloading',
          modelId: chosen.id,
          modelLabel: chosen.displayName,
          pct: s.pct,
        });
      });
      try {
        await startCatalogDownload(chosen);
      } finally {
        unsub();
      }
    }
    // Stop any leftover llama-server bound to a different model — Ollama
    // handles routing now, the bundled runtime would just hold RAM.
    await invoke('llama_runtime_stop').catch(() => {});
    const baseUrl = await invoke<string>('ollama_runtime_base_url');
    const info: LlamaInfo = {
      baseUrl,
      bearerToken: '',
      port: 11434,
      modelPath: `ollama:${tag}`,
    };
    onProgress?.({ phase: 'ready', modelId: chosen.id, modelLabel: chosen.displayName, pct: 100 });
    return { modelId: chosen.id, modelLabel: chosen.displayName, info };
  }

  // 3. Download if missing.
  const present = await invoke<boolean>('llama_runtime_model_file_exists', {
    targetName: chosen.ggufFile,
  });
  console.log('[auto-runtime] file present?', present, chosen.ggufFile);
  if (!present) {
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<DownloadProgressEvt>('llama-download-progress', evt => {
        console.log('[auto-runtime] progress', evt.payload);
        if (evt.payload.modelId !== chosen.id) return;
        const total = evt.payload.total || chosen.sizeBytes;
        const pct = total > 0 ? Math.min(100, Math.floor((evt.payload.downloaded / total) * 100)) : 0;
        onProgress?.({
          phase: 'downloading',
          modelId: chosen.id,
          modelLabel: chosen.displayName,
          pct,
          bytesDone: evt.payload.downloaded,
          bytesTotal: total,
        });
      });
      await invoke('llama_runtime_download_model', {
        modelId: chosen.id,
        url: chosen.downloadUrl,
        targetName: chosen.ggufFile,
        expectedSize: chosen.sizeBytes,
      });
    } finally {
      try { unlisten?.(); } catch {}
    }
  }

  // 4. Verify digest if catalog has one pinned.
  const modelsDir = await invoke<string>('llama_runtime_models_dir');
  const modelPath = `${modelsDir}/${chosen.ggufFile}`;
  if (chosen.sha256) {
    onProgress?.({ phase: 'verifying', modelId: chosen.id, modelLabel: chosen.displayName });
    const computed = await invoke<string>('llama_runtime_sha256_file', { path: modelPath });
    if (!verifyDigest(chosen, computed)) {
      // Refuse to activate a tampered weight file; wipe and surface error.
      await invoke('llama_runtime_delete_model', { targetName: chosen.ggufFile }).catch(() => {});
      throw new Error(`model digest mismatch for ${chosen.id}`);
    }
  }

  // 5. Cleanup: delete other catalog models hogging disk. Skip when the user
  // explicitly picked a model — they're managing the library themselves.
  if (!opts.preferModelId) {
    onProgress?.({ phase: 'cleaning', modelId: chosen.id, modelLabel: chosen.displayName });
    const installed = await invoke<string[]>('llama_runtime_list_installed_models').catch(() => []);
    for (const fname of installed) {
      if (fname.toLowerCase() === chosen.ggufFile.toLowerCase()) continue;
      const known = CATALOG.find(m => m.ggufFile.toLowerCase() === fname.toLowerCase());
      if (!known) continue; // leave non-catalog files alone (don't nuke user data)
      await invoke('llama_runtime_delete_model', { targetName: fname }).catch(() => {});
    }
  }

  // 6. Boot llama-server.
  onProgress?.({ phase: 'starting', modelId: chosen.id, modelLabel: chosen.displayName });
  await startRuntimeWithCpuFallback({
    modelPath,
    contextLen: chosen.contextLen,
    gpuLayers: chosen.defaultGpuLayers,
    threads: undefined,
    embedding: chosen.modality === 'embed',
  });
  const info = await invoke<LlamaInfo | null>('llama_runtime_info');
  if (!info) throw new Error('llama_runtime_start succeeded but info is null');
  await waitForReady(info.baseUrl, info.bearerToken);
  onProgress?.({ phase: 'ready', modelId: chosen.id, modelLabel: chosen.displayName, pct: 100 });
  return { modelId: chosen.id, modelLabel: chosen.displayName, info };
}

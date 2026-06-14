// Singleton store for the per-row "Download" button in ProviderHostingPanel.
//
// CRITICAL INVARIANT #1 — Same reasoning as `local-runtime.ts`: the Rust task
// (llama_runtime_download_model OR ollama_pull_model) keeps streaming bytes
// to disk after the panel that started it unmounts. If progress + sliding-
// window samples live in React-local state (dlBusy / dlStats / dlSamplesRef),
// a tab switch wipes them and a freshly remounted panel:
//   1. Re-shows the row as "downloading" only after the next Tauri event,
//      so the % can briefly jump backwards / look stuck.
//   2. Loses the rolling-window samples, so `bytesPerSec` returns to 0 until
//      two new samples arrive ⇒ the speed/ETA stays at "—" for several
//      seconds even though the download is still flying.
//
// Hoisting everything (busy set, stats map, sliding-window samples,
// expected-total fallback) to module scope keeps the telemetry continuous.
// Global Tauri listeners (one per backend) are started lazily on first
// download and stay for the app lifetime, so events arriving while the panel
// is unmounted still update the store and the next mount sees the latest
// %/speed.
//
// CRITICAL INVARIANT #2 — SAME-MODEL DEDUPE ACROSS BACKEND PATHS.
// A catalog model has ONE backend (`'llama'` direct GGUF or `'ollama'` tag).
// Two surfaces can race to start the same model: the panel "Host" button
// fires `startCatalogDownload`, while the TopBar power button fires
// `activateLocalRuntime` → `ensureActiveModel` → which used to invoke
// `ollama_pull_model` DIRECTLY. That created two parallel streams of the
// same weights (HF GGUF + Ollama registry). Fix: both flows go through this
// singleton, keyed by `model.id`, so the second caller short-circuits on
// `_busy.has(id)` and subscribes to the first's progress instead.
//
// See `catalog-downloads.test.ts` for the regression test.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { verifyDigest, type CatalogModel } from '../models/catalog';

export interface CatalogDlStats {
  pct: number;
  bytesPerSec: number;
  etaSec: number;
}

interface DownloadProgressEvt {
  modelId: string;
  downloaded: number;
  total: number;
}

interface OllamaPullEvt {
  modelTag: string;
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

interface Sample {
  t: number;
  bytes: number;
}

const DL_SAMPLE_WINDOW_MS = 5_000;

const _busy = new Set<string>();
const _stats = new Map<string, CatalogDlStats>();
const _samples = new Map<string, Sample[]>();
const _expectedTotal = new Map<string, number>();
const _subs = new Set<() => void>();
// Ollama emits progress keyed by `modelTag` (e.g. `qwen3:8b-q8_0`), not by
// our internal `model.id`. We keep a live map of the tags we're currently
// pulling so the listener can translate without scanning the catalog.
const _ollamaTagToId = new Map<string, string>();

let _listenerStarted = false;

function _emit(): void {
  for (const fn of _subs) {
    try { fn(); } catch {}
  }
}

function _ingest(modelId: string, downloaded: number, payloadTotal: number): void {
  if (!_busy.has(modelId)) return;
  const total = payloadTotal || _expectedTotal.get(modelId) || 0;
  const pct = total > 0 ? Math.min(100, Math.floor((downloaded / total) * 100)) : 0;
  const now = Date.now();
  let samples = _samples.get(modelId);
  if (!samples) {
    samples = [];
    _samples.set(modelId, samples);
  }
  samples.push({ t: now, bytes: downloaded });
  while (samples.length > 2 && now - samples[0].t > DL_SAMPLE_WINDOW_MS) {
    samples.shift();
  }
  let bytesPerSec = 0;
  let etaSec = 0;
  if (samples.length >= 2) {
    const oldest = samples[0];
    const newest = samples[samples.length - 1];
    const dt = (newest.t - oldest.t) / 1000;
    const db = newest.bytes - oldest.bytes;
    if (dt > 0 && db > 0) {
      bytesPerSec = db / dt;
      const remaining = total > 0 ? Math.max(0, total - downloaded) : 0;
      etaSec = remaining > 0 ? remaining / bytesPerSec : 0;
    }
  }
  _stats.set(modelId, { pct, bytesPerSec, etaSec });
  _emit();
}

async function _ensureListener(): Promise<void> {
  if (_listenerStarted) return;
  _listenerStarted = true;
  // Listeners live for the app lifetime — never unlisten. Events for models
  // we're not tracking (i.e. not in `_busy`) are dropped inside `_ingest` so
  // this is cheap. Two backends emit on two channels; we keep them separate
  // because Ollama keys by `modelTag` and needs a translation step.
  // Register both in parallel — they're independent and chaining adds an
  // extra microtask hop that's painful to flush in fake-timer tests.
  await Promise.all([
    listen<DownloadProgressEvt>('llama-download-progress', evt => {
      const { modelId, downloaded, total } = evt.payload;
      _ingest(modelId, downloaded, total);
    }),
    listen<OllamaPullEvt>('ollama-pull-progress', evt => {
      const id = _ollamaTagToId.get(evt.payload.modelTag);
      if (!id) return;
      const downloaded = evt.payload.completed ?? 0;
      const total = evt.payload.total ?? 0;
      _ingest(id, downloaded, total);
    }),
  ]);
}

export function subscribeCatalogDownloads(listener: () => void): () => void {
  _subs.add(listener);
  return () => { _subs.delete(listener); };
}

export function isCatalogDownloading(modelId: string): boolean {
  return _busy.has(modelId);
}

export function getCatalogDlStats(modelId: string): CatalogDlStats {
  return _stats.get(modelId) || { pct: 0, bytesPerSec: 0, etaSec: 0 };
}

// Snapshot helper for components that want to pass plain Set/Record props
// down to memoized children. Re-created on every call so React sees a new
// reference and re-renders subscribed subtrees.
export function getCatalogDownloadsSnapshot(): {
  busy: Set<string>;
  stats: Record<string, CatalogDlStats>;
} {
  return {
    busy: new Set(_busy),
    stats: Object.fromEntries(_stats),
  };
}

export async function startCatalogDownload(model: CatalogModel): Promise<void> {
  // Reserve the busy slot SYNCHRONOUSLY before any await, so concurrent
  // callers (two clicks landing in the same tick, panel "Host" + TopBar
  // power button, etc.) coalesce to a single underlying invoke instead of
  // streaming the file twice into the same target path.
  if (_busy.has(model.id)) return;
  _busy.add(model.id);
  _stats.set(model.id, { pct: 0, bytesPerSec: 0, etaSec: 0 });
  _samples.set(model.id, []);
  _expectedTotal.set(model.id, model.sizeBytes);
  _emit();
  await _ensureListener();
  try {
    if (model.backend === 'ollama' && model.ollamaTag) {
      // Route ollama-backed catalogs through the Ollama daemon's `/api/pull`
      // rather than the bartowski HF mirror — same weights, different source.
      // Doing both is the bug this whole module exists to prevent.
      const tag = model.ollamaTag;
      const installed = await invoke<boolean>('ollama_model_installed', { modelTag: tag });
      if (!installed) {
        _ollamaTagToId.set(tag, model.id);
        try {
          await invoke('ollama_pull_model', { modelTag: tag });
        } finally {
          _ollamaTagToId.delete(tag);
        }
      } else {
        _stats.set(model.id, { pct: 100, bytesPerSec: 0, etaSec: 0 });
        _emit();
      }
    } else {
      await invoke('llama_runtime_download_model', {
        modelId: model.id,
        url: model.downloadUrl,
        targetName: model.ggufFile,
        expectedSize: model.sizeBytes,
      });
      if (model.sha256) {
        const modelsDir = await invoke<string>('llama_runtime_models_dir');
        const modelPath = `${modelsDir}/${model.ggufFile}`;
        const computed = await invoke<string>('llama_runtime_sha256_file', { path: modelPath });
        if (!verifyDigest(model, computed)) {
          await invoke('llama_runtime_delete_model', { targetName: model.ggufFile }).catch(() => {});
          throw new Error(`Digest mismatch for ${model.id}`);
        }
      }
    }
  } finally {
    _busy.delete(model.id);
    _stats.delete(model.id);
    _samples.delete(model.id);
    _expectedTotal.delete(model.id);
    _emit();
  }
}

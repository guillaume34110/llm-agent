// Embedding-mode llama-server orchestrator.
//
// Mirrors `ensureActiveModel` but for the dedicated embedding slot. Runs in
// a separate process (different port) so the user can keep chatting while
// the KB ingests documents. Reuses the existing download / verify / cleanup
// commands — only the start/info/stop calls target the embed state.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { CATALOG, verifyDigest, type CatalogModel } from '../models/catalog';
import { auditCapabilities, type ShareMode } from '../models/auto-picker';
import { resolveModelIdAlias } from '../models/model-id-alias';
import { waitForReady } from './client';

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

export interface EnsureEmbedResult {
  modelId: string;
  modelLabel: string;
  info: LlamaInfo;
}

export async function ensureEmbedModel(
  opts: { mode?: ShareMode; preferModelId?: string } = {},
): Promise<EnsureEmbedResult> {
  const mode: ShareMode = opts.mode ?? 'dedicated';

  // 1. Already running?
  const existing = await invoke<LlamaInfo | null>('llama_embed_runtime_info').catch(() => null);
  if (existing) {
    const hit = CATALOG.find(m =>
      existing.modelPath.toLowerCase().endsWith(m.ggufFile.toLowerCase()),
    );
    if (hit && hit.modality === 'embed') {
      return { modelId: hit.id, modelLabel: hit.displayName, info: existing };
    }
    await invoke('llama_embed_runtime_stop').catch(() => {});
  }

  // 2. Probe + pick.
  const probe = await invoke<ResourceProbe>('llama_runtime_probe_resources');
  const audit = auditCapabilities(probe, { mode });
  let chosen: CatalogModel | null = audit.embed.model;
  if (opts.preferModelId) {
    const resolvedId = resolveModelIdAlias(opts.preferModelId, CATALOG.map(m => m.id));
    const wanted = CATALOG.find(m => m.id === resolvedId && m.modality === 'embed');
    if (wanted) chosen = wanted;
  }
  if (!chosen) {
    throw new Error(`no embedding model fits this hardware (${audit.embed.reason ?? 'unknown'})`);
  }

  // 3. Download if missing.
  const present = await invoke<boolean>('llama_runtime_model_file_exists', {
    targetName: chosen.ggufFile,
  });
  if (!present) {
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<DownloadProgressEvt>('llama-download-progress', () => {});
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

  // 4. Verify pinned digest if present (refuse tampered weights).
  const modelsDir = await invoke<string>('llama_runtime_models_dir');
  const modelPath = `${modelsDir}/${chosen.ggufFile}`;
  if (chosen.sha256) {
    const computed = await invoke<string>('llama_runtime_sha256_file', { path: modelPath });
    if (!verifyDigest(chosen, computed)) {
      await invoke('llama_runtime_delete_model', { targetName: chosen.ggufFile }).catch(() => {});
      throw new Error(`model digest mismatch for ${chosen.id}`);
    }
  }

  // 5. Boot llama-server in embedding mode.
  await invoke('llama_embed_runtime_start', {
    modelPath,
    contextLen: chosen.contextLen,
    gpuLayers: chosen.defaultGpuLayers,
    threads: undefined,
    pooling: chosen.pooling ?? 'mean',
  });
  const info = await invoke<LlamaInfo | null>('llama_embed_runtime_info');
  if (!info) throw new Error('llama_embed_runtime_start succeeded but info is null');
  await waitForReady(info.baseUrl, info.bearerToken);
  return { modelId: chosen.id, modelLabel: chosen.displayName, info };
}

export async function stopEmbedModel(): Promise<void> {
  await invoke('llama_embed_runtime_stop').catch(() => {});
}

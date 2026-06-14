// Pick the best whitelisted model PER MODALITY for the user's hardware.
//
// A candidate is accepted only when ALL of:
//   1. RAM fits inference peak (weights + KV cache at FULL declared contextLen
//      + OS headroom, or `peakRamBytes` for non-LLM modalities).
//   2. Disk fits the model file (with .part overhead cushion).
//   3. Estimated throughput ≥ modality-specific floor (≈ 2 tok/s for chat,
//      0.5 vec/s for embed, 1 img/min for image, realtime for transcribe).
// Walks the modality's catalog largest → smallest and returns the first match.
// Falls back to the smallest candidate when nothing fits (so the user always
// gets something rather than a hard error).
//
// `auditCapabilities(probe)` returns one best-fit per modality with reasons —
// drives the provider-share UI ("you can host chat ✓ embed ✓ image ✗ …").

import {
  CATALOG,
  type CatalogModel,
  type Modality,
  catalogByModality,
} from './catalog';

const BYTES_PER_GB = 1024 ** 3;
const OS_HEADROOM_BYTES = 1.0 * BYTES_PER_GB;   // OS + sidecar runtime + activations
const DISK_HEADROOM = 1.4;                      // .part + filesystem slack
const ASSUMED_RAM_BANDWIDTH_BYTES_PER_SEC = 10 * BYTES_PER_GB; // conservative CPU baseline

export interface HardwareProbe {
  totalRamBytes: number;
  freeDiskBytes: number;
}

export type ShareMode = 'dedicated' | 'shared';

// When the user runs in `shared` mode the machine is also their daily driver,
// so the picker may only assume HALF of the RAM and HALF of the effective
// memory bandwidth. `dedicated` = box is donated to the network.
const SHARED_FRACTION = 0.5;

function effectiveProbe(probe: HardwareProbe, mode: ShareMode): HardwareProbe {
  if (mode === 'dedicated') return probe;
  return {
    totalRamBytes: Math.floor(probe.totalRamBytes * SHARED_FRACTION),
    freeDiskBytes: probe.freeDiskBytes,
  };
}

function effectiveBandwidth(mode: ShareMode): number {
  return mode === 'dedicated'
    ? ASSUMED_RAM_BANDWIDTH_BYTES_PER_SEC
    : ASSUMED_RAM_BANDWIDTH_BYTES_PER_SEC * SHARED_FRACTION;
}

export interface PickerVerdict {
  modelId: string;
  modality: Modality;
  ramOk: boolean;
  diskOk: boolean;
  speedOk: boolean;
  ramNeededBytes: number;
  estimatedBytesPerSec: number;
}

function inferenceRamBytes(m: CatalogModel): number {
  // Non-LLM modalities provide an explicit peak; LLMs use the standard formula.
  if (m.peakRamBytes > 0) return m.peakRamBytes;
  return m.sizeBytes + m.kvCacheBytesPerToken * m.contextLen;
}

function estimateBandwidth(_m: CatalogModel, mode: ShareMode): number {
  return effectiveBandwidth(mode);
}

export function explainPicker(
  probe: HardwareProbe,
  candidates: CatalogModel[] = CATALOG,
  mode: ShareMode = 'dedicated',
): PickerVerdict[] {
  const eff = effectiveProbe(probe, mode);
  return candidates.map(m => {
    const ramNeeded = inferenceRamBytes(m) + OS_HEADROOM_BYTES;
    const bw = estimateBandwidth(m, mode);
    return {
      modelId: m.id,
      modality: m.modality,
      ramOk: ramNeeded <= eff.totalRamBytes,
      diskOk: m.sizeBytes * DISK_HEADROOM <= eff.freeDiskBytes,
      speedOk: bw >= m.minThroughputBytesPerSec,
      ramNeededBytes: ramNeeded,
      estimatedBytesPerSec: bw,
    };
  });
}

function pickFromPool(
  probe: HardwareProbe,
  pool: CatalogModel[],
  mode: ShareMode,
): CatalogModel | null {
  if (pool.length === 0) return null;
  const eff = effectiveProbe(probe, mode);
  const sorted = [...pool].sort((a, b) => b.sizeBytes - a.sizeBytes);
  for (const m of sorted) {
    const ramNeeded = inferenceRamBytes(m) + OS_HEADROOM_BYTES;
    if (ramNeeded > eff.totalRamBytes) continue;
    if (m.sizeBytes * DISK_HEADROOM > eff.freeDiskBytes) continue;
    if (estimateBandwidth(m, mode) < m.minThroughputBytesPerSec) continue;
    return m;
  }
  return null;
}

// Chat-only picker — kept for callers that just want a single LLM
// (e.g. ensureActiveModel on first boot). Falls back to smallest chat model
// when nothing fits (so the user always gets something).
export function pickBestModel(
  probe: HardwareProbe,
  candidates: CatalogModel[] = CATALOG,
  mode: ShareMode = 'dedicated',
): CatalogModel {
  const chat = candidates.filter(m => m.modality === 'chat');
  const pool = chat.length > 0 ? chat : candidates;
  const hit = pickFromPool(probe, pool, mode);
  if (hit) return hit;
  const fallback = [...pool].sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
  if (!fallback) throw new Error('no candidate model available');
  return fallback;
}

export interface ModalitySlot {
  model: CatalogModel | null;
  // Why no model was picked, when null (e.g. 'insufficient_ram', 'no_candidates').
  reason?: string;
}

export interface CapabilityAudit {
  mode: ShareMode;
  probe: HardwareProbe;
  chat: ModalitySlot;
  embed: ModalitySlot;
  image: ModalitySlot;
  transcribe: ModalitySlot;
  tts: ModalitySlot;
  verdicts: PickerVerdict[];
}

function auditOne(
  probe: HardwareProbe,
  modality: Modality,
  mode: ShareMode,
  shareableOnly: boolean,
): ModalitySlot {
  let pool = catalogByModality(modality);
  if (shareableOnly) pool = pool.filter(m => m.shareable);
  if (pool.length === 0) return { model: null, reason: 'no_candidates' };
  const hit = pickFromPool(probe, pool, mode);
  if (hit) return { model: hit };
  // Diagnose why nothing fit — pick the limiting gate of the smallest candidate.
  const smallest = [...pool].sort((a, b) => a.sizeBytes - b.sizeBytes)[0];
  const eff = effectiveProbe(probe, mode);
  const ramNeeded = inferenceRamBytes(smallest) + OS_HEADROOM_BYTES;
  if (ramNeeded > eff.totalRamBytes) return { model: null, reason: 'insufficient_ram' };
  if (smallest.sizeBytes * DISK_HEADROOM > eff.freeDiskBytes) return { model: null, reason: 'insufficient_disk' };
  return { model: null, reason: 'insufficient_throughput' };
}

export function auditCapabilities(
  probe: HardwareProbe,
  opts: { mode?: ShareMode; shareableOnly?: boolean } = {},
): CapabilityAudit {
  const mode = opts.mode ?? 'dedicated';
  const shareableOnly = opts.shareableOnly ?? false;
  const pool = shareableOnly ? CATALOG.filter(m => m.shareable) : CATALOG;
  return {
    mode,
    probe,
    chat: auditOne(probe, 'chat', mode, shareableOnly),
    embed: auditOne(probe, 'embed', mode, shareableOnly),
    image: auditOne(probe, 'image', mode, shareableOnly),
    transcribe: auditOne(probe, 'transcribe', mode, shareableOnly),
    tts: auditOne(probe, 'tts', mode, shareableOnly),
    verdicts: explainPicker(probe, pool, mode),
  };
}

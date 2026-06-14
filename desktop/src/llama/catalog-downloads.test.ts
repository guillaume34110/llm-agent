// Regression tests for the CRITICAL INVARIANT documented in `catalog-downloads.ts`:
//
//   A catalog "Download" started from the ProviderHostingPanel MUST keep
//   reporting % + B/s + ETA even when the user navigates away and back.
//
// React-local state used to hold the `dlBusy` set, the `dlStats` map and the
// rolling-window byte samples. The panel is conditionally rendered in
// BackgroundView (`{tab === 'provider' && <Panel/>}`), so a tab switch
// unmounted the component and:
//   - dropped the busy flag → next mount briefly showed the row as idle
//   - dropped the samples → speed/ETA stayed at "—" for several seconds
//     after the next mount, until two fresh samples accumulated
//
// All of that now lives at module scope. These tests verify the property
// holds: a fresh subscriber sees the latest state IMMEDIATELY, and samples
// gathered while no one was listening still feed the rate calc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogModel } from '../models/catalog';

let invokeResolvers: Array<(v: unknown) => void> = [];
let ollamaInstalled = false;
const invokeMock = vi.fn(async (cmd: string, _args?: unknown) => {
  // Long-running download invokes hand their resolution to the test via
  // `invokeResolvers`. Anything else returns immediately; we skip the sha256
  // branch by leaving `model.sha256 = ''` in fixtures.
  if (cmd === 'llama_runtime_download_model' || cmd === 'ollama_pull_model') {
    return new Promise(res => { invokeResolvers.push(res); });
  }
  if (cmd === 'ollama_model_installed') return ollamaInstalled;
  return undefined;
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown?])),
}));

type LlamaHandler = (evt: { payload: { modelId: string; downloaded: number; total: number } }) => void;
type OllamaHandler = (evt: { payload: { modelTag: string; status: string; total?: number; completed?: number } }) => void;
const eventHandlers = new Map<string, unknown>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: unknown) => {
    eventHandlers.set(event, handler);
    return () => { eventHandlers.delete(event); };
  }),
}));

function emitLlamaProgress(payload: { modelId: string; downloaded: number; total: number }) {
  const h = eventHandlers.get('llama-download-progress') as LlamaHandler | undefined;
  h?.({ payload });
}

function emitOllamaProgress(payload: { modelTag: string; status: string; total?: number; completed?: number }) {
  const h = eventHandlers.get('ollama-pull-progress') as OllamaHandler | undefined;
  h?.({ payload });
}

// `await Promise.resolve()` flushes ONE microtask. `_ensureListener` does
// `await Promise.all([listen, listen])`, and then `startCatalogDownload`
// chains `await invoke(...)`, which together take several microtask hops.
// 8 is plenty and stays cheap.
async function flushMicrotasks(n = 8) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

// Import after mocks are wired up.
import {
  getCatalogDlStats,
  getCatalogDownloadsSnapshot,
  isCatalogDownloading,
  startCatalogDownload,
  subscribeCatalogDownloads,
} from './catalog-downloads';

function fakeModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    id: 'ministral-3-3b',
    displayName: 'Ministral 3 3B',
    modality: 'chat',
    runtime: 'llama',
    family: 'mistral',
    hfRepo: 'mistralai/Ministral-3-3B',
    ggufFile: 'ministral-3-3b.gguf',
    downloadUrl: 'https://example.invalid/ministral-3-3b.gguf',
    sha256: '', // empty → skips verifyDigest branch
    sizeBytes: 4_000_000_000,
    minRamGb: 4,
    contextLen: 8192,
    defaultGpuLayers: 0,
    license: 'apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 0,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 0,
    ...overrides,
  } as CatalogModel;
}

beforeEach(() => {
  invokeMock.mockClear();
  invokeResolvers = [];
  ollamaInstalled = false;
  // NOTE: don't reset `eventHandlers` — the singleton registers its listeners
  // exactly ONCE for the app lifetime (`_listenerStarted` flag). Across tests
  // in the same file the handler refs persist; subsequent tests reuse them.
});

afterEach(() => {
  // Drain any inflight downloads left dangling so the next test starts
  // with a clean singleton state. The store keys off `model.id` so a
  // leaked busy flag would make `startCatalogDownload` short-circuit.
  invokeResolvers.forEach(r => r(undefined));
  invokeResolvers = [];
  vi.useRealTimers();
});

describe('catalog-downloads singleton (regression: speed/ETA must survive UI unmount)', () => {
  it('progress + samples accumulate even when no subscriber is mounted', async () => {
    // NOTE: `vi.setSystemTime` alone mocks `Date.now()` without faking
    // microtasks. Using `vi.useFakeTimers()` here breaks the async chain
    // through `_ensureListener` → `Promise.all([listen, listen])` → the test
    // hangs because the test function can't yield long enough for the
    // singleton's listener registration to complete.
    vi.setSystemTime(new Date('2026-05-26T10:00:00Z'));

    const model = fakeModel();

    // Panel A mounts and starts the download.
    const panelACalls: number[] = [];
    const unsubA = subscribeCatalogDownloads(() => { panelACalls.push(1); });

    const inflight = startCatalogDownload(model);
    // Yield so `_ensureListener` registers both handlers and reaches the
    // underlying invoke. The async chain is `await _ensureListener` →
    // `await Promise.all([listen, listen])` → `await invoke(...)`, which
    // takes several microtask hops to settle, so a single
    // `await Promise.resolve()` isn't enough.
    await flushMicrotasks();

    expect(isCatalogDownloading(model.id)).toBe(true);
    expect(eventHandlers.has('llama-download-progress')).toBe(true);

    // First two progress chunks arrive (need 2 samples for a rate calc).
    emitLlamaProgress({ modelId: model.id, downloaded: 400_000_000, total: 4_000_000_000 });
    vi.setSystemTime(new Date('2026-05-26T10:00:01Z'));
    emitLlamaProgress({ modelId: model.id, downloaded: 800_000_000, total: 4_000_000_000 });

    const afterTwo = getCatalogDlStats(model.id);
    expect(afterTwo.pct).toBe(20);
    expect(afterTwo.bytesPerSec).toBeGreaterThan(0); // ~400 MB/s over 1s
    expect(afterTwo.etaSec).toBeGreaterThan(0);

    // === User switches tab — Panel A unmounts ===
    unsubA();
    const callsAtUnmount = panelACalls.length;

    // More progress arrives WHILE NO COMPONENT IS LISTENING. The Rust task
    // keeps streaming bytes; the singleton must keep absorbing them — and
    // critically must keep pushing samples into the rolling window so
    // bytesPerSec doesn't collapse to 0 when the next panel mounts.
    vi.setSystemTime(new Date('2026-05-26T10:00:02Z'));
    emitLlamaProgress({ modelId: model.id, downloaded: 1_200_000_000, total: 4_000_000_000 });
    vi.setSystemTime(new Date('2026-05-26T10:00:03Z'));
    emitLlamaProgress({ modelId: model.id, downloaded: 1_600_000_000, total: 4_000_000_000 });

    // Panel A is detached — its listener must NOT fire.
    expect(panelACalls.length).toBe(callsAtUnmount);

    // === User switches back — Panel B mounts ===
    const panelBSnapshots: number[] = [];
    const unsubB = subscribeCatalogDownloads(() => {
      panelBSnapshots.push(getCatalogDlStats(model.id).pct);
    });

    // Fresh mount: must see the latest state IMMEDIATELY without waiting
    // for the next emit. And bytesPerSec must already be populated — if
    // samples were dropped on unmount we'd see 0 here.
    const immediate = getCatalogDlStats(model.id);
    expect(immediate.pct).toBe(40);
    expect(immediate.bytesPerSec).toBeGreaterThan(0);
    expect(isCatalogDownloading(model.id)).toBe(true);

    // Snapshot helper exposes the same data as a plain object for memoized
    // children. Re-created on every call so React sees a new reference.
    const snap = getCatalogDownloadsSnapshot();
    expect(snap.busy.has(model.id)).toBe(true);
    expect(snap.stats[model.id].pct).toBe(40);

    // Next progress event lands on Panel B's listener.
    vi.setSystemTime(new Date('2026-05-26T10:00:04Z'));
    emitLlamaProgress({ modelId: model.id, downloaded: 2_000_000_000, total: 4_000_000_000 });
    expect(panelBSnapshots[panelBSnapshots.length - 1]).toBe(50);

    // Resolve the underlying invoke so the singleton runs its cleanup.
    invokeResolvers.forEach(r => r(undefined));
    invokeResolvers = [];
    await inflight;

    expect(isCatalogDownloading(model.id)).toBe(false);
    expect(getCatalogDlStats(model.id)).toEqual({ pct: 0, bytesPerSec: 0, etaSec: 0 });
    unsubB();
  });

  it('events for untracked models are dropped (no stats leak after a finished download)', async () => {
    const model = fakeModel({ id: 'phi-4-mini', ggufFile: 'phi-4-mini.gguf' });

    const inflight = startCatalogDownload(model);
    await flushMicrotasks();

    expect(eventHandlers.has('llama-download-progress')).toBe(true);

    // A stray event for a model we never started must not create stats.
    emitLlamaProgress({ modelId: 'never-started', downloaded: 100, total: 1000 });
    expect(getCatalogDlStats('never-started')).toEqual({ pct: 0, bytesPerSec: 0, etaSec: 0 });

    invokeResolvers.forEach(r => r(undefined));
    invokeResolvers = [];
    await inflight;

    // After cleanup, a late event for the (now-finished) model is also dropped.
    emitLlamaProgress({ modelId: model.id, downloaded: 999, total: 1000 });
    expect(getCatalogDlStats(model.id)).toEqual({ pct: 0, bytesPerSec: 0, etaSec: 0 });
    expect(isCatalogDownloading(model.id)).toBe(false);
  });

  it('concurrent startCatalogDownload calls for the same id are de-duped', async () => {
    const model = fakeModel({ id: 'qwen3-8b', ggufFile: 'qwen3-8b.gguf' });

    // Two surfaces "click download" near-simultaneously. The Rust invoke
    // must only fire once — otherwise the same file gets streamed twice
    // into the same target path.
    const p1 = startCatalogDownload(model);
    const p2 = startCatalogDownload(model);
    await flushMicrotasks();

    const downloadCalls = invokeMock.mock.calls.filter(c => c[0] === 'llama_runtime_download_model');
    expect(downloadCalls.length).toBe(1);

    invokeResolvers.forEach(r => r(undefined));
    invokeResolvers = [];
    await Promise.all([p1, p2]);

    expect(isCatalogDownloading(model.id)).toBe(false);
  });

  it('clears busy + stats even when the underlying invoke rejects', async () => {
    const model = fakeModel({ id: 'gemma-2-9b', ggufFile: 'gemma-2-9b.gguf' });

    // Override the mock just for this test so the invoke rejects.
    invokeMock.mockImplementationOnce(async () => { throw new Error('boom'); });

    await expect(startCatalogDownload(model)).rejects.toThrow('boom');

    expect(isCatalogDownloading(model.id)).toBe(false);
    expect(getCatalogDlStats(model.id)).toEqual({ pct: 0, bytesPerSec: 0, etaSec: 0 });
  });

  it('ollama-backed model routes through ollama_pull_model, not the HF GGUF path', async () => {
    // This is the bug the user observed as "deux dl de la meme source".
    // Before the fix: panel "Host" fired llama_runtime_download_model (HF GGUF)
    // while TopBar power fired ollama_pull_model — same weights, two streams.
    // After: both flows go through this singleton, which picks ONE path based
    // on `model.backend` and dedupes by `model.id`.
    const model = fakeModel({
      id: 'qwen3-8b-ollama',
      backend: 'ollama',
      ollamaTag: 'qwen3:8b-q8_0',
    });

    const inflight = startCatalogDownload(model);
    await flushMicrotasks();

    const llamaCalls = invokeMock.mock.calls.filter(c => c[0] === 'llama_runtime_download_model');
    const ollamaCalls = invokeMock.mock.calls.filter(c => c[0] === 'ollama_pull_model');
    expect(llamaCalls.length).toBe(0);
    expect(ollamaCalls.length).toBe(1);
    expect((ollamaCalls[0][1] as { modelTag: string }).modelTag).toBe('qwen3:8b-q8_0');

    // Ollama emits progress keyed by `modelTag` — the singleton must translate
    // it back to `model.id` for `_stats` lookup.
    emitOllamaProgress({ modelTag: 'qwen3:8b-q8_0', status: 'pulling', completed: 200_000_000, total: 8_710_000_000 });
    expect(getCatalogDlStats(model.id).pct).toBeGreaterThan(0);
    expect(getCatalogDlStats(model.id).pct).toBeLessThan(5);

    invokeResolvers.forEach(r => r(undefined));
    invokeResolvers = [];
    await inflight;

    expect(isCatalogDownloading(model.id)).toBe(false);
  });

  it('ollama-backed model: already-installed tag short-circuits the pull', async () => {
    const model = fakeModel({
      id: 'qwen3-4b-already-installed',
      backend: 'ollama',
      ollamaTag: 'qwen3:4b-q8_0',
    });

    ollamaInstalled = true;
    await startCatalogDownload(model);

    const ollamaCalls = invokeMock.mock.calls.filter(c => c[0] === 'ollama_pull_model');
    expect(ollamaCalls.length).toBe(0);
    expect(isCatalogDownloading(model.id)).toBe(false);
  });
});

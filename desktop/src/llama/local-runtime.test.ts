// Regression tests for the CRITICAL INVARIANT documented in `local-runtime.ts`:
//
//   A model download MUST NOT stop when the user navigates away from the
//   surface that started it.
//
// React-local state died the moment the panel unmounted (BackgroundView only
// renders the panel when `tab === 'provider'`, so a tab switch wipes the
// component tree). The progress + busy flags now live at module scope; these
// tests make sure that property is preserved.
//
// The Rust task (ollama_pull_model / llama_runtime_download_model) is
// inherently independent of any JS Promise — it streams bytes to disk on its
// own thread until it's done. So we don't need to test that the Rust side
// keeps going; we test that the JS singleton keeps the UI in sync regardless
// of who's currently subscribed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}));

const ensureActiveModelMock = vi.fn();
const withDownloadRateMock = vi.fn();

vi.mock('./auto-runtime', () => ({
  ensureActiveModel: (...args: unknown[]) => ensureActiveModelMock(...args),
  withDownloadRate: (emit: (p: unknown) => void) => {
    withDownloadRateMock(emit);
    // Pass-through wrapper: every emit lands on the listener unchanged. The
    // real `withDownloadRate` adds a sliding-window byte-rate; we don't need
    // that behavior here.
    return (p: unknown) => emit(p);
  },
}));

vi.mock('../preferences/runtime-mode', () => ({
  getLocalModelPick: vi.fn(() => ''),
  getRuntimeMode: vi.fn(() => 'online'),
  setRuntimeMode: vi.fn(),
}));

// Import after mocks are wired up so the module picks them up.
import {
  activateLocalRuntime,
  getLocalBusy,
  getLocalProgress,
  subscribeLocalRuntime,
} from './local-runtime';

beforeEach(() => {
  ensureActiveModelMock.mockReset();
  withDownloadRateMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('local-runtime singleton (regression: download must survive UI unmount)', () => {
  it('progress is readable from a fresh subscriber even after the original subscriber detached mid-download', async () => {
    // Hand control of the download to the test: resolve the underlying
    // `ensureActiveModel` only when we say so. This lets us emit progress
    // events while the activation is still in flight.
    let resolveEnsure: (v: unknown) => void = () => {};
    let captureEmit: ((p: unknown) => void) | null = null;
    ensureActiveModelMock.mockImplementation((emit: (p: unknown) => void) => {
      captureEmit = emit;
      return new Promise(res => { resolveEnsure = res; });
    });

    // === Panel A mounts and triggers activation ===
    const panelACalls: number[] = [];
    const unsubA = subscribeLocalRuntime(() => { panelACalls.push(1); });

    const inflight = activateLocalRuntime();
    // Yield so the inner async IIFE runs and captures the emit function.
    await Promise.resolve();

    expect(getLocalBusy()).toBe(true);
    expect(captureEmit).not.toBeNull();

    // First progress chunk arrives.
    captureEmit!({ phase: 'downloading', modelLabel: 'llama-3.1-8b', pct: 12 });
    expect(getLocalProgress()).toMatchObject({ phase: 'downloading', pct: 12 });

    // === User switches tab — Panel A unmounts ===
    unsubA();
    const callsAtUnmount = panelACalls.length;

    // More progress arrives WHILE NO COMPONENT IS LISTENING. The Rust task
    // keeps streaming bytes; the singleton keeps absorbing them. If progress
    // were stored in React state, this would be lost.
    captureEmit!({ phase: 'downloading', modelLabel: 'llama-3.1-8b', pct: 47 });
    captureEmit!({ phase: 'downloading', modelLabel: 'llama-3.1-8b', pct: 83 });

    // Panel A is detached — its listener must NOT fire.
    expect(panelACalls.length).toBe(callsAtUnmount);

    // === User switches back — Panel B mounts ===
    const panelBSnapshots: unknown[] = [];
    const unsubB = subscribeLocalRuntime(() => {
      panelBSnapshots.push(getLocalProgress());
    });

    // Fresh mount: must see the latest state IMMEDIATELY via the getter,
    // without waiting for the next emit.
    expect(getLocalProgress()).toMatchObject({ phase: 'downloading', pct: 83 });
    expect(getLocalBusy()).toBe(true);

    // Next progress arrives — Panel B receives it.
    captureEmit!({ phase: 'downloading', modelLabel: 'llama-3.1-8b', pct: 95 });
    expect(panelBSnapshots[panelBSnapshots.length - 1]).toMatchObject({ pct: 95 });

    // Download finishes.
    resolveEnsure({
      modelId: 'llama-3.1-8b',
      info: { baseUrl: 'http://localhost:0', bearerToken: '', port: 0, modelPath: '' },
    });
    await inflight;

    expect(getLocalBusy()).toBe(false);
    expect(getLocalProgress()).toBeNull();
    unsubB();
  });

  it('concurrent activateLocalRuntime calls share the same underlying download', async () => {
    let resolveEnsure: (v: unknown) => void = () => {};
    ensureActiveModelMock.mockImplementation(() => new Promise(res => { resolveEnsure = res; }));

    // Three surfaces click "activate" at almost the same time (TopBar power
    // button + panel "Start" + LocalRuntimeToggle): the singleton must
    // coalesce them so the Rust download only kicks off once.
    const p1 = activateLocalRuntime();
    const p2 = activateLocalRuntime();
    const p3 = activateLocalRuntime();

    // Resolve before asserting so cleanup happens deterministically even if
    // assertions later throw — otherwise an in-flight `_inflight` leaks into
    // the next test and the module singleton stays busy forever.
    const resolved = {
      modelId: 'qwen-2.5-7b',
      info: { baseUrl: 'http://localhost:0', bearerToken: '', port: 0, modelPath: '' },
    };
    resolveEnsure(resolved);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    // All three callers receive the same EnsureResult — the actual download
    // (the Rust task underneath `ensureActiveModel`) only ran once.
    expect(r1).toBe(resolved);
    expect(r2).toBe(resolved);
    expect(r3).toBe(resolved);
    expect(ensureActiveModelMock).toHaveBeenCalledTimes(1);
  });

  it('clears progress + busy after activation finishes, so a stale "downloading…" never sticks', async () => {
    ensureActiveModelMock.mockResolvedValue({
      modelId: 'phi-3-mini',
      info: { baseUrl: 'http://localhost:0', bearerToken: '', port: 0, modelPath: '' },
    });

    await activateLocalRuntime();

    expect(getLocalBusy()).toBe(false);
    expect(getLocalProgress()).toBeNull();
  });

  it('clears progress + busy even when activation fails', async () => {
    ensureActiveModelMock.mockRejectedValue(new Error('boom'));

    await expect(activateLocalRuntime()).rejects.toThrow('boom');

    expect(getLocalBusy()).toBe(false);
    expect(getLocalProgress()).toBeNull();
  });
});

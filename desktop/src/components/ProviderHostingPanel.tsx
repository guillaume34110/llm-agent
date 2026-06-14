// "Share my compute" panel — fully turnkey provider onboarding.
// One button. The app:
//   - checks the bundled llama-server runtime (already managed by the app)
//   - reads the active model identifier from the runtime
//   - auto-detects the public endpoint
//   - starts provider-runtime as a Tauri-managed child
// The user never sees JWT plumbing, port-forwarding or wire-protocol notes.
// Model download + activation is auto-orchestrated by ensureActiveModel on first Start.

import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { Power, Shield, Cpu, Globe, Check, AlertTriangle, ChevronDown, Loader2, Plus, Trash2, Download, Activity } from 'lucide-react';
import { CATALOG, catalogByModality, type CatalogModel, type Modality, type Family } from '../models/catalog';
import {
  addUserModel,
  basenameStem,
  detectFamily,
  loadUserModels,
  makeUserModelId,
  removeUserModel,
  type UserModel,
} from '../models/userModels';
import { ensureActiveModel, type AutoProgress } from '../llama/auto-runtime';
import {
  activateLocalRuntime,
  getLocalBusy,
  getLocalProgress,
  subscribeLocalRuntime,
} from '../llama/local-runtime';
import {
  getCatalogDownloadsSnapshot,
  startCatalogDownload,
  subscribeCatalogDownloads,
  type CatalogDlStats,
} from '../llama/catalog-downloads';
import { ensureEmbedModel } from '../llama/embed-runtime';
import {
  setRuntimeMode,
  getLocalModelPick,
  setLocalModelPick,
  subscribeRuntimeMode,
} from '../preferences/runtime-mode';
import { resolveModelIdAlias } from '../models/model-id-alias';
import { auditCapabilities, type CapabilityAudit, type PickerVerdict } from '../models/auto-picker';
import Dropdown, { type DropdownOption } from './Dropdown';
import LocalRuntimeToggle from './LocalRuntimeToggle';

interface Status { running: boolean; pid: number | null }

interface LlamaInfo {
  baseUrl: string;
  bearerToken: string;
  port: number;
  modelPath: string;
}

function formatBytesPerSec(bps: number): string {
  if (!bps || bps < 1) return '—';
  if (bps >= 1024 ** 3) return `${(bps / 1024 ** 3).toFixed(2)} GB/s`;
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 && m < 10 ? `${m}m${s.toString().padStart(2, '0')}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm.toString().padStart(2, '0')}m`;
}

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function formatHttpErr(status: number, body: string): string {
  try {
    const j = JSON.parse(body);
    const detail = typeof j?.detail === 'string' ? j.detail : null;
    if (detail) return `${status} · ${detail.slice(0, 200)}`;
  } catch {}
  return `HTTP ${status} ${body.slice(0, 160)}`;
}

// Fire-and-forget install of a sidecar local model + poll until installed.
// Calls onProgress with percent (0-100) every poll tick.
async function ensureSidecarModel(
  monkeyUrl: string,
  modelId: string,
  onProgress: (pct: number) => void,
): Promise<boolean> {
  try {
    const probe = await tauriFetch(`${monkeyUrl}/local-models/${modelId}/status`);
    if (probe.ok) {
      const s = await probe.json() as { installed?: boolean };
      if (s?.installed) return true;
    }
    const kick = await tauriFetch(`${monkeyUrl}/local-models/${modelId}/install`, { method: 'POST' } as any);
    if (!kick.ok) return false;
  } catch { return false; }
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const r = await tauriFetch(`${monkeyUrl}/local-models/${modelId}/status`);
      if (!r.ok) continue;
      const s = await r.json() as { installed?: boolean; download?: { percent?: number; status?: string } };
      if (s?.installed) return true;
      const pct = typeof s?.download?.percent === 'number' ? s.download.percent : 0;
      onProgress(pct);
      if (s?.download?.status === 'error') return false;
    } catch {}
  }
  return false;
}

function decodeJwtSub(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json);
    return claims.sub || null;
  } catch { return null; }
}

type RuntimeState = 'probing' | 'active' | 'idle';

// Module-scope singleton so sidecar download % survives tab switches
// (component unmount resets useState, but this cache persists).
type SidecarStatusMap = Record<string, { installed: boolean; pct: number | null; err: string | null }>;
let _sidecarCache: SidecarStatusMap = {};
const _sidecarListeners = new Set<() => void>();
function _setSidecarCache(next: SidecarStatusMap) {
  _sidecarCache = next;
  _sidecarListeners.forEach(fn => fn());
}
function subscribeSidecarStatus(fn: () => void): () => void {
  _sidecarListeners.add(fn);
  return () => { _sidecarListeners.delete(fn); };
}

export default function ProviderHostingPanel() {
  const [status, setStatus] = useState<Status>({ running: false, pid: null });
  const [llamaInfo, setLlamaInfo] = useState<LlamaInfo | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('probing');
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [endpointProbing, setEndpointProbing] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState('1');
  const [busy, setBusy] = useState(false);
  // Shared activation state — same store the TopBar power button reads from,
  // so both surfaces spin together during a toggle from either side.
  const [localBusy, setLocalBusyState] = useState<boolean>(() => getLocalBusy());
  const [localProgress, setLocalProgressState] = useState<AutoProgress | null>(() => getLocalProgress());
  useEffect(() => subscribeLocalRuntime(() => {
    setLocalBusyState(getLocalBusy());
    setLocalProgressState(getLocalProgress());
  }), []);
  const [shareMode, setShareMode] = useState<'dedicated' | 'shared'>(
    () => (localStorage.getItem('provider.shareMode') as 'dedicated' | 'shared') || 'shared',
  );
  useEffect(() => { localStorage.setItem('provider.shareMode', shareMode); }, [shareMode]);
  const [audit, setAudit] = useState<CapabilityAudit | null>(null);
  // Chat pick is shared with the TopBar toggle, agent runtime selector, and
  // InputBar composer — single source of truth in `app.localModelPick`. The
  // panel uses 'auto' as a sentinel for "no explicit pick" (empty string in
  // the underlying store).
  const catalogIds = useMemo(() => CATALOG.map(m => m.id), []);
  const readPickChat = (): string => {
    const raw = getLocalModelPick();
    if (!raw) return 'auto';
    return resolveModelIdAlias(raw, catalogIds);
  };
  const [pickChat, setPickChatState] = useState<string>(() => readPickChat());
  const setPickChat = (id: string) => {
    setPickChatState(id);
    setLocalModelPick(id === 'auto' ? '' : id);
  };
  useEffect(() => {
    const unsub = subscribeRuntimeMode(() => {
      setPickChatState(readPickChat());
      // TopBar toggle changes runtimeMode without going through the panel;
      // refresh so the panel's runtimeOk / activeModel catch up.
      refreshLlama();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [pickEmbed, setPickEmbed] = useState<string>(
    () => localStorage.getItem('provider.pickEmbed') || 'auto',
  );
  useEffect(() => { localStorage.setItem('provider.pickEmbed', pickEmbed); }, [pickEmbed]);
  const [pickImage, setPickImage] = useState<string>(
    () => localStorage.getItem('provider.pickImage') || 'auto',
  );
  useEffect(() => { localStorage.setItem('provider.pickImage', pickImage); }, [pickImage]);
  const [pickTranscribe, setPickTranscribe] = useState<string>(
    () => localStorage.getItem('provider.pickTranscribe') || 'auto',
  );
  useEffect(() => { localStorage.setItem('provider.pickTranscribe', pickTranscribe); }, [pickTranscribe]);
  const [pickTts, setPickTts] = useState<string>(
    () => localStorage.getItem('provider.pickTts') || 'auto',
  );
  useEffect(() => { localStorage.setItem('provider.pickTts', pickTts); }, [pickTts]);
  const [userModels, setUserModels] = useState<UserModel[]>(() => loadUserModels());
  const [installedFiles, setInstalledFiles] = useState<Set<string>>(new Set());
  // Catalog download progress lives in a module-scope singleton so a tab
  // switch (which unmounts this panel) doesn't reset the sliding-window
  // samples — otherwise bytesPerSec falls back to 0 and the user sees no
  // speed/ETA for the first few seconds after remount. See
  // `catalog-downloads.ts` CRITICAL INVARIANT block.
  const [dlSnap, setDlSnap] = useState<{ busy: Set<string>; stats: Record<string, CatalogDlStats> }>(
    () => getCatalogDownloadsSnapshot(),
  );
  useEffect(() => subscribeCatalogDownloads(() => setDlSnap(getCatalogDownloadsSnapshot())), []);
  const dlBusy = dlSnap.busy;
  const dlStats = dlSnap.stats;
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; ms: number; text: string; modelLabel: string } | null>(null);
  type ModalityTest = {
    ok: boolean;
    ms: number;
    text: string;
    modelLabel: string;
    imageDataUrl?: string;
    audioUrl?: string;
  };
  const [modalityBusy, setModalityBusy] = useState<Set<Modality>>(new Set());
  const [modalityResult, setModalityResult] = useState<Partial<Record<Modality, ModalityTest>>>({});

  // Sidecar tools (OCR / sentiment / image classification). Distinct from the
  // GGUF modalities above — ONNX or system binaries, installed via the python
  // sidecar's /local-models endpoints, consumed by the agent locally OR
  // through the P2P friend fallback in monkey/local_models/tools.py.
  type SidecarToolKind = 'system' | 'onnx';
  type SidecarToolSpec = { id: string; label: string; desc: string; kind: SidecarToolKind; hint?: string };
  const SIDECAR_TOOLS: SidecarToolSpec[] = [
    {
      id: 'paddle-ocr-v4',
      label: 'OCR (PaddleOCR PP-OCRv4)',
      desc: 'Modern OCR (Latin + CJK + Arabic), better than Tesseract on photos and complex layouts. Ships with the sidecar (~40 MB ONNX models, rapidocr-onnxruntime).',
      kind: 'system',
      hint: 'Bundled with the Python sidecar. If missing: pip install rapidocr-onnxruntime',
    },
    {
      id: 'tesseract',
      label: 'OCR (Tesseract, fallback)',
      desc: 'System binary fallback. Faster on clean printed text and very low-resource boxes. The router prefers PaddleOCR when both are installed.',
      kind: 'system',
      hint: 'macOS: brew install tesseract tesseract-lang · Debian/Ubuntu: apt install tesseract-ocr tesseract-ocr-fra',
    },
    {
      id: 'xlm-sentiment',
      label: 'Multilingual sentiment (BERT)',
      desc: 'Multilingual sentiment classifier (1-5 stars). FR/EN/ES/DE/IT/NL. ONNX, ~170 MB.',
      kind: 'onnx',
    },
    {
      id: 'vit-image-classify',
      label: 'Image labels (ViT)',
      desc: 'ImageNet image classifier, top-k labels. ONNX, ~340 MB.',
      kind: 'onnx',
    },
    {
      id: 'triposplat',
      label: '2D → 3D (TripoSplat)',
      desc: 'Converts a single image into a 3D Gaussian splat (.ply) on-device. VAST-AI TripoSplat, ~7.4 GB (birefnet + diffusion + DINO v3). Requires torch (bundled with the Python sidecar).',
      kind: 'onnx',
    },
  ];
  type SidecarStatus = { installed: boolean; pct: number | null; err: string | null };
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatusMap>(() => _sidecarCache);
  const [sidecarBusy, setSidecarBusy] = useState<Set<string>>(new Set());

  // Stay in sync with module-scope cache (survives tab switches / remounts).
  useEffect(() => {
    const unsub = subscribeSidecarStatus(() => setSidecarStatus(_sidecarCache));
    return () => unsub();
  }, []);

  const refreshInstalled = async () => {
    // Disk GGUFs (llama-server backend) AND Ollama-backed catalog entries —
    // Ministral 3 lives in `~/.ollama/models/blobs/sha256-*`, never as a
    // standalone .gguf, so without this probe the panel would forever show
    // "Download" and clicking it would no-op (already pulled in Ollama).
    let diskFiles: string[] = [];
    try {
      diskFiles = await invoke<string[]>('llama_runtime_list_installed_models');
    } catch {}
    const next = new Set(diskFiles.map(f => f.toLowerCase()));
    const ollamaBacked = CATALOG.filter(m => m.backend === 'ollama' && m.ollamaTag);
    const checks = await Promise.all(
      ollamaBacked.map(async m => {
        try {
          const ok = await invoke<boolean>('ollama_model_installed', { modelTag: m.ollamaTag });
          return ok ? m.ggufFile.toLowerCase() : null;
        } catch {
          return null;
        }
      }),
    );
    for (const key of checks) if (key) next.add(key);
    setInstalledFiles(next);
  };

  useEffect(() => { refreshInstalled(); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const probe = await invoke<{ totalRamBytes: number; freeDiskBytes: number }>('llama_runtime_probe_resources');
        if (cancelled) return;
        setAudit(auditCapabilities(probe, { mode: shareMode }));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [shareMode]);

  const jwt = useMemo(() => localStorage.getItem('jwt') || '', []);
  const userId = useMemo(() => decodeJwtSub(jwt), [jwt]);
  const loggedIn = !!userId;
  const activeModel = useMemo(() => {
    if (!llamaInfo) return null;
    const um = userModels.find(m => m.absolutePath === llamaInfo.modelPath);
    if (um) return { id: um.id, label: um.displayName };
    const fname = llamaInfo.modelPath.split(/[\\/]/).pop() || '';
    const hit = CATALOG.find(m => fname.toLowerCase() === m.ggufFile.toLowerCase());
    return hit ? { id: hit.id, label: hit.displayName } : null;
  }, [llamaInfo, userModels]);

  useEffect(() => {
    invoke<Status>('provider_runtime_status').then(setStatus).catch(() => {});
    const t = setInterval(() => {
      invoke<Status>('provider_runtime_status').then(setStatus).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const refreshLlama = async () => {
    try {
      const info = await invoke<LlamaInfo | null>('llama_runtime_info');
      if (info) {
        setLlamaInfo(info);
        setRuntimeState('active');
      } else {
        setLlamaInfo(null);
        setRuntimeState('idle');
        const lastErr = await invoke<string | null>('llama_runtime_last_error').catch(() => null);
        if (lastErr) setErr(lastErr);
      }
    } catch {
      setLlamaInfo(null);
      setRuntimeState('idle');
    }
  };

  useEffect(() => {
    refreshLlama();
    const t = setInterval(refreshLlama, 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setEndpointProbing(true);
    fetch('https://api.ipify.org?format=json')
      .then(r => r.ok ? r.json() : null)
      .then(j => setPublicIp(j?.ip || null))
      .catch(() => setPublicIp(null))
      .finally(() => setEndpointProbing(false));
  }, []);

  const endpoint = publicIp ? `https://${publicIp}:8443` : '';
  const runtimeOk = runtimeState === 'active' && !!activeModel;

  // Auto-apply pickChat: when the user changes the chat model and a runtime is
  // already loaded with a different model, restart it with the new pick. Skip
  // while busy, while the provider is sharing on P2P, and when pick === 'auto'.
  useEffect(() => {
    if (busy || localBusy) return;
    if (status.running) return;
    if (!runtimeOk || !activeModel) return;
    if (pickChat === 'auto') return;
    if (activeModel.id === pickChat) return;
    onActivateLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickChat, activeModel?.id, runtimeOk, busy, localBusy, status.running]);

  async function onStart() {
    setErr(null);
    if (!loggedIn) { setErr('Sign in first.'); return; }
    if (!endpoint) { setErr('Could not detect your public address. Check your connection and retry.'); return; }
    setBusy(true);
    try {
      // Delegate to the shared local-runtime singleton so the download (a Rust
      // task that streams independently of any JS Promise) keeps streaming
      // even if the user switches tabs and unmounts this panel. See
      // `local-runtime.ts` CRITICAL INVARIANT block + `local-runtime.test.ts`.
      const ensured = await activateLocalRuntime({
        mode: shareMode,
        preferModelId: pickChat !== 'auto' ? pickChat : undefined,
      });
      await refreshLlama();
      const next = await invoke<Status>('provider_runtime_start', {
        model: ensured.modelId,
        endpoint,
        server: backendUrl,
        jwt,
      });
      setStatus(next);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function onStop() {
    setErr(null);
    try {
      const next = await invoke<Status>('provider_runtime_stop');
      setStatus(next);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  async function onActivateLocal() {
    setErr(null);
    if (!loggedIn) { setErr('Sign in first.'); return; }
    try {
      await activateLocalRuntime({
        mode: shareMode,
        preferModelId: pickChat !== 'auto' ? pickChat : undefined,
      });
      await refreshLlama();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  async function onTestActive() {
    if (!llamaInfo || !activeModel) return;
    setTestBusy(true);
    setTestResult(null);
    const started = performance.now();
    try {
      const res = await tauriFetch(`${llamaInfo.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(llamaInfo.bearerToken ? { Authorization: `Bearer ${llamaInfo.bearerToken}` } : {}),
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Say hi in 3 words.' }],
          max_tokens: 24,
          temperature: 0.2,
          stream: false,
        }),
      } as any);
      const ms = Math.round(performance.now() - started);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        setTestResult({ ok: false, ms, text: `HTTP ${res.status} ${body.slice(0, 120)}`, modelLabel: activeModel.label });
        return;
      }
      const json: any = await res.json();
      const text = (json?.choices?.[0]?.message?.content || '').trim().slice(0, 160) || '(empty response)';
      setTestResult({ ok: true, ms, text, modelLabel: activeModel.label });
    } catch (e: any) {
      const ms = Math.round(performance.now() - started);
      setTestResult({ ok: false, ms, text: String(e?.message || e), modelLabel: activeModel.label });
    } finally {
      setTestBusy(false);
    }
  }

  const MONKEY_URL = (import.meta as any).env?.VITE_MONKEY_URL || 'http://localhost:3471';

  async function probeSidecar(id: string): Promise<SidecarStatus> {
    try {
      const r = await tauriFetch(`${MONKEY_URL}/local-models/${id}/status`);
      if (!r.ok) return { installed: false, pct: null, err: null };
      const s = await r.json() as { installed?: boolean; download?: { percent?: number; status?: string } };
      return {
        installed: !!s?.installed,
        pct: typeof s?.download?.percent === 'number' ? s.download.percent : null,
        err: s?.download?.status === 'error' ? 'install failed — see sidecar log' : null,
      };
    } catch {
      return { installed: false, pct: null, err: null };
    }
  }

  function updateSidecarStatus(updater: (prev: SidecarStatusMap) => SidecarStatusMap) {
    const next = updater(_sidecarCache);
    _setSidecarCache(next);
    setSidecarStatus(next);
  }

  async function refreshSidecarStatus() {
    const next: SidecarStatusMap = {};
    await Promise.all(SIDECAR_TOOLS.map(async tool => {
      next[tool.id] = await probeSidecar(tool.id);
    }));
    _setSidecarCache(next);
    setSidecarStatus(next);
  }

  useEffect(() => {
    refreshSidecarStatus();
    const t = setInterval(refreshSidecarStatus, 5_000);
    return () => clearInterval(t);
  }, []);

  async function onSidecarInstall(id: string) {
    if (sidecarBusy.has(id)) return;
    const tool = SIDECAR_TOOLS.find(t => t.id === id);
    if (!tool) return;
    setSidecarBusy(prev => { const next = new Set(prev); next.add(id); return next; });
    if (tool.kind === 'system') {
      // No managed install — just refresh the probe so the badge updates if
      // the user already ran the package-manager step.
      const probed = await probeSidecar(id);
      updateSidecarStatus(prev => ({ ...prev, [id]: probed }));
      setSidecarBusy(prev => { const next = new Set(prev); next.delete(id); return next; });
      return;
    }
    updateSidecarStatus(prev => ({ ...prev, [id]: { installed: false, pct: 0, err: null } }));
    const ok = await ensureSidecarModel(MONKEY_URL, id, pct => {
      updateSidecarStatus(prev => ({ ...prev, [id]: { installed: false, pct, err: null } }));
    });
    if (!ok) {
      updateSidecarStatus(prev => ({ ...prev, [id]: { installed: false, pct: null, err: 'install failed — check sidecar log' } }));
    }
    setSidecarBusy(prev => { const next = new Set(prev); next.delete(id); return next; });
    await refreshSidecarStatus();
  }

  async function onSidecarUninstall(id: string) {
    if (sidecarBusy.has(id)) return;
    const tool = SIDECAR_TOOLS.find(t => t.id === id);
    if (!tool || tool.kind === 'system') return;
    setSidecarBusy(prev => { const next = new Set(prev); next.add(id); return next; });
    try {
      await tauriFetch(`${MONKEY_URL}/local-models/${id}`, { method: 'DELETE' } as any);
    } catch {}
    setSidecarBusy(prev => { const next = new Set(prev); next.delete(id); return next; });
    await refreshSidecarStatus();
  }

  async function onTestModality(modality: Modality, selectedId: string) {
    if (modalityBusy.has(modality)) return;
    setModalityBusy(prev => { const next = new Set(prev); next.add(modality); return next; });
    setModalityResult(prev => { const next = { ...prev }; delete next[modality]; return next; });
    const started = performance.now();
    const label = (() => {
      if (selectedId === 'auto') {
        const pick = audit?.[modality]?.model;
        return pick?.displayName ?? 'auto';
      }
      const u = userModels.find(m => m.id === selectedId);
      if (u) return u.displayName;
      const c = CATALOG.find(m => m.id === selectedId);
      return c?.displayName ?? selectedId;
    })();
    try {
      if (modality === 'chat') {
        let info = llamaInfo;
        if (!info) {
          const ensured = await ensureActiveModel(undefined, {
            mode: shareMode,
            preferModelId: selectedId !== 'auto' ? selectedId : undefined,
          });
          info = ensured.info;
          setLlamaInfo(info);
          setRuntimeState('active');
        }
        const res = await tauriFetch(`${info.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(info.bearerToken ? { Authorization: `Bearer ${info.bearerToken}` } : {}),
          },
          body: JSON.stringify({
            messages: [{ role: 'user', content: 'Say hi in 3 words.' }],
            max_tokens: 24,
            temperature: 0.2,
            stream: false,
          }),
        } as any);
        const ms = Math.round(performance.now() - started);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: `HTTP ${res.status} ${body.slice(0, 120)}`, modelLabel: label } }));
          return;
        }
        const json: any = await res.json();
        const text = (json?.choices?.[0]?.message?.content || '').trim().slice(0, 200) || '(empty response)';
        setModalityResult(prev => ({ ...prev, [modality]: { ok: true, ms, text, modelLabel: label } }));
      } else if (modality === 'embed') {
        const ensured = await ensureEmbedModel({
          mode: shareMode,
          preferModelId: selectedId !== 'auto' ? selectedId : undefined,
        });
        const res = await tauriFetch(`${ensured.info.baseUrl}/v1/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(ensured.info.bearerToken ? { Authorization: `Bearer ${ensured.info.bearerToken}` } : {}),
          },
          body: JSON.stringify({ input: 'A vanilla ice cream sundae.' }),
        } as any);
        const ms = Math.round(performance.now() - started);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: `HTTP ${res.status} ${body.slice(0, 120)}`, modelLabel: label } }));
          return;
        }
        const json: any = await res.json();
        const raw = json?.data?.[0]?.embedding ?? [];
        // llama-server may return a 2D array (per-token pooling) — use first row.
        const flat: any[] = Array.isArray(raw) && Array.isArray(raw[0]) ? raw[0] : raw;
        const dim = Array.isArray(flat) ? flat.length : 0;
        if (!dim) {
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: 'empty embedding returned', modelLabel: label } }));
          return;
        }
        const preview = flat
          .slice(0, 4)
          .map((v: any) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(3) : '?'))
          .join(', ');
        setModalityResult(prev => ({ ...prev, [modality]: { ok: true, ms, text: `dim ${dim} · [${preview}, …]`, modelLabel: label } }));
      } else if (modality === 'image') {
        const res = await tauriFetch(`${MONKEY_URL}/generate-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: 'a glossy vanilla ice cream sundae in a coupe glass, studio photo, soft warm light, 50mm',
            model_id: 'black-forest-labs/flux-schnell',
            size: '1024x1024',
          }),
        } as any);
        const ms = Math.round(performance.now() - started);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: `HTTP ${res.status} ${body.slice(0, 160)}`, modelLabel: label } }));
          return;
        }
        const json: any = await res.json();
        const out = String(json?.result || '');
        const m = out.match(/(https?:\/\/\S+)/);
        const url = m ? m[1] : '';
        const isPath = /^\//.test(out.split('\n')[0] || '');
        if (url) {
          setModalityResult(prev => ({ ...prev, [modality]: { ok: true, ms, text: 'image generated', modelLabel: label, imageDataUrl: url } }));
        } else if (isPath) {
          setModalityResult(prev => ({ ...prev, [modality]: { ok: true, ms, text: `saved → ${out.slice(0, 200)}`, modelLabel: label } }));
        } else {
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: out.slice(0, 200) || '(no image url returned)', modelLabel: label } }));
        }
      } else if (modality === 'tts') {
        const callTts = () => tauriFetch(`${MONKEY_URL}/local-tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Bonjour, je suis MonkeyAgent. Test de synthèse vocale locale.' }),
        } as any);
        let res = await callTts();
        if (res.status === 409) {
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: 0, text: 'installing Piper (~130 MB)…', modelLabel: 'Piper TTS' } }));
          const ok = await ensureSidecarModel(MONKEY_URL, 'piper-tts', pct => {
            setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: 0, text: `downloading Piper ${pct}%…`, modelLabel: 'Piper TTS' } }));
          });
          if (!ok) {
            setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: Math.round(performance.now() - started), text: 'Piper install failed', modelLabel: label } }));
            return;
          }
          res = await callTts();
        }
        const ms = Math.round(performance.now() - started);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: formatHttpErr(res.status, body), modelLabel: label } }));
          return;
        }
        const json: any = await res.json();
        const audioPath = json?.audio_path as string | undefined;
        if (!audioPath) {
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: 'no audio_path in response', modelLabel: label } }));
          return;
        }
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const audioUrl = convertFileSrc(audioPath);
        setModalityResult(prev => ({ ...prev, [modality]: { ok: true, ms, text: `voice ${json.voice || '?'} · ${(json.bytes || 0)}B`, modelLabel: label, audioUrl } }));
        try { new Audio(audioUrl).play().catch(() => {}); } catch {}
      } else if (modality === 'transcribe') {
        const callAsr = () => tauriFetch(`${MONKEY_URL}/local-transcribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selftest: true }),
        } as any);
        let res = await callAsr();
        if (res.status === 409) {
          const body = await res.text().catch(() => '');
          const needsPiper = body.includes('selftest needs a TTS') || body.includes('TTS model');
          const needsWhisper = body.includes('no ASR') || body.includes('ASR model');
          if (needsWhisper) {
            setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: 0, text: 'installing Whisper (~145 MB)…', modelLabel: 'Whisper base' } }));
            const ok = await ensureSidecarModel(MONKEY_URL, 'whisper-base', pct => {
              setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: 0, text: `downloading Whisper ${pct}%…`, modelLabel: 'Whisper base' } }));
            });
            if (!ok) {
              setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: Math.round(performance.now() - started), text: 'Whisper install failed', modelLabel: label } }));
              return;
            }
          }
          // selftest also needs Piper — retry once, install if it complains.
          res = await callAsr();
          if (res.status === 409 || needsPiper) {
            setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: 0, text: 'installing Piper (~130 MB) for selftest…', modelLabel: label } }));
            const ok = await ensureSidecarModel(MONKEY_URL, 'piper-tts', pct => {
              setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: 0, text: `downloading Piper ${pct}%…`, modelLabel: label } }));
            });
            if (!ok) {
              setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: Math.round(performance.now() - started), text: 'Piper install failed', modelLabel: label } }));
              return;
            }
            res = await callAsr();
          }
        }
        const ms = Math.round(performance.now() - started);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: formatHttpErr(res.status, body), modelLabel: label } }));
          return;
        }
        const json: any = await res.json();
        const heard = String(json?.text || '').trim();
        const expected = String(json?.expected_text || '').trim();
        const lang = json?.language ? ` · ${json.language}` : '';
        const summary = expected ? `heard “${heard.slice(0, 120)}” (expected: “${expected.slice(0, 80)}”)${lang}` : (heard || '(no text)');
        setModalityResult(prev => ({ ...prev, [modality]: { ok: !!heard, ms, text: summary, modelLabel: label } }));
      } else {
        setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms: 0, text: 'Test not available yet.', modelLabel: label } }));
      }
    } catch (e: any) {
      const ms = Math.round(performance.now() - started);
      setModalityResult(prev => ({ ...prev, [modality]: { ok: false, ms, text: String(e?.message || e), modelLabel: label } }));
    } finally {
      setModalityBusy(prev => { const next = new Set(prev); next.delete(modality); return next; });
    }
  }

  async function onAddFile(modality: Modality) {
    setErr(null);
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { stat } = await import('@tauri-apps/plugin-fs');
      const extensions = modality === 'transcribe' ? ['gguf', 'bin']
        : modality === 'image' ? ['gguf', 'safetensors']
        : modality === 'tts' ? ['onnx']
        : ['gguf'];
      const picked = await open({
        multiple: false,
        filters: [{ name: 'Model weights', extensions }],
      });
      if (!picked || Array.isArray(picked)) return;
      const filePath = typeof picked === 'string' ? picked : (picked as any).path;
      const info = await stat(filePath);
      const id = makeUserModelId(filePath);
      const um: UserModel = {
        id,
        displayName: basenameStem(filePath),
        modality,
        family: detectFamily(filePath),
        absolutePath: filePath,
        sizeBytes: typeof info.size === 'number' ? info.size : 0,
        addedAt: Date.now(),
      };
      setUserModels(addUserModel(um));
      if (modality === 'chat') setPickChat(id);
      else if (modality === 'embed') setPickEmbed(id);
      else if (modality === 'image') setPickImage(id);
      else if (modality === 'transcribe') setPickTranscribe(id);
      else if (modality === 'tts') setPickTts(id);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  function onRemoveUserModel(id: string) {
    setUserModels(removeUserModel(id));
    if (pickChat === id) setPickChat('auto');
    if (pickEmbed === id) setPickEmbed('auto');
    if (pickImage === id) setPickImage('auto');
    if (pickTranscribe === id) setPickTranscribe('auto');
    if (pickTts === id) setPickTts('auto');
  }

  async function onDownloadCatalog(modelId: string) {
    setErr(null);
    const model = CATALOG.find(m => m.id === modelId);
    if (!model) { setErr(`Unknown model: ${modelId}`); return; }
    // Singleton owns the busy/stats/samples bookkeeping AND the Tauri event
    // listener — so this panel can unmount mid-download without resetting %,
    // speed, ETA, or the sliding-window sample buffer.
    try {
      await startCatalogDownload(model);
      await refreshInstalled();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  async function onDeleteCatalog(modelId: string) {
    setErr(null);
    const model = CATALOG.find(m => m.id === modelId);
    if (!model) return;
    try {
      await invoke('llama_runtime_delete_model', { targetName: model.ggufFile });
      await refreshInstalled();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  const running = status.running;
  const ready = loggedIn && !!endpoint;

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
          <Shield size={18} strokeWidth={2.4} className="text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-black text-[var(--text)]">Share my compute</h2>
            <span
              className={`text-[10px] font-black uppercase tracking-[0.06em] px-2 py-[2px] rounded-full ${
                running
                  ? 'bg-[#3bd16f]/15 text-[#3bd16f] border border-[#3bd16f]/40'
                  : 'bg-[var(--glass-bg-strong)] text-[var(--text-dim)] border border-[var(--glass-border)]'
              }`}
            >
              {running ? 'Live' : 'Off'}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
            Share an open-weights model with the network and help others run inference.
            The app runs everything in-process — no external daemon, no manual setup.
          </p>
        </div>
      </div>

      {/* Checklist */}
      <div className="mt-4 grid gap-2">
        <CheckRow
          ok={loggedIn}
          icon={<Shield size={13} strokeWidth={2.4} />}
          title="Account ready"
          detail={loggedIn ? 'Signed in · network identity managed by the app' : 'Sign in to share compute'}
        />
        <CheckRow
          ok={runtimeOk || busy || localBusy}
          icon={<Cpu size={13} strokeWidth={2.4} />}
          title="Local model"
          detail={(() => {
            // Reads from the shared local-runtime singleton (see local-runtime.ts).
            // A freshly mounted panel sees the in-flight download immediately;
            // the speed/ETA accumulate across tab switches because the sample
            // window lives at module scope, not in this component.
            const p = localProgress;
            if (p) {
              if (p.phase === 'downloading') {
                const head = `Downloading ${p.modelLabel ?? '…'} · ${p.pct ?? 0}%`;
                const bps = p.bytesPerSec ?? 0;
                if (bps > 0) return `${head} · ${formatBytesPerSec(bps)} · ETA ${formatEta(p.etaSec ?? 0)}`;
                return head;
              }
              return p.phase === 'verifying'
                  ? `Verifying ${p.modelLabel ?? '…'}`
                  : p.phase === 'cleaning'
                    ? 'Reclaiming disk space…'
                    : p.phase === 'starting'
                      ? `Starting ${p.modelLabel ?? '…'}`
                      : p.phase === 'probing'
                        ? `Picking best model for your hardware${p.modelLabel ? ` · ${p.modelLabel}` : '…'}`
                        : `${p.modelLabel ?? ''} ready`;
            }
            if (runtimeState === 'probing') return 'Checking bundled runtime…';
            if (runtimeOk && activeModel) return `${activeModel.label} active`;
            return 'Will auto-pick the best model for your hardware on first start';
          })()}
        />
        <CheckRow
          ok={!!endpoint}
          icon={<Globe size={13} strokeWidth={2.4} />}
          title="Network reachable"
          detail={endpointProbing
            ? 'Probing your public address…'
            : endpoint
              ? `${endpoint} · auto-detected`
              : 'Could not detect your public address'}
        />
      </div>

      {/* Privacy strip */}
      <div className="mt-4 px-3 py-2 rounded-[var(--rm)] bg-[var(--glass-bg)] border border-[var(--glass-border)] text-[10.5px] text-[var(--text-dim)] flex items-center gap-3">
        <Shield size={11} strokeWidth={2.4} className="text-[var(--accent)] flex-shrink-0" />
        <span className="leading-snug">
          End-to-end encrypted. Server sees only routing metadata · catalog models hash-checked at start · friend-graph sharing trusts the runtime you choose.
        </span>
      </div>

      {/* Share mode */}
      <div className="mt-4">
        <div className="text-[10px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)] mb-1.5">
          Hardware allocation
        </div>
        <div className="flex gap-1.5">
          {(['shared', 'dedicated'] as const).map(m => (
            <button
              key={m}
              disabled={running}
              onClick={() => setShareMode(m)}
              className={`flex-1 px-3 py-2 rounded-[var(--rm)] text-[11.5px] font-black border transition-colors ${
                shareMode === m
                  ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                  : 'bg-[var(--glass-bg)] text-[var(--text)] border-[var(--glass-border)] hover:border-[var(--accent)]'
              } disabled:opacity-50`}
            >
              <div>{m === 'shared' ? 'Shared (50%)' : 'Dedicated (100%)'}</div>
              <div className={`text-[10px] font-normal mt-0.5 ${shareMode === m ? 'opacity-90' : 'text-[var(--text-dim)]'}`}>
                {m === 'shared' ? 'Keep half your machine for daily use' : 'Donate the whole box to the network'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* What to host — interactive picker */}
      {audit && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="text-[10px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)]">
              What to host
            </div>
            <div className="text-[10px] text-[var(--text-dim)]">
              Auto = best for your hardware
            </div>
          </div>

          <ModalitySection
            label="Chat"
            modality="chat"
            audit={audit}
            selected={pickChat}
            onSelect={setPickChat}
            disabled={running}
            userModels={userModels}
            installedFiles={installedFiles}
            dlBusy={dlBusy}
            dlStats={dlStats}
            onAddFile={() => onAddFile('chat')}
            onRemoveUserModel={onRemoveUserModel}
            onDownloadCatalog={onDownloadCatalog}
            onDeleteCatalog={onDeleteCatalog}
            modalityBusy={modalityBusy}
            modalityResult={modalityResult}
            onTestModality={onTestModality}
          />
          <ModalitySection
            label="Embed (RAG / memory)"
            modality="embed"
            audit={audit}
            selected={pickEmbed}
            onSelect={setPickEmbed}
            disabled={running}
            userModels={userModels}
            installedFiles={installedFiles}
            dlBusy={dlBusy}
            dlStats={dlStats}
            onAddFile={() => onAddFile('embed')}
            onRemoveUserModel={onRemoveUserModel}
            onDownloadCatalog={onDownloadCatalog}
            onDeleteCatalog={onDeleteCatalog}
            modalityBusy={modalityBusy}
            modalityResult={modalityResult}
            onTestModality={onTestModality}
            note="Library stored — embed sidecar picks this up on next activation."
          />
          <ModalitySection
            label="Image (Flux schnell)"
            modality="image"
            audit={audit}
            selected={pickImage}
            onSelect={setPickImage}
            disabled={running}
            userModels={userModels}
            installedFiles={installedFiles}
            dlBusy={dlBusy}
            dlStats={dlStats}
            onAddFile={() => onAddFile('image')}
            onRemoveUserModel={onRemoveUserModel}
            onDownloadCatalog={onDownloadCatalog}
            onDeleteCatalog={onDeleteCatalog}
            modalityBusy={modalityBusy}
            modalityResult={modalityResult}
            onTestModality={onTestModality}
            note="Library stored — image sidecar runtime ships next."
          />
          <ModalitySection
            label="Speech → Text (Whisper)"
            modality="transcribe"
            audit={audit}
            selected={pickTranscribe}
            onSelect={setPickTranscribe}
            disabled={running}
            userModels={userModels}
            installedFiles={installedFiles}
            dlBusy={dlBusy}
            dlStats={dlStats}
            onAddFile={() => onAddFile('transcribe')}
            onRemoveUserModel={onRemoveUserModel}
            onDownloadCatalog={onDownloadCatalog}
            onDeleteCatalog={onDeleteCatalog}
            modalityBusy={modalityBusy}
            modalityResult={modalityResult}
            onTestModality={onTestModality}
            note="Sidecar Whisper (~145 MB) auto-installs on first Test."
          />
          <ModalitySection
            label="Text → Speech (Piper)"
            modality="tts"
            audit={audit}
            selected={pickTts}
            onSelect={setPickTts}
            disabled={running}
            userModels={userModels}
            installedFiles={installedFiles}
            dlBusy={dlBusy}
            dlStats={dlStats}
            onAddFile={() => onAddFile('tts')}
            onRemoveUserModel={onRemoveUserModel}
            onDownloadCatalog={onDownloadCatalog}
            onDeleteCatalog={onDeleteCatalog}
            modalityBusy={modalityBusy}
            modalityResult={modalityResult}
            onTestModality={onTestModality}
            note="Sidecar Piper (~130 MB) auto-installs on first Test."
          />

          <p className="mt-2 text-[10px] text-[var(--text-dim)] leading-snug">
            Chat is the only modality served on the P2P network today. Other slots store your pick so they're ready when the sidecars ship.
          </p>

          {/* Sidecar tools — local-agent tools (OCR / sentiment / image labels).
              Not exposed on the share button yet (provider-runtime serves a
              single chat/embed model per launch). Installing them locally lets
              your agent call them offline; the P2P fallback in
              monkey/local_models/tools.py also lets your agent reach a friend
              who has them when you don't. */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between mb-1.5">
              <div className="text-[10px] font-black uppercase tracking-[0.06em] text-[var(--text-dim)]">
                Sidecar tools (local agent)
              </div>
              <div className="text-[10px] text-[var(--text-dim)]">
                OCR · sentiment · image labels · 2D→3D
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {SIDECAR_TOOLS.map(tool => {
                const st = sidecarStatus[tool.id];
                const installing = sidecarBusy.has(tool.id);
                const installed = !!st?.installed;
                const pct = st?.pct ?? null;
                const localErr = st?.err ?? null;
                return (
                  <div key={tool.id} className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 flex flex-col">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[12px] font-black text-[var(--text)]">{tool.label}</div>
                      {installed ? (
                        <span className="text-[10px] font-black uppercase text-[var(--green)] flex items-center gap-0.5">
                          <Check size={10} strokeWidth={3} /> ready
                        </span>
                      ) : installing && tool.kind === 'onnx' ? (
                        <span className="text-[10px] font-black uppercase text-[var(--accent)] flex items-center gap-0.5">
                          <Loader2 size={10} strokeWidth={3} className="animate-spin" />
                          {pct != null ? `${pct}%` : '…'}
                        </span>
                      ) : (
                        <span className="text-[10px] font-black uppercase text-[var(--text-dim)]">
                          {tool.kind === 'system' ? 'not detected' : 'not installed'}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--text-dim)] leading-snug mb-2 flex-1">
                      {tool.desc}
                    </div>
                    {tool.hint && (
                      <div className="text-[10px] text-[var(--text-dim)] leading-snug mb-2 font-mono break-words">
                        {tool.hint}
                      </div>
                    )}
                    {localErr && (
                      <div className="text-[10px] text-[var(--red)] mb-2">{localErr}</div>
                    )}
                    <div className="flex gap-1.5 mt-auto">
                      {installed ? (
                        tool.kind === 'system' ? (
                          <button
                            onClick={() => onSidecarInstall(tool.id)}
                            disabled={installing}
                            className="flex-1 flex items-center justify-center gap-1 h-7 rounded-full text-[10px] font-black bg-[var(--glass-bg-strong)] text-[var(--text)] border border-[var(--glass-border)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                          >
                            <Activity size={10} strokeWidth={2.6} />
                            Re-check
                          </button>
                        ) : (
                          <button
                            onClick={() => onSidecarUninstall(tool.id)}
                            disabled={installing}
                            className="flex-1 flex items-center justify-center gap-1 h-7 rounded-full text-[10px] font-black bg-[var(--glass-bg-strong)] text-[var(--text)] border border-[var(--glass-border)] hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-40"
                          >
                            <Trash2 size={10} strokeWidth={2.6} />
                            Uninstall
                          </button>
                        )
                      ) : (
                        <button
                          onClick={() => onSidecarInstall(tool.id)}
                          disabled={installing}
                          className="flex-1 flex items-center justify-center gap-1 h-7 rounded-full text-[10px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90 disabled:opacity-40"
                        >
                          {installing
                            ? <Loader2 size={10} strokeWidth={2.6} className="animate-spin" />
                            : tool.kind === 'system'
                              ? <Activity size={10} strokeWidth={2.6} />
                              : <Download size={10} strokeWidth={2.6} />}
                          {installing
                            ? (tool.kind === 'system' ? 'Checking…' : 'Installing…')
                            : (tool.kind === 'system' ? 'Re-check' : 'Install')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[10px] text-[var(--text-dim)] leading-snug">
              These run locally so your agent can use them offline. They aren't yet shared on the P2P network from this machine — the friend fallback in the agent lets you call other users' sidecars when you don't have the model.
            </p>
          </div>
        </div>
      )}

      {/* Action row — local activation is independent of P2P sharing */}
      <div className="mt-4 flex flex-wrap gap-2">
        {running ? (
          <button
            onClick={onStop}
            className="flex items-center gap-2 px-4 h-[34px] rounded-full text-[12px] font-black bg-[var(--red)] text-white hover:opacity-90"
          >
            <Power size={13} strokeWidth={2.6} />
            Stop sharing
          </button>
        ) : (
          <>
            <LocalRuntimeToggle size={34} />
            {runtimeOk && (
              <button
                onClick={onTestActive}
                disabled={busy || localBusy || testBusy}
                title={`Send a tiny prompt to ${activeModel?.label ?? 'the active model'}`}
                className="flex items-center gap-2 px-4 h-[34px] rounded-full text-[12px] font-black bg-[var(--glass-bg-strong)] text-[var(--text)] border border-[var(--glass-border)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
              >
                {testBusy
                  ? <Loader2 size={13} strokeWidth={2.6} className="animate-spin" />
                  : <Activity size={13} strokeWidth={2.6} />}
                {testBusy ? 'Testing…' : 'Test model'}
              </button>
            )}
            <button
              onClick={onStart}
              disabled={!ready || busy || localBusy}
              title={!endpoint ? 'Public address still probing…' : ''}
              className="flex items-center gap-2 px-4 h-[34px] rounded-full text-[12px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90 disabled:opacity-40"
            >
              {busy
                ? <Loader2 size={13} strokeWidth={2.6} className="animate-spin" />
                : <Globe size={13} strokeWidth={2.6} />}
              {busy ? 'Starting…' : runtimeOk ? 'Share on P2P' : 'Activate + share'}
            </button>
          </>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--text-dim)] leading-snug">
        Activate locally to use the model for your own chats. Share on P2P to also serve the network.
      </p>

      {testResult && (
        <div
          className={`mt-3 flex items-start gap-2 px-3 py-2 rounded-[var(--rm)] text-[11.5px] ${
            testResult.ok
              ? 'bg-[#3bd16f]/10 border border-[#3bd16f]/30 text-[#3bd16f]'
              : 'bg-[var(--red)]/10 border border-[var(--red)]/30 text-[var(--red)]'
          }`}
        >
          {testResult.ok
            ? <Check size={12} strokeWidth={2.6} className="flex-shrink-0 mt-[1px]" />
            : <AlertTriangle size={12} strokeWidth={2.4} className="flex-shrink-0 mt-[1px]" />}
          <span className="leading-snug">
            <span className="font-black">{testResult.ok ? 'OK' : 'Failed'}</span>
            {' · '}{testResult.modelLabel}{' · '}{testResult.ms} ms
            {' · '}<span className="opacity-90">"{testResult.text}"</span>
          </span>
        </div>
      )}

      {err && (
        <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-[var(--rm)] bg-[var(--red)]/10 border border-[var(--red)]/30 text-[11.5px] text-[var(--red)]">
          <AlertTriangle size={12} strokeWidth={2.4} className="flex-shrink-0 mt-[1px]" />
          <span className="leading-snug">{err}</span>
        </div>
      )}

      {/* Advanced */}
      <button
        onClick={() => setAdvanced(v => !v)}
        className="mt-4 flex items-center gap-1 text-[10.5px] font-bold text-[var(--text-dim)] hover:text-[var(--text)]"
      >
        <ChevronDown size={11} strokeWidth={2.4} className={`transition-transform ${advanced ? 'rotate-180' : ''}`} />
        Advanced
      </button>
      {advanced && (
        <div className="mt-2 grid grid-cols-2 gap-2 max-w-[420px]">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-black">Max concurrent jobs</span>
            <input
              disabled={running}
              value={maxConcurrent}
              onChange={e => setMaxConcurrent(e.target.value)}
              className="px-2.5 py-1.5 rounded-[var(--rm)] text-[12px] bg-[var(--glass-bg-strong)] border border-[var(--glass-border)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function CheckRow({
  ok, icon, title, detail,
}: { ok: boolean; icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-[var(--rm)] bg-[var(--glass-bg)] border border-[var(--glass-border)]">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
          ok ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-[var(--glass-bg-strong)] text-[var(--text-dim)]'
        }`}
      >
        {ok ? <Check size={13} strokeWidth={2.6} /> : icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-black text-[var(--text)]">{title}</div>
        <div className="text-[10.5px] text-[var(--text-dim)] truncate">{detail}</div>
      </div>
    </div>
  );
}

const FAMILY_LABEL: Record<Family, string> = {
  phi: 'Phi',
  llama: 'Llama',
  qwen: 'Qwen',
  mistral: 'Mistral',
  flux: 'Flux',
  whisper: 'Whisper',
  piper: 'Piper',
  bge: 'BGE',
  custom: 'Custom',
};

function ModalitySection({
  label, modality, audit, selected, onSelect, disabled,
  userModels, installedFiles, dlBusy, dlStats: dlStatsMap,
  onAddFile, onRemoveUserModel, onDownloadCatalog, onDeleteCatalog,
  modalityBusy, modalityResult, onTestModality, note,
}: {
  label: string;
  modality: Modality;
  audit: CapabilityAudit;
  selected: string;
  onSelect: (id: string) => void;
  disabled: boolean;
  userModels: UserModel[];
  installedFiles: Set<string>;
  dlBusy: Set<string>;
  dlStats: Record<string, CatalogDlStats>;
  onAddFile: () => void;
  onRemoveUserModel: (id: string) => void;
  onDownloadCatalog: (modelId: string) => void;
  onDeleteCatalog: (modelId: string) => void;
  modalityBusy: Set<Modality>;
  modalityResult: Partial<Record<Modality, {
    ok: boolean; ms: number; text: string; modelLabel: string;
    imageDataUrl?: string; audioUrl?: string;
  }>>;
  onTestModality: (modality: Modality, selectedId: string) => void;
  note?: string;
}) {
  const testing = modalityBusy.has(modality);
  const tResult = modalityResult[modality];
  const catalogModels = catalogByModality(modality);
  const myUserModels = userModels.filter(m => m.modality === modality);
  const allModels: Array<{ id: string; family: Family; displayName: string; sizeBytes: number; isUser: boolean }> = [
    ...catalogModels.map(m => ({
      id: m.id, family: m.family, displayName: m.displayName, sizeBytes: m.sizeBytes, isUser: false,
    })),
    ...myUserModels.map(m => ({
      id: m.id, family: m.family, displayName: m.displayName, sizeBytes: m.sizeBytes, isUser: true,
    })),
  ];

  const verdicts = new Map<string, PickerVerdict>(audit.verdicts.map(v => [v.modelId, v]));
  const autoPick = audit[modality].model;
  const reason = audit[modality].reason;
  const families: Family[] = Array.from(new Set(allModels.map(m => m.family)));

  const selectedFamily: 'auto' | Family = selected === 'auto'
    ? 'auto'
    : (allModels.find(m => m.id === selected)?.family ?? 'auto');
  const modelsInFamily = selectedFamily === 'auto'
    ? []
    : allModels.filter(m => m.family === selectedFamily);
  const selectedIsUser = selected !== 'auto' && myUserModels.some(m => m.id === selected);
  const selectedCatalog: CatalogModel | undefined = !selectedIsUser && selected !== 'auto'
    ? catalogModels.find(m => m.id === selected)
    : undefined;
  const selectedInstalled = !!selectedCatalog
    && installedFiles.has(selectedCatalog.ggufFile.toLowerCase());
  const isDownloading = !!selectedCatalog && dlBusy.has(selectedCatalog.id);
  const selectedCatalogDlStats: CatalogDlStats = (selectedCatalog && dlStatsMap[selectedCatalog.id]) || { pct: 0, bytesPerSec: 0, etaSec: 0 };

  function handleFamilyChange(fam: 'auto' | Family) {
    if (fam === 'auto') { onSelect('auto'); return; }
    const inFam = allModels.filter(m => m.family === fam);
    const firstFit = inFam.find(m => {
      const v = verdicts.get(m.id);
      return !v || (v.ramOk && v.diskOk && v.speedOk);
    });
    onSelect((firstFit ?? inFam[0])?.id ?? 'auto');
  }

  const familyOptions: DropdownOption[] = [
    { value: 'auto', label: 'Auto' },
    ...families.map(f => ({ value: f, label: FAMILY_LABEL[f] })),
  ];

  const modelOptions: DropdownOption[] = selectedFamily === 'auto'
    ? [
        { value: '__auto', label: autoPick ? autoPick.displayName : 'Picked by Auto', hint: autoPick ? 'auto' : undefined },
        { value: '__add_file', label: '+ Load from file…' },
      ]
    : [
        ...modelsInFamily.map(m => {
          const v = verdicts.get(m.id);
          const fits = !v || (v.ramOk && v.diskOk && v.speedOk);
          const sizeGb = (m.sizeBytes / 1024 / 1024 / 1024).toFixed(1);
          return {
            value: m.id,
            label: m.isUser ? `${m.displayName} · your file` : m.displayName,
            hint: `${sizeGb} GB${fits ? '' : ' · too heavy'}`,
          };
        }),
        { value: '__add_file', label: '+ Load from file…' },
      ];

  return (
    <div className="mt-2 px-3 py-2.5 rounded-[var(--rm)] border bg-[var(--glass-bg)] border-[var(--glass-border)]">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-black text-[var(--text)]">{label}</span>
        {autoPick && (
          <span className="ml-auto text-[10px] text-[var(--text-dim)]">
            Auto → <span className="font-bold text-[var(--text)]">{autoPick.displayName}</span>
          </span>
        )}
        {!autoPick && (
          <span className="ml-auto text-[10px] text-[var(--text-dim)]">
            {reason === 'insufficient_ram' ? 'Not enough RAM'
              : reason === 'insufficient_disk' ? 'Not enough disk'
              : reason === 'insufficient_throughput' ? 'CPU too slow'
              : 'Load a file to host'}
          </span>
        )}
        <button
          onClick={() => onTestModality(modality, selected)}
          disabled={disabled || testing}
          title={`Send a test request to the ${label.toLowerCase()} model`}
          className="ml-1 px-2 py-1 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40 flex items-center gap-1"
        >
          {testing
            ? <Loader2 size={11} strokeWidth={2.4} className="animate-spin" />
            : <Activity size={11} strokeWidth={2.4} />}
          <span className="text-[10px] font-black">{testing ? 'Test…' : 'Play'}</span>
        </button>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2 items-stretch">
        <Dropdown
          value={selectedFamily}
          options={familyOptions}
          onChange={v => handleFamilyChange(v as 'auto' | Family)}
          disabled={disabled}
          title="Model family"
        />
        <Dropdown
          value={selectedFamily === 'auto' ? '__auto' : selected}
          options={modelOptions}
          onChange={v => {
            if (v === '__add_file') onAddFile();
            else if (v !== '__auto') onSelect(v);
          }}
          disabled={disabled}
          title="Model variant"
        />
        {selectedIsUser ? (
          <button
            onClick={() => onRemoveUserModel(selected)}
            disabled={disabled}
            title="Remove this file from the library"
            className="px-2 rounded-[var(--rm)] border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-[var(--text-dim)] hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-40"
          >
            <Trash2 size={11} strokeWidth={2.4} />
          </button>
        ) : selectedCatalog && isDownloading ? (
          // Inline picker badge — the per-row "Download" button is collapsed
          // into the picker until the user expands the dropdown, so this is
          // the ONLY place a downloading user sees telemetry. Show speed +
          // ETA inline (not just %) — otherwise the panel looks frozen for
          // multi-GB models even though bytes are flying to disk.
          <button
            disabled
            title={
              selectedCatalogDlStats.bytesPerSec > 0
                ? `Downloading ${selectedCatalogDlStats.pct}% · ${formatBytesPerSec(selectedCatalogDlStats.bytesPerSec)} · ETA ${formatEta(selectedCatalogDlStats.etaSec)}`
                : `Downloading ${selectedCatalogDlStats.pct}%`
            }
            data-testid="catalog-dl-badge"
            data-pct={selectedCatalogDlStats.pct}
            data-bps={selectedCatalogDlStats.bytesPerSec}
            className="px-2 rounded-[var(--rm)] border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] flex items-center gap-1"
          >
            <Loader2 size={11} strokeWidth={2.4} className="animate-spin" />
            <span className="text-[10px] font-black">{selectedCatalogDlStats.pct}%</span>
            {selectedCatalogDlStats.bytesPerSec > 0 && (
              <span className="text-[9px] font-semibold opacity-80">
                {formatBytesPerSec(selectedCatalogDlStats.bytesPerSec)} · ETA {formatEta(selectedCatalogDlStats.etaSec)}
              </span>
            )}
          </button>
        ) : selectedCatalog && !selectedInstalled ? (
          <button
            onClick={() => onDownloadCatalog(selectedCatalog.id)}
            disabled={disabled || dlBusy.has(selectedCatalog.id)}
            title={`Download ${selectedCatalog.displayName}`}
            className="px-2 rounded-[var(--rm)] border border-[var(--accent)] bg-[var(--glass-bg-strong)] text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
          >
            <Download size={11} strokeWidth={2.4} />
          </button>
        ) : selectedCatalog && selectedInstalled ? (
          <button
            onClick={() => onDeleteCatalog(selectedCatalog.id)}
            disabled={disabled}
            title={`Delete ${selectedCatalog.displayName} from disk`}
            className="px-2 rounded-[var(--rm)] border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-[var(--text-dim)] hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-40"
          >
            <Trash2 size={11} strokeWidth={2.4} />
          </button>
        ) : (
          <button
            onClick={onAddFile}
            disabled={disabled}
            title="Load a model file from disk"
            className="px-2 rounded-[var(--rm)] border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
          >
            <Plus size={11} strokeWidth={2.4} />
          </button>
        )}
      </div>

      {tResult && (
        <div
          className={`mt-2 px-2 py-1.5 rounded-[var(--rm)] text-[10.5px] leading-snug border ${
            tResult.ok
              ? 'bg-[#3bd16f]/10 border-[#3bd16f]/30 text-[#3bd16f]'
              : 'bg-[var(--red)]/10 border-[var(--red)]/30 text-[var(--red)]'
          }`}
        >
          <div className="flex items-start gap-1.5">
            {tResult.ok
              ? <Check size={11} strokeWidth={2.6} className="flex-shrink-0 mt-[1px]" />
              : <AlertTriangle size={11} strokeWidth={2.4} className="flex-shrink-0 mt-[1px]" />}
            <span>
              <span className="font-black">{tResult.ok ? 'OK' : 'Failed'}</span>
              {' · '}{tResult.modelLabel}
              {tResult.ms > 0 && <> · {tResult.ms} ms</>}
              {' · '}<span className="opacity-90">{tResult.text}</span>
            </span>
          </div>
          {tResult.imageDataUrl && (
            <img
              src={tResult.imageDataUrl}
              alt="generated"
              className="mt-1.5 rounded-[var(--rm)] max-w-full max-h-[280px] object-contain border border-[var(--glass-border)]"
            />
          )}
          {tResult.audioUrl && (
            <audio
              controls
              src={tResult.audioUrl}
              className="mt-1.5 w-full"
            />
          )}
        </div>
      )}

      {modality !== 'chat' && catalogModels.length > 0 && (
        <div className="mt-2 grid gap-1">
          {catalogModels.map(m => {
            const v = verdicts.get(m.id);
            const fits = !v || (v.ramOk && v.diskOk && v.speedOk);
            const installed = installedFiles.has(m.ggufFile.toLowerCase());
            const downloading = dlBusy.has(m.id);
            const rowStats: CatalogDlStats = dlStatsMap[m.id] || { pct: 0, bytesPerSec: 0, etaSec: 0 };
            const sizeGb = (m.sizeBytes / 1024 / 1024 / 1024).toFixed(1);
            return (
              <div
                key={m.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--rm)] bg-[var(--glass-bg-strong)] border border-[var(--glass-border)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-black text-[var(--text)] truncate">{m.displayName}</div>
                  <div className="text-[10px] text-[var(--text-dim)]">
                    {sizeGb} GB
                    {!fits && <span className="text-[var(--red)]"> · too heavy</span>}
                    {installed && <span className="text-[#3bd16f]"> · installed</span>}
                  </div>
                  {downloading && (
                    <div className="mt-1">
                      <div className="h-1 rounded-full bg-[var(--glass-bg)] overflow-hidden">
                        <div
                          className="h-full bg-[var(--accent)] transition-[width] duration-200"
                          style={{ width: `${rowStats.pct}%` }}
                        />
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[10px] text-[var(--text-dim)]">
                        <span className="font-black text-[var(--accent)]">{rowStats.pct}%</span>
                        <span>{formatBytesPerSec(rowStats.bytesPerSec)} · ETA {formatEta(rowStats.etaSec)}</span>
                      </div>
                    </div>
                  )}
                </div>
                {downloading ? (
                  <button
                    disabled
                    title={`Downloading ${rowStats.pct}%`}
                    className="px-2 py-1 rounded-[var(--rm)] border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] flex items-center"
                  >
                    <Loader2 size={11} strokeWidth={2.4} className="animate-spin" />
                  </button>
                ) : installed ? (
                  <button
                    onClick={() => onDeleteCatalog(m.id)}
                    disabled={disabled}
                    title={`Delete ${m.displayName} from disk`}
                    className="px-2 py-1 rounded-[var(--rm)] border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--text-dim)] hover:border-[var(--red)] hover:text-[var(--red)] disabled:opacity-40"
                  >
                    <Trash2 size={11} strokeWidth={2.4} />
                  </button>
                ) : (
                  <button
                    onClick={() => onDownloadCatalog(m.id)}
                    disabled={disabled || dlBusy.has(m.id)}
                    title={`Download ${m.displayName}`}
                    className="px-2 py-1 rounded-[var(--rm)] border border-[var(--accent)] bg-[var(--glass-bg)] text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-40"
                  >
                    <Download size={11} strokeWidth={2.4} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {note && (
        <div className="mt-2 text-[10px] text-[var(--text-dim)] leading-snug">
          {note}
        </div>
      )}
    </div>
  );
}

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentAnimal } from '../animals/animal-service';
import { getActivePersonaId } from '../personas/persona-service';
import { activateLocalRuntime, getLocalBusy } from '../llama/local-runtime';
import { CATALOG } from '../models/catalog';

const SIDECAR_BASE = (import.meta as any).env?.VITE_SIDECAR_URL || 'http://localhost:3471';

interface LlamaInfo {
  baseUrl: string;
  bearerToken: string;
  port: number;
  modelPath: string;
}

function remap(ev: any): any {
  const type = ev.event;
  const out: any = { ...ev, type };
  delete out.event;
  if (type === 'tool_done' && ev.output != null && out.result == null) out.result = ev.output;
  if (type === 'error' && ev.data != null && out.message == null) out.message = ev.data;
  // 'done' keeps ev.data (the full text from sidecar)
  if (type === 'model_route' && ev.data != null && out.message == null) out.message = ev.data;
  return out;
}

export async function* agentStream(opts: {
  messages: Array<{ role: string; content: string | null }>;
  modelId?: string;
  imageModelId?: string;
  imageSize?: string;
  musicModelId?: string;
  videoModelId?: string;
  preferredFamily?: string;
  budgetMode?: 'eco' | 'balanced' | 'power';
  allowFamilyFallback?: boolean;
  sessionId?: string;
  extraSystemInstructions?: string;
  toolMode?: 'full' | 'chat_only' | 'chat_search';
  contextFolder?: string;
  providerMode?: 'local' | 'friend';
  providerUserId?: string;
  signal?: AbortSignal;
}): AsyncGenerator<any, void, unknown> {
  const msgs = [...opts.messages];
  const lastUserIdx = (() => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') return i;
    return -1;
  })();
  const lastUser = lastUserIdx >= 0 ? (msgs[lastUserIdx].content || '') : '';
  const history = lastUserIdx >= 0 ? msgs.slice(0, lastUserIdx) : msgs;

  const body: Record<string, unknown> = {
    message: lastUser,
    history,
    model_id: opts.modelId,
    image_model_id: opts.imageModelId,
    image_size: opts.imageSize,
    music_model_id: opts.musicModelId,
    video_model_id: opts.videoModelId,
    session_id: opts.sessionId || 'global',
    // Pro persona (if selected) replaces the animal id sent to backend.
    // monkey/personas.is_pro() picks it up and applies pack restriction + role overlay.
    animal_id: getActivePersonaId() || getCurrentAnimal().id,
  };
  if (typeof opts.extraSystemInstructions === 'string' && opts.extraSystemInstructions.trim()) {
    body.extra_system_instructions = opts.extraSystemInstructions;
  }
  if (opts.toolMode === 'chat_only' || opts.toolMode === 'chat_search' || opts.toolMode === 'full') {
    body.tool_mode = opts.toolMode;
  }
  if (typeof opts.contextFolder === 'string' && opts.contextFolder.trim()) {
    body.context_folder = opts.contextFolder.trim();
  }
  if (opts.providerMode === 'local' || opts.providerMode === 'friend') {
    body.provider_mode = opts.providerMode;
  }
  if (typeof opts.providerUserId === 'string' && opts.providerUserId.trim()) {
    body.provider_user_id = opts.providerUserId.trim();
  }
  // Bundled llama-server preferred over Ollama when active. Sidecar uses it for
  // mode='local' and as the default local backend when no provider_mode is set.
  let llama: LlamaInfo | null = null;
  try {
    llama = await invoke<LlamaInfo | null>('llama_runtime_info');
  } catch {}
  const catalogEntry = opts.modelId ? CATALOG.find(m => m.id === opts.modelId) : undefined;
  const isOllamaBacked = catalogEntry?.backend === 'ollama';
  // Auto-activate the local runtime when the user is in local mode but no
  // backend is ready yet. Llama-server-backed catalog entries kick off the
  // GGUF download + boot; Ollama-backed entries trigger an Ollama pull and
  // stop any stray llama-server bound to a different model. The shared
  // spinner lights up TopBar + ProviderHostingPanel during the download.
  if (
    opts.providerMode === 'local'
    && !getLocalBusy()
    && typeof opts.modelId === 'string'
    && CATALOG.some(m => m.id === opts.modelId)
    && (isOllamaBacked || !llama || !llama.baseUrl)
  ) {
    yield { type: 'model_route', message: 'starting local runtime…' };
    try {
      await activateLocalRuntime({ preferModelId: opts.modelId });
      llama = await invoke<LlamaInfo | null>('llama_runtime_info').catch(() => null);
    } catch (e: any) {
      yield { type: 'error', message: `local runtime start failed: ${e?.message || e}` };
      return;
    }
  }
  // Ollama-backed models route via OLLAMA_BASE_URL inside llm.py's _chat_ollama
  // path. Don't expose llama_base_url for them — would force a wasted
  // _chat_bundled attempt before the empty-output fallback kicks in.
  if (!isOllamaBacked && llama && llama.baseUrl) {
    body.llama_base_url = llama.baseUrl;
    if (llama.bearerToken) body.llama_bearer_token = llama.bearerToken;
  }

  let res: Response;
  try {
    res = await tauriFetch(`${SIDECAR_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: opts.signal,
      connectTimeout: 30_000,
    } as any);
  } catch (e: any) {
    yield { type: 'error', message: `sidecar fetch failed: ${e?.message || e}` };
    return;
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    yield { type: 'error', message: `sidecar HTTP ${res.status}: ${txt.slice(0, 300)}` };
    return;
  }

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      if (opts.signal?.aborted) { yield { type: 'aborted' }; return; }
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          try {
            const ev = JSON.parse(payload);
            yield remap(ev);
          } catch {}
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

/**
 * Clean single-turn completion for the 8-bit maker's sprite/map AI.
 *
 * Deliberately bypasses agentStream / the agent SYSTEM_PROMPT / tools: those
 * corrupt structured output (the intent router fires generate_image on "draw…"
 * prompts and the prose-oriented system prompt fights the grid/DSL format).
 * Hits the sidecar's /game/maker/complete with ONLY a terse author spec + the
 * user prompt, returns the raw model text. Caller owns all parsing/validation.
 * Same local-backend resolution as agentStream (bundled llama-server vs Ollama).
 */
export async function makerComplete(opts: {
  system: string;
  prompt: string;
  modelId?: string;
  temperature?: number;
  providerMode?: 'local' | 'friend';
  providerUserId?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const body: Record<string, unknown> = {
    system: opts.system,
    prompt: opts.prompt,
    model_id: opts.modelId,
  };
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature;
  if (opts.providerMode === 'local' || opts.providerMode === 'friend') {
    body.provider_mode = opts.providerMode;
  }
  if (typeof opts.providerUserId === 'string' && opts.providerUserId.trim()) {
    body.provider_user_id = opts.providerUserId.trim();
  }

  let llama: LlamaInfo | null = null;
  try {
    llama = await invoke<LlamaInfo | null>('llama_runtime_info');
  } catch {}
  const catalogEntry = opts.modelId ? CATALOG.find(m => m.id === opts.modelId) : undefined;
  const isOllamaBacked = catalogEntry?.backend === 'ollama';
  if (
    opts.providerMode === 'local'
    && !getLocalBusy()
    && typeof opts.modelId === 'string'
    && CATALOG.some(m => m.id === opts.modelId)
    && (isOllamaBacked || !llama || !llama.baseUrl)
  ) {
    try {
      await activateLocalRuntime({ preferModelId: opts.modelId });
      llama = await invoke<LlamaInfo | null>('llama_runtime_info').catch(() => null);
    } catch (e: any) {
      throw new Error(`local runtime start failed: ${e?.message || e}`);
    }
  }
  if (!isOllamaBacked && llama && llama.baseUrl) {
    body.llama_base_url = llama.baseUrl;
    if (llama.bearerToken) body.llama_bearer_token = llama.bearerToken;
  }

  let res: Response;
  try {
    res = await tauriFetch(`${SIDECAR_BASE}/game/maker/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
      connectTimeout: 30_000,
    } as any);
  } catch (e: any) {
    throw new Error(`sidecar fetch failed: ${e?.message || e}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`sidecar HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({} as any));
  return (data?.text || '') as string;
}

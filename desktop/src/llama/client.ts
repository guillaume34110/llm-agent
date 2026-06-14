// OpenAI-compatible client for the bundled llama-server sidecar.
//
// Every call resolves the live runtime info via Tauri (loopback URL +
// per-boot bearer token), then talks to llama-server over HTTP. The
// renderer never knows the port or token at module load — they only exist
// after `llama_runtime_start` succeeded.

import { invoke } from '@tauri-apps/api/core';

export interface RuntimeInfo {
  baseUrl: string;
  bearerToken: string;
  port: number;
  modelPath: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  tools?: any[];
  tool_choice?: any;
}

export interface ChatResponse {
  text: string;
  tool_calls?: any[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export class LlamaNotRunningError extends Error {
  constructor() {
    super('Local llama-server is not running. Activate a model in Settings → Local LLM.');
    this.name = 'LlamaNotRunningError';
  }
}

async function info(): Promise<RuntimeInfo> {
  const r = await invoke<RuntimeInfo | null>('llama_runtime_info');
  if (!r) throw new LlamaNotRunningError();
  return r;
}

function authHeaders(rt: RuntimeInfo): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${rt.bearerToken}`,
  };
}

export async function isRunning(): Promise<boolean> {
  try {
    const r = await invoke<RuntimeInfo | null>('llama_runtime_info');
    return !!r;
  } catch {
    return false;
  }
}

// llama-server returns 503 {"error":{"code":503,"message":"Loading model"}}
// until weights are mmap'd and the first KV cache is allocated. Spawn-time
// readiness ≠ HTTP readiness, so we poll /health (cheap, returns
// {"status":"ok"} when serving) before letting callers issue real requests.
export async function waitForReady(
  baseUrl: string,
  bearerToken: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  const headers: Record<string, string> = bearerToken
    ? { Authorization: `Bearer ${bearerToken}` }
    : {};
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { headers });
      if (res.ok) return;
    } catch {
      // network blip while child binds — keep polling.
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`llama-server not ready within ${Math.round(timeoutMs / 1000)}s`);
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const rt = await info();
  const res = await fetch(`${rt.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(rt),
    body: JSON.stringify({ ...req, stream: false }),
  });
  if (!res.ok) {
    throw new Error(`llama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  const choice = body.choices?.[0] ?? {};
  return {
    text: choice.message?.content ?? '',
    tool_calls: choice.message?.tool_calls,
    usage: body.usage,
  };
}

export async function embed(text: string, model?: string): Promise<number[]> {
  const rt = await info();
  const res = await fetch(`${rt.baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: authHeaders(rt),
    body: JSON.stringify({ input: text, model: model || 'embedding' }),
  });
  if (!res.ok) {
    throw new Error(`llama embed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  return body.data?.[0]?.embedding ?? [];
}

export async function listLoaded(): Promise<string[]> {
  const rt = await info();
  const res = await fetch(`${rt.baseUrl}/v1/models`, { headers: authHeaders(rt) });
  if (!res.ok) return [];
  const body = await res.json();
  return (body.data || []).map((m: any) => m.id).filter(Boolean);
}

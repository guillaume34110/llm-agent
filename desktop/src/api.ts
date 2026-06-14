import type { ModelInfo, Session, ProfileResponse, StatusResponse, ChatResponse } from './types';
import { agentStream } from './agent/agent';
import { invoke } from '@tauri-apps/api/core';
import type { TaskInput, TaskItem } from './types';
import { createTask, deleteTask, listTasks, updateTask } from './tasks/task-client';
import { enqueueRemoteApproval } from './approvals/approval-service';
import { setConnectorCredentials } from './openai/connector-client';
import { CATALOG } from './models/catalog';
import type { EnemyPlan, RtsWorldView } from './game/rts/types';
import type { PokerView } from './game/poker/engine';
import type { ScrabbleView } from './game/scrabble/engine';

const baseUrl = import.meta.env.VITE_SIDECAR_URL || 'http://localhost:3471';
const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

async function pushJwtToOpenAiConnector(jwt: string): Promise<void> {
  try {
    await setConnectorCredentials({ jwt });
  } catch {
    // connector not running — nothing to push to
  }
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${baseUrl}/models`);
  return res.json();
}

export async function getSessions(): Promise<Session[]> {
  const res = await fetch(`${baseUrl}/memory/sessions`);
  return res.json();
}

export async function saveSession(session: Session): Promise<void> {
  await fetch(`${baseUrl}/memory/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.detail || j.message || j.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// POST a minigame request to the sidecar, injecting the local-llama runtime pointer
// (base url + bearer) for non-Ollama-backed models exactly like chessMove/pokerMove do.
// Keeps the per-game methods to a single line each.
async function gamePost<T>(
  path: string,
  payload: Record<string, unknown>,
  opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string },
): Promise<T> {
  const body: Record<string, unknown> = {
    ...payload,
    model_id: opts.modelId,
    provider_mode: opts.providerMode,
    provider_user_id: opts.providerUserId,
  };
  let llama: { baseUrl?: string; bearerToken?: string } | null = null;
  try { llama = await invoke('llama_runtime_info'); } catch {}
  const catalogEntry = opts.modelId ? CATALOG.find(m => m.id === opts.modelId) : undefined;
  const isOllamaBacked = catalogEntry?.backend === 'ollama';
  if (!isOllamaBacked && llama && llama.baseUrl) {
    body.llama_base_url = llama.baseUrl;
    if (llama.bearerToken) body.llama_bearer_token = llama.bearerToken;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

export const api = {
  status(): Promise<StatusResponse> {
    return request<StatusResponse>('/status');
  },

  async login(email: string, password: string): Promise<void> {
    await request<void>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const res = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, rememberMe: true }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.message || j.error || msg; } catch {}
      throw new Error(`Backend login: ${msg}`);
    }
    const data = await res.json().catch(() => ({} as any));
    if (data?.token) {
      localStorage.setItem('jwt', data.token);
      void pushJwtToOpenAiConnector(data.token);
    }
  },

  async register(email: string, password: string): Promise<void> {
    const res = await fetch(`${backendUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.message || j.error || msg; } catch {}
      throw new Error(`Backend register: ${msg}`);
    }
    // Account created — establish the local sidecar + backend session via the
    // normal login flow so the JWT is stored and the OpenAI connector primed.
    await api.login(email, password);
  },

  async signOut(): Promise<void> {
    localStorage.removeItem('jwt');
    void pushJwtToOpenAiConnector('');
    await request<void>('/logout', { method: 'POST' }).catch(() => {});
    await fetch(`${backendUrl}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  },

  // Returns combined profile from auth/status + memory/profile
  getProfile(): Promise<ProfileResponse> {
    return Promise.all([
      request<{ logged_in: boolean; email?: string }>('/auth/status'),
      request<{ facts: Record<string, string> }>('/memory/profile').catch(() => ({ facts: {} })),
    ]).then(([status, mem]) => {
      if (!status.logged_in) throw new Error('Not logged in');
      return { email: status.email || '', facts: mem.facts || {} };
    });
  },

  getModels(): Promise<ModelInfo[]> {
    return fetchModels();
  },

  // Spec A removed the demand signal (no matchmaking jobs anymore — friend-graph P2P
  // is presence-only). Returns [] so existing panels render empty instead of erroring.
  async getMatchmakingDemand(): Promise<Array<{ modelId: string; demand24h: number; supplyOnline: number; queueDepth: number; ratio: number }>> {
    return [];
  },

  getImageModels(): Promise<Array<{ id: string; name: string; default: boolean }>> {
    return request<Array<{ id: string; name: string; default: boolean }>>('/image-models');
  },

  getMusicModels(): Promise<Array<{ id: string; name: string; default: boolean }>> {
    return request<Array<{ id: string; name: string; default: boolean }>>('/music-models');
  },

  getVideoModels(): Promise<Array<{ id: string; name: string; default: boolean }>> {
    return request<Array<{ id: string; name: string; default: boolean }>>('/video-models');
  },

  getSessions(): Promise<Session[]> {
    return getSessions();
  },

  getTasks(): Promise<TaskItem[]> {
    return listTasks();
  },

  createTask(payload: TaskInput): Promise<TaskItem> {
    return createTask(payload);
  },

  updateTask(taskId: string, patch: Partial<TaskInput>): Promise<TaskItem> {
    return updateTask(taskId, patch);
  },

  deleteTask(taskId: string): Promise<void> {
    return deleteTask(taskId);
  },

  getWorkspace(): Promise<{ path: string }> {
    return request<{ path: string }>('/workspace');
  },

  setWorkspace(path: string): Promise<{ path: string }> {
    return request<{ path: string }>('/workspace', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  chat(
    message: string,
    history: Array<{ role: string; content: string }>,
    modelId?: string,
  ): Promise<ChatResponse> {
    return request<ChatResponse>('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history, model_id: modelId }),
    });
  },

  chatStream(
    message: string,
    history: Array<{ role: string; content: string }>,
    modelId: string | undefined,
    _imageModelId: string | undefined,
    _imageSize: string | undefined,
    _musicModelId: string | undefined,
    _videoModelId: string | undefined,
    routing: {
      preferredFamily?: string;
      budgetMode?: 'eco' | 'balanced' | 'power';
      allowFamilyFallback?: boolean;
      sessionId?: string;
      providerMode?: 'local' | 'friend';
      providerUserId?: string;
    },
    onEvent: (e: {
      event: string;
      name?: string;
      args?: any;
      output?: string;
      data?: string;
      steps?: string[];
      current?: number;
      status?: any;
      issues?: string[];
      stepId?: string;
      statuses?: string[];
      results?: any[];
      label?: string;
      skipReason?: string;
      screenshots?: string[];
      incomplete?: boolean;
      ok?: boolean;
      family?: string;
      modelId?: string;
      reason?: string;
      id?: string;
      tool?: string;
      title?: string;
      summary?: string;
      bypass?: boolean;
      promptTokens?: number;
      completionTokens?: number;
      elapsedMs?: number;
      phase?: string;
      contextTokens?: number;
      iter?: number;
      maxIters?: number;
      numTools?: number;
      game?: string;
    }) => void,
  ): () => void {
    // Local agent loop (Phase E): drive desktop/src/agent/agentStream and
    // bridge new {type} events into legacy {event} shape so screens stay untouched.
    void invoke('llama_runtime_touch_activity').catch(() => {});
    const ctrl = new AbortController();
    let aborted = false;
    let assistantBuf = '';

    (async () => {
      try {
        const fullMessages = [
          ...history.map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: message },
        ];
        for await (const evt of agentStream({
          messages: fullMessages,
          modelId,
          preferredFamily: routing.preferredFamily,
          budgetMode: routing.budgetMode,
          allowFamilyFallback: routing.allowFamilyFallback,
          sessionId: routing.sessionId,
          providerMode: routing.providerMode,
          providerUserId: routing.providerUserId,
          signal: ctrl.signal,
        })) {
          if (aborted) break;
          switch (evt.type) {
            case 'token':
              assistantBuf += evt.content || '';
              break;
            case 'plan':
              onEvent({ event: 'plan', steps: evt.steps, current: evt.current });
              break;
            case 'plan_update':
              onEvent({ event: 'plan_update', current: evt.current, statuses: evt.statuses, stepId: evt.stepId, status: evt.status, skipReason: evt.skipReason });
              break;
            case 'step_audit':
              onEvent({ event: 'step_audit', stepId: evt.stepId, status: evt.status, label: evt.label, results: evt.results });
              break;
            case 'audit':
              onEvent({ event: 'audit', status: evt.status, ok: evt.ok, issues: evt.issues });
              break;
            case 'polishing':
              onEvent({ event: 'polishing' });
              break;
            case 'model_route':
              onEvent({ event: 'model_route', family: evt.family, modelId: evt.modelId, reason: evt.reason, data: evt.message });
              break;
            case 'approval_request':
              enqueueRemoteApproval({
                id: evt.id,
                sessionId: routing.sessionId || 'global',
                toolName: evt.tool || evt.name,
                title: evt.title,
                summary: evt.summary,
                args: evt.args,
                bypass: !!evt.bypass,
              }).catch(() => {});
              break;
            case 'thinking':
              onEvent({
                event: 'thinking',
                phase: evt.phase || undefined,
                elapsedMs: Number(evt.elapsed_ms || 0),
                modelId: evt.model_id || undefined,
                contextTokens: Number(evt.context_tokens || 0),
                iter: Number(evt.iter || 0),
                maxIters: Number(evt.max_iters || 0),
                numTools: Number(evt.num_tools || 0),
              });
              break;
            case 'intent':
              onEvent({ event: 'intent', data: evt.data });
              break;
            case 'usage':
              onEvent({
                event: 'usage',
                promptTokens: Number(evt.prompt_tokens || 0),
                completionTokens: Number(evt.completion_tokens || 0),
                elapsedMs: Number(evt.elapsed_ms || 0),
                modelId: evt.model_id || undefined,
              });
              break;
            case 'tool_start':
              onEvent({ event: 'tool_start', name: evt.name, args: evt.args });
              break;
            case 'tool_done':
              onEvent({ event: 'tool_done', name: evt.name, args: evt.args, output: evt.result });
              break;
            case 'game_launch':
              onEvent({ event: 'game_launch', game: evt.game });
              break;
            case 'done':
              onEvent({ event: 'done', data: (typeof evt.data === 'string' && evt.data) || assistantBuf, screenshots: evt.screenshots, incomplete: evt.incomplete });
              return;
            case 'error':
              onEvent({ event: 'error', data: evt.message || 'agent error' });
              return;
            case 'aborted':
              return;
          }
        }
      } catch (e: any) {
        if (aborted || e?.name === 'AbortError') return;
        onEvent({ event: 'error', data: e?.message || String(e) });
      }
    })();

    return () => { aborted = true; ctrl.abort(); };
  },

  // Ask the local model for Black's move. The client owns chess legality
  // (chess.js) and sends the exact legal SAN list; the sidecar picks from it and
  // falls back to a random legal move on an illegal/garbled reply. Mirrors the
  // local-runtime resolution agentStream uses so the same backend serves moves.
  async chessMove(
    fen: string,
    legalMoves: string[],
    sanHistory: string[],
    opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string } = {},
  ): Promise<{ move: string; fallback: boolean; reason?: string }> {
    const body: Record<string, unknown> = {
      fen,
      legal_moves: legalMoves,
      history: sanHistory,
      model_id: opts.modelId,
      provider_mode: opts.providerMode,
      provider_user_id: opts.providerUserId,
    };
    let llama: { baseUrl?: string; bearerToken?: string } | null = null;
    try { llama = await invoke('llama_runtime_info'); } catch {}
    const catalogEntry = opts.modelId ? CATALOG.find(m => m.id === opts.modelId) : undefined;
    const isOllamaBacked = catalogEntry?.backend === 'ollama';
    if (!isOllamaBacked && llama && llama.baseUrl) {
      body.llama_base_url = llama.baseUrl;
      if (llama.bearerToken) body.llama_bearer_token = llama.bearerToken;
    }
    const res = await fetch(`${baseUrl}/game/chess/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`chess move HTTP ${res.status}`);
    return res.json();
  },

  // Ask the local model for the opponent's poker action. The client owns ALL chip
  // math (deck, pot, stacks, betting legality, hand ranking, win/loss) and sends
  // the exact legal action tokens; the sidecar picks ONE and the client re-validates
  // it, falling back to a passive legal action on a garbled reply. Mirrors chessMove:
  // a fog-limited view (cpu hole cards + board + pot, never the human's cards) goes
  // out, no human hole cards, consistent with the local-first matchmaking invariant.
  async pokerMove(
    view: PokerView,
    legalActions: string[],
    opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string } = {},
  ): Promise<{ action: string; fallback: boolean; reason?: string; taunt?: string }> {
    const body: Record<string, unknown> = {
      view,
      legal_actions: legalActions,
      model_id: opts.modelId,
      provider_mode: opts.providerMode,
      provider_user_id: opts.providerUserId,
    };
    let llama: { baseUrl?: string; bearerToken?: string } | null = null;
    try { llama = await invoke('llama_runtime_info'); } catch {}
    const catalogEntry = opts.modelId ? CATALOG.find(m => m.id === opts.modelId) : undefined;
    const isOllamaBacked = catalogEntry?.backend === 'ollama';
    if (!isOllamaBacked && llama && llama.baseUrl) {
      body.llama_base_url = llama.baseUrl;
      if (llama.bearerToken) body.llama_bearer_token = llama.bearerToken;
    }
    const res = await fetch(`${baseUrl}/game/poker/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`poker move HTTP ${res.status}`);
    return res.json();
  },

  // Ask the local model for the opponent's Scrabble play. The client owns ALL
  // numbers (bag, board, racks, geometry, premiums, scoring) and re-validates the
  // proposal authoritatively; the model only proposes {word,row,col,dir} from its
  // own rack. A garbled/illegal reply → the client falls back to exchange/pass.
  // Fog-limited view (cpu rack + board only, never the human's rack or the bag).
  async scrabbleMove(
    view: ScrabbleView,
    opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string } = {},
  ): Promise<{ word?: string; row?: number; col?: number; dir?: 'H' | 'V'; pass?: boolean; fallback: boolean; reason?: string }> {
    return gamePost('/game/scrabble/move', { view }, opts);
  },

  // The lexicon oracle: is every word a valid word in the given language? The client
  // owns geometry + scoring; this is the ONLY thing delegated to the model (its core
  // competence), the same way the RPG delegates narrative. Used for BOTH the human's
  // committed play and the opponent's proposed play, so neither side can cheat with a
  // fake word. A failed/garbled judge call returns {valid:false} (fail-closed).
  async scrabbleValidate(
    words: string[],
    lang: string,
    opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string } = {},
  ): Promise<{ valid: boolean; reason?: string }> {
    return gamePost('/game/scrabble/validate', { words, lang }, opts);
  },

  // RTS (Iron Marsh) enemy commander. The client owns ALL numbers (economy, power,
  // tech, combat, win/loss); this only asks the model for a small strategic intent
  // plan, constrained to the whitelist we send. Best-effort: a missing/garbled reply
  // comes back as a fallback plan, and the client re-validates authoritatively before
  // applying it. World view is fog-limited; nothing is persisted server-side.
  async rtsEnemyPlan(
    world: RtsWorldView,
    vocab: { stances: string[]; roles: string[]; targets: string[] },
    opts: {
      personality?: string;
      modelId?: string;
      providerMode?: 'local' | 'friend';
      providerUserId?: string;
      lang?: string;
    } = {},
  ): Promise<EnemyPlanResult> {
    const body: Record<string, unknown> = {
      world,
      stances: vocab.stances,
      roles: vocab.roles,
      targets: vocab.targets,
      personality: opts.personality,
      lang: opts.lang,
      model_id: opts.modelId,
      provider_mode: opts.providerMode,
      provider_user_id: opts.providerUserId,
    };
    let llama: { baseUrl?: string; bearerToken?: string } | null = null;
    try { llama = await invoke('llama_runtime_info'); } catch {}
    const catalogEntry = opts.modelId ? CATALOG.find(m => m.id === opts.modelId) : undefined;
    const isOllamaBacked = catalogEntry?.backend === 'ollama';
    if (!isOllamaBacked && llama && llama.baseUrl) {
      body.llama_base_url = llama.baseUrl;
      if (llama.bearerToken) body.llama_bearer_token = llama.bearerToken;
    }
    const res = await fetch(`${baseUrl}/game/rts/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`rts command HTTP ${res.status}`);
    return res.json();
  },

  // RPG (Monkey Quest). The client owns ALL mechanics (HP, dice, XP, graph,
  // combat); these calls only fetch LLM-authored narrative content. Each one is
  // best-effort — the sidecar returns a deterministic fallback when the model is
  // missing or garbles its reply, so the game never blocks on the LLM.
  async rpgSetup(
    theme: string,
    opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string } = {},
  ): Promise<RpgSetupResult> {
    return rpgPost<RpgSetupResult>('/game/rpg/setup', { theme }, opts);
  },

  async rpgScene(
    context: string,
    allowedTags: string[],
    theme: string | undefined,
    opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string } = {},
  ): Promise<RpgSceneResult> {
    return rpgPost<RpgSceneResult>('/game/rpg/scene', { context, allowed_tags: allowedTags, theme }, opts);
  },

  async rpgResolve(
    context: string,
    outcome: string,
    theme: string | undefined,
    opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string } = {},
  ): Promise<{ narration: string; fallback: boolean }> {
    return rpgPost('/game/rpg/resolve', { context, outcome, theme }, opts);
  },

  // Free-text conversation with an NPC. The model voices the NPC and may pick one
  // effect token from allowedEffects; the client applies all mechanics itself.
  async rpgDialogue(
    args: {
      context: string;
      npcName: string;
      npcRole: string;
      history: Array<{ who: string; text: string }>;
      playerMessage: string;
      allowedEffects: string[];
      theme?: string;
    },
    opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string } = {},
  ): Promise<RpgDialogueResult> {
    return rpgPost<RpgDialogueResult>('/game/rpg/dialogue', {
      context: args.context,
      npc_name: args.npcName,
      npc_role: args.npcRole,
      history: args.history,
      player_message: args.playerMessage,
      allowed_effects: args.allowedEffects,
      theme: args.theme,
    }, opts);
  },
};

// Shared POST helper for the RPG endpoints: injects the local llama runtime
// pointer the same way chessMove does (skip it for Ollama-backed models).
async function rpgPost<T>(
  path: string,
  payload: Record<string, unknown>,
  opts: { modelId?: string; providerMode?: 'local' | 'friend'; providerUserId?: string; lang?: string },
): Promise<T> {
  const body: Record<string, unknown> = {
    ...payload,
    model_id: opts.modelId,
    provider_mode: opts.providerMode,
    provider_user_id: opts.providerUserId,
    lang: opts.lang,
  };
  let llama: { baseUrl?: string; bearerToken?: string } | null = null;
  try { llama = await invoke('llama_runtime_info'); } catch {}
  const catalogEntry = opts.modelId ? CATALOG.find(m => m.id === opts.modelId) : undefined;
  const isOllamaBacked = catalogEntry?.backend === 'ollama';
  if (!isOllamaBacked && llama && llama.baseUrl) {
    body.llama_base_url = llama.baseUrl;
    if (llama.bearerToken) body.llama_bearer_token = llama.bearerToken;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`rpg ${path} HTTP ${res.status}`);
  return res.json();
}

export interface RpgSetupLocation { name: string; kind: string; blurb: string; }
export interface RpgSetupHero { className: string; blurb: string; }
// An LLM-themed explorer club: a world-flavoured name (+ blurb) bound to one of the
// three fixed archetypes. The archetype is a closed whitelist (the mechanics live
// client-side keyed by it); only the prose is themed. Optional — absent worlds fall
// back to the house defaults.
export interface RpgSetupSponsor { archetype: 'pathfinders' | 'armorers' | 'mystics'; name: string; blurb?: string; }
export interface RpgSetupResult {
  title: string;
  intro: string;
  locations: RpgSetupLocation[];
  heroes: RpgSetupHero[];
  quest: { title: string; desc: string };
  sponsors?: RpgSetupSponsor[];
  fallback: boolean;
  reason?: string;
}
export interface RpgSceneResult {
  narration: string;
  choices: Array<{ label: string; tag: string }>;
  fallback: boolean;
  reason?: string;
}
export interface RpgDialogueResult {
  reply: string;
  effect: 'none' | 'reveal' | 'rumor' | 'heal' | 'recruit' | 'warn';
  end: boolean;
  fallback: boolean;
  reason?: string;
}

// RTS enemy commander reply: a whitelist-filtered EnemyPlan. The client still
// re-validates it through enemy.resolvePlan before applying (authoritative).
export interface EnemyPlanResult {
  plan: EnemyPlan;
  fallback: boolean;
  reason?: string;
}

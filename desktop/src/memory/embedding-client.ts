import { getKbSetting } from './kb-setting';
import type { EmbeddingModel } from './embedding-catalog';
import { ensureEmbedModel } from '../llama/embed-runtime';

const BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3469').replace(/\/$/, '');
const SIDECAR_BASE = ((import.meta as any).env?.VITE_SIDECAR_URL || 'http://localhost:3471').replace(/\/$/, '');
const BATCH_SIZE = 20;

async function postEmbedRemote(input: string[], model: string, dim: number): Promise<number[][]> {
  const token = localStorage.getItem('jwt') || '';
  const res = await fetch(`${BASE}/api/llm/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input, model, dimensions: dim }),
  });
  if (!res.ok) throw new Error(`embed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return (j.vectors as number[][]) ?? [];
}

async function postEmbedLocal(input: string[], localId: string): Promise<number[][]> {
  const res = await fetch(`${SIDECAR_BASE}/local-models/${encodeURIComponent(localId)}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: input }),
  });
  if (!res.ok) throw new Error(`local embed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  return (j.vectors as number[][]) ?? [];
}

async function postEmbedLlama(input: string[], preferModelId: string): Promise<number[][]> {
  const { info } = await ensureEmbedModel({ preferModelId });
  const res = await fetch(`${info.baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${info.bearerToken}`,
    },
    body: JSON.stringify({ input, model: preferModelId }),
  });
  if (!res.ok) throw new Error(`llama embed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  // OpenAI-compatible shape: { data: [{embedding: [...]}, ...] }
  return (j.data as Array<{ embedding: number[] }> ?? []).map(d => d.embedding);
}

async function postEmbed(input: string[], model: EmbeddingModel): Promise<number[][]> {
  if (model.provider === 'llama' && model.localId) {
    return postEmbedLlama(input, model.localId);
  }
  if (model.provider === 'local' && model.localId) {
    return postEmbedLocal(input, model.localId);
  }
  return postEmbedRemote(input, model.id, model.dim);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const { model } = await getKbSetting();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const vecs = await postEmbed(batch, model);
      out.push(...vecs);
    } catch (e) {
      console.error('embed failed:', e);
      out.push(...batch.map(() => [] as number[]));
    }
  }
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const r = await embedTexts([text]);
  return r[0] ?? [];
}

// Sync snapshot for callers that already awaited getKbSetting recently.
// Async version below is the source of truth.
export async function getEmbedModelInfo(): Promise<{ model: string; dim: number }> {
  const { model } = await getKbSetting();
  return { model: model.id, dim: model.dim };
}

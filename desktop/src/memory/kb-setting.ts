import { dbQuery, dbExecute } from '../db';
import {
  DEFAULT_EMBEDDING_MODEL_ID,
  EMBEDDING_MODELS,
  getEmbeddingModel,
  type EmbeddingModel,
} from './embedding-catalog';

const KEY_MODEL = 'embedding_model';
const KEY_DIM = 'embedding_dim';

export interface KbSetting {
  model: EmbeddingModel;
  isConfigured: boolean;
}

let cache: KbSetting | null = null;

async function readSetting(key: string): Promise<string | null> {
  try {
    const rows = await dbQuery<any[]>(`SELECT value FROM kb_setting WHERE key = ?`, [key]);
    return rows[0]?.[0] ?? null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await dbExecute(
    `INSERT INTO kb_setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, Date.now()],
  );
}

export async function getKbSetting(): Promise<KbSetting> {
  if (cache) return cache;
  const stored = await readSetting(KEY_MODEL);
  if (!stored) {
    const fallback = getEmbeddingModel(DEFAULT_EMBEDDING_MODEL_ID)!;
    cache = { model: fallback, isConfigured: false };
    return cache;
  }
  const model = getEmbeddingModel(stored) ?? getEmbeddingModel(DEFAULT_EMBEDDING_MODEL_ID)!;
  cache = { model, isConfigured: true };
  return cache;
}

export async function setKbModel(modelId: string): Promise<EmbeddingModel> {
  const model = getEmbeddingModel(modelId);
  if (!model) throw new Error(`Unknown embedding model: ${modelId}`);
  await writeSetting(KEY_MODEL, model.id);
  await writeSetting(KEY_DIM, String(model.dim));
  cache = { model, isConfigured: true };
  return model;
}

export function invalidateKbSettingCache(): void {
  cache = null;
}

export { EMBEDDING_MODELS };

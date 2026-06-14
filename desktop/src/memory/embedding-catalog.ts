// Curated catalog of embedding models exposed in the KB settings.
// Local-first: served by Ollama or a user custom endpoint. MTEB ~ global score
// (best public bench at time of writing). `multilang` is a qualitative 1-5
// rating focused on FR/EN parity.

export interface EmbeddingModel {
  id: string;
  label: string;
  dim: number;
  ctx: number;
  pricePerMillion: number; // USD/1M tokens (0 for local)
  mteb: number;            // 0-100 global average
  multilang: 1 | 2 | 3 | 4 | 5;
  note: string;
  provider?: 'remote' | 'local' | 'llama'; // default 'remote'
  // sidecar catalog id when provider='local' (port 3471 micro-models),
  // or the desktop/src/models/catalog id when provider='llama' (bundled
  // llama-server in embedding mode).
  localId?: string;
}

export const EMBEDDING_MODELS: EmbeddingModel[] = [
  {
    id: 'openai/text-embedding-3-small',
    label: 'OpenAI 3-Small',
    dim: 512,
    ctx: 8192,
    pricePerMillion: 0.02,
    mteb: 62,
    multilang: 3,
    note: 'Cheap + fast, Matryoshka-truncated to 512. Solid default.',
  },
  {
    id: 'openai/text-embedding-3-large',
    label: 'OpenAI 3-Large',
    dim: 3072,
    ctx: 8192,
    pricePerMillion: 0.13,
    mteb: 65,
    multilang: 4,
    note: 'Higher recall on English, expensive vs quality gain.',
  },
  {
    id: 'qwen/qwen3-embedding-8b',
    label: 'Qwen3 Embedding 8B',
    dim: 4096,
    ctx: 32000,
    pricePerMillion: 0.01,
    mteb: 70,
    multilang: 5,
    note: 'SOTA quality, multilingual, cheapest. Big vectors (4096).',
  },
  {
    id: 'qwen/qwen3-embedding-4b',
    label: 'Qwen3 Embedding 4B',
    dim: 2560,
    ctx: 32768,
    pricePerMillion: 0.02,
    mteb: 68,
    multilang: 5,
    note: 'Great FR/EN, 32k context, balanced size/quality.',
  },
  {
    id: 'google/gemini-embedding-001',
    label: 'Gemini Embedding 001',
    dim: 3072,
    ctx: 20000,
    pricePerMillion: 0.15,
    mteb: 69,
    multilang: 5,
    note: 'Top MTEB multilingual, Matryoshka. Pricey.',
  },
  {
    id: 'mistralai/mistral-embed-2312',
    label: 'Mistral Embed',
    dim: 1024,
    ctx: 8192,
    pricePerMillion: 0.10,
    mteb: 58,
    multilang: 4,
    note: 'Decent FR, dated, no Matryoshka.',
  },
  {
    id: 'llama:qwen3-embedding-0.6b',
    label: 'Local · Qwen3 Embedding 0.6B',
    dim: 1024,
    ctx: 32768,
    pricePerMillion: 0,
    mteb: 64,
    multilang: 5,
    note: 'Bundled llama-server in --embedding mode. 639 MB, multilingual, FR/EN solid.',
    provider: 'llama',
    localId: 'qwen3-embedding-0.6b',
  },
  {
    id: 'llama:qwen3-embedding-4b',
    label: 'Local · Qwen3 Embedding 4B',
    dim: 2560,
    ctx: 32768,
    pricePerMillion: 0,
    mteb: 68,
    multilang: 5,
    note: 'Bundled llama-server in --embedding mode. 2.5 GB, top quality FR/EN.',
    provider: 'llama',
    localId: 'qwen3-embedding-4b',
  },
  {
    id: 'local:e5-small-multi',
    label: 'Local · Multilingual E5 small',
    dim: 384,
    ctx: 512,
    pricePerMillion: 0,
    mteb: 57,
    multilang: 5,
    note: 'On-device, free, offline. ~130 MB. Install in Settings → Modèles locaux.',
    provider: 'local',
    localId: 'e5-small-multi',
  },
  {
    id: 'local:minilm-l6-en',
    label: 'Local · MiniLM-L6 (EN)',
    dim: 384,
    ctx: 512,
    pricePerMillion: 0,
    mteb: 56,
    multilang: 2,
    note: 'On-device, free, offline. EN only, ~90 MB, very fast.',
    provider: 'local',
    localId: 'minilm-l6-en',
  },
];

export const DEFAULT_EMBEDDING_MODEL_ID = 'openai/text-embedding-3-small';

export function getEmbeddingModel(id: string): EmbeddingModel | undefined {
  return EMBEDDING_MODELS.find(m => m.id === id);
}

// Closed catalog of open-weights models the bundled runtimes are allowed to run.
//
// Covers the five modalities of the MonkeyAgent ecosystem:
//   - chat       → llama-server (4 families: Phi, Llama, Qwen, Mistral)
//   - embed      → llama-server with --embedding (RAG / KB / memory vectors)
//   - image      → sd-server (stable-diffusion.cpp, Flux schnell)
//   - transcribe → whisper-server (whisper.cpp)
//   - tts        → piper (ONNX voices, one .onnx + sibling .onnx.json per voice)
//
// The user cannot side-load arbitrary weights. Every entry is pinned by
// SHA256: the downloader streams the file from `downloadUrl`, recomputes the
// hash on disk, and refuses to activate on mismatch.
//
// The `sha256` field is populated by the release pipeline. Until populated,
// `verifyDigest` returns false and the model UI marks the entry as
// "awaiting signature" — activation is blocked.
//
// Quantization choice (Q4_K_M for LLMs, Q4_0 for image, Q5_1 for whisper) is
// the smallest size with negligible quality regression for the modality.
//
// Refreshed 2026-05-25: full ladder per family up to 32B for chat
//   - Phi      : 4 Mini (3.8B), 4 (14B)
//   - Llama    : 3.2 (3B), 3.1 (8B)
//   - Qwen3    : 4B, 8B, 14B, 32B
//   - Ministral 3: 3B, 8B, 14B (Dec 2025, 262k ctx, replaces Oct-2024 series)
// Throughput floors scale with model size (2 tok/s for ≤4B, 1 tok/s for ~8B,
// 0.8 for 14B, 0.5 for 32B) so the picker can still consider the bigger
// entries on machines with the bandwidth to back them.

export type Modality = 'chat' | 'embed' | 'image' | 'transcribe' | 'tts';
export type Runtime = 'llama' | 'sd' | 'whisper' | 'piper';
export type Family = 'llama' | 'qwen' | 'phi' | 'mistral' | 'whisper' | 'flux' | 'piper' | 'bge' | 'custom';

export interface CatalogModel {
  id: string;
  displayName: string;
  modality: Modality;
  runtime: Runtime;
  family: Family;
  hfRepo: string;
  ggufFile: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
  // Minimum RAM (or VRAM for image) the picker requires before considering this entry, in GB.
  // The full 3-gate check still applies on top; this is a coarse pre-filter.
  minRamGb: number;
  // For chat/embed: token context. For image: native generation resolution.
  // For transcribe: 30s audio chunk in tokens equivalent (1500 mel frames).
  contextLen: number;
  defaultGpuLayers: number;
  license: string;
  // Can this model be redistributed on the P2P network? False for restrictive
  // licenses (Gemma, some Llama Community variants). Local use is always allowed.
  shareable: boolean;
  // Bytes the KV cache consumes per token at f16 (llama.cpp default).
  // For non-LLM modalities (image / transcribe) this is 0 — picker uses
  // `peakRamBytes` instead.
  kvCacheBytesPerToken: number;
  // Approximate peak RAM at inference time. Used by the picker for image /
  // transcribe where `sizeBytes + kvCache × ctx` doesn't apply.
  // Set to 0 when the LLM formula suffices.
  peakRamBytes: number;
  // Minimum useful throughput target. 'chat' wants tokens/s, 'image' wants
  // seconds/image, 'transcribe' wants realtime factor. Encoded uniformly as
  // a bandwidth ratio (model_bytes / sec) and checked against the platform
  // assumed bandwidth.
  minThroughputBytesPerSec: number;
  // llama.cpp embedding pooling strategy. Critical: Qwen3-Embedding family is
  // a causal LM trained with EOS-token pooling ('last'); mean pooling on those
  // yields NaN/null vectors. BGE-M3 uses [CLS]. Defaults to 'mean' for legacy
  // entries when omitted. Only meaningful for modality='embed'.
  pooling?: 'mean' | 'cls' | 'last' | 'none';
  // Which engine actually runs the weights. Default 'llama-server' (bundled
  // llama.cpp). 'ollama' is for models the bundled llama.cpp build can't
  // decode (e.g. Ministral-3-2512 on b9279). When set to 'ollama', the
  // download/activation UI calls `ollama_pull_model` with `ollamaTag`
  // instead of streaming the GGUF from HF directly.
  backend?: 'llama-server' | 'ollama';
  // Ollama tag (e.g. 'ministral-3:3b'). Required when backend === 'ollama'.
  ollamaTag?: string;
}

const HF = (repo: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/main/${file}?download=true`;

export const CATALOG: CatalogModel[] = [
  // ─────────────── CHAT (3 families, ladder up to 32B) ────────────────
  // Phi family — Microsoft. Q8_0 closes ~50% of the tool-call accuracy gap vs cloud.
  {
    id: 'phi-4-mini-instruct',
    displayName: 'Phi-4 Mini',
    modality: 'chat',
    runtime: 'llama',
    family: 'phi',
    hfRepo: 'bartowski/microsoft_Phi-4-mini-instruct-GGUF',
    ggufFile: 'microsoft_Phi-4-mini-instruct-Q8_0.gguf',
    downloadUrl: HF('bartowski/microsoft_Phi-4-mini-instruct-GGUF', 'microsoft_Phi-4-mini-instruct-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 4_100_000_000,
    minRamGb: 6,
    contextLen: 16384,
    defaultGpuLayers: 99,
    license: 'MIT',
    shareable: true,
    kvCacheBytesPerToken: 131_072,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 2 * 4_100_000_000, // ≥ 2 tok/s
  },
  {
    id: 'phi-4',
    displayName: 'Phi-4 14B',
    modality: 'chat',
    runtime: 'llama',
    family: 'phi',
    hfRepo: 'bartowski/phi-4-GGUF',
    ggufFile: 'phi-4-Q8_0.gguf',
    downloadUrl: HF('bartowski/phi-4-GGUF', 'phi-4-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 15_600_000_000,
    minRamGb: 24,
    contextLen: 16384,
    defaultGpuLayers: 99,
    license: 'MIT',
    shareable: true,
    // 40 layers × 10 kv_heads × 128 head_dim × 2 (K+V) × 2 bytes (f16)
    kvCacheBytesPerToken: 204_800,
    peakRamBytes: 0,
    minThroughputBytesPerSec: Math.floor(0.8 * 15_600_000_000), // ≥ 0.8 tok/s
  },

  // Llama family — Meta. Q6_K_L from bartowski (HF).
  {
    id: 'llama-3.2-3b-instruct',
    displayName: 'Llama 3.2 3B',
    modality: 'chat',
    runtime: 'llama',
    family: 'llama',
    hfRepo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    ggufFile: 'Llama-3.2-3B-Instruct-Q6_K_L.gguf',
    downloadUrl: HF('bartowski/Llama-3.2-3B-Instruct-GGUF', 'Llama-3.2-3B-Instruct-Q6_K_L.gguf'),
    sha256: '',
    sizeBytes: 2_643_854_080,
    minRamGb: 4,
    contextLen: 16384,
    defaultGpuLayers: 99,
    license: 'Llama-3.2-Community',
    shareable: true,
    kvCacheBytesPerToken: 114_688,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 2 * 2_643_854_080,
  },
  {
    id: 'llama-3.1-8b-instruct',
    displayName: 'Llama 3.1 8B',
    modality: 'chat',
    runtime: 'llama',
    family: 'llama',
    hfRepo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    ggufFile: 'Meta-Llama-3.1-8B-Instruct-Q6_K_L.gguf',
    downloadUrl: HF('bartowski/Meta-Llama-3.1-8B-Instruct-GGUF', 'Meta-Llama-3.1-8B-Instruct-Q6_K_L.gguf'),
    sha256: '',
    sizeBytes: 6_596_006_336,
    minRamGb: 10,
    contextLen: 16384,
    defaultGpuLayers: 99,
    license: 'Llama-3.1-Community',
    shareable: true,
    // 32 layers × 8 kv_heads × 128 head_dim × 2 (K+V) × 2 bytes (f16)
    kvCacheBytesPerToken: 131_072,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 1 * 6_596_006_336, // ≥ 1 tok/s
  },

  // Qwen3 family — Alibaba. Q8_0 from bartowski (HF).
  {
    id: 'qwen3-4b',
    displayName: 'Qwen3 4B',
    modality: 'chat',
    runtime: 'llama',
    family: 'qwen',
    hfRepo: 'bartowski/Qwen_Qwen3-4B-GGUF',
    ggufFile: 'Qwen_Qwen3-4B-Q8_0.gguf',
    downloadUrl: HF('bartowski/Qwen_Qwen3-4B-GGUF', 'Qwen_Qwen3-4B-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 4_280_000_000,
    minRamGb: 6,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 147_456,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 2 * 4_280_000_000,
  },
  {
    id: 'qwen3-8b',
    displayName: 'Qwen3 8B',
    modality: 'chat',
    runtime: 'llama',
    family: 'qwen',
    hfRepo: 'bartowski/Qwen_Qwen3-8B-GGUF',
    ggufFile: 'Qwen_Qwen3-8B-Q8_0.gguf',
    downloadUrl: HF('bartowski/Qwen_Qwen3-8B-GGUF', 'Qwen_Qwen3-8B-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 8_710_000_000,
    minRamGb: 12,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 147_456,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 1 * 8_710_000_000, // ≥ 1 tok/s
  },
  {
    id: 'qwen3-14b',
    displayName: 'Qwen3 14B',
    modality: 'chat',
    runtime: 'llama',
    family: 'qwen',
    hfRepo: 'bartowski/Qwen_Qwen3-14B-GGUF',
    ggufFile: 'Qwen_Qwen3-14B-Q8_0.gguf',
    downloadUrl: HF('bartowski/Qwen_Qwen3-14B-GGUF', 'Qwen_Qwen3-14B-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 15_700_000_000,
    minRamGb: 24,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    // 40 layers × 8 kv_heads × 128 head_dim × 2 (K+V) × 2 bytes (f16)
    kvCacheBytesPerToken: 163_840,
    peakRamBytes: 0,
    minThroughputBytesPerSec: Math.floor(0.8 * 15_700_000_000),
  },
  {
    id: 'qwen3-32b',
    displayName: 'Qwen3 32B',
    modality: 'chat',
    runtime: 'llama',
    family: 'qwen',
    hfRepo: 'bartowski/Qwen_Qwen3-32B-GGUF',
    ggufFile: 'Qwen_Qwen3-32B-Q8_0.gguf',
    downloadUrl: HF('bartowski/Qwen_Qwen3-32B-GGUF', 'Qwen_Qwen3-32B-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 34_800_000_000,
    minRamGb: 48,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    // 64 layers × 8 kv_heads × 128 head_dim × 2 (K+V) × 2 bytes (f16)
    kvCacheBytesPerToken: 262_144,
    peakRamBytes: 0,
    minThroughputBytesPerSec: Math.floor(0.5 * 34_800_000_000), // ≥ 0.5 tok/s
  },

  // Ministral 3 family — Mistral AI (Dec 2025, 262k ctx, replaces Oct-2024 series).
  // Kept on Ollama: bundled llama.cpp (b9279) can't decode Ministral-3-2512 tokens;
  // Ollama 0.24+ ships a newer build. Slower download (no Cloudflare) but works.
  {
    id: 'ministral-3-3b',
    displayName: 'Ministral 3 3B',
    modality: 'chat',
    runtime: 'llama',
    family: 'mistral',
    hfRepo: 'bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF',
    ggufFile: 'mistralai_Ministral-3-3B-Instruct-2512-Q8_0.gguf',
    downloadUrl: HF('bartowski/mistralai_Ministral-3-3B-Instruct-2512-GGUF', 'mistralai_Ministral-3-3B-Instruct-2512-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 3_400_000_000,
    minRamGb: 4,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 65_536,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 2 * 3_400_000_000,
    backend: 'ollama',
    ollamaTag: 'ministral-3:3b-instruct-2512-q8_0',
  },
  {
    id: 'ministral-3-8b',
    displayName: 'Ministral 3 8B',
    modality: 'chat',
    runtime: 'llama',
    family: 'mistral',
    hfRepo: 'bartowski/mistralai_Ministral-3-8B-Instruct-2512-GGUF',
    ggufFile: 'mistralai_Ministral-3-8B-Instruct-2512-Q8_0.gguf',
    downloadUrl: HF('bartowski/mistralai_Ministral-3-8B-Instruct-2512-GGUF', 'mistralai_Ministral-3-8B-Instruct-2512-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 8_500_000_000,
    minRamGb: 8,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 131_072,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 1 * 8_500_000_000,
    backend: 'ollama',
    ollamaTag: 'ministral-3:8b-instruct-2512-q8_0',
  },
  {
    id: 'ministral-3-14b',
    displayName: 'Ministral 3 14B',
    modality: 'chat',
    runtime: 'llama',
    family: 'mistral',
    hfRepo: 'bartowski/mistralai_Ministral-3-14B-Instruct-2512-GGUF',
    ggufFile: 'mistralai_Ministral-3-14B-Instruct-2512-Q8_0.gguf',
    downloadUrl: HF('bartowski/mistralai_Ministral-3-14B-Instruct-2512-GGUF', 'mistralai_Ministral-3-14B-Instruct-2512-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 15_600_000_000,
    minRamGb: 20,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 163_840,
    peakRamBytes: 0,
    minThroughputBytesPerSec: Math.floor(0.8 * 15_600_000_000),
    backend: 'ollama',
    ollamaTag: 'ministral-3:14b-instruct-2512-q8_0',
  },

  // ─────────────── EMBED (RAG / memory) ────────────────
  {
    id: 'qwen3-embedding-0.6b',
    displayName: 'Qwen3 Embedding 0.6B',
    modality: 'embed',
    runtime: 'llama',
    family: 'qwen',
    hfRepo: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
    ggufFile: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
    downloadUrl: HF('Qwen/Qwen3-Embedding-0.6B-GGUF', 'Qwen3-Embedding-0.6B-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 639_000_000,
    minRamGb: 2,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    // Embed pass is short — KV cache per token small. 28 layers, 8 kv_heads, 64 head_dim.
    kvCacheBytesPerToken: 57_344,
    peakRamBytes: 0,
    // Embeddings just need to keep up with ingestion — 0.5 vector/s acceptable.
    minThroughputBytesPerSec: 0.5 * 639_000_000,
    pooling: 'last',
  },
  {
    id: 'qwen3-embedding-4b',
    displayName: 'Qwen3 Embedding 4B',
    modality: 'embed',
    runtime: 'llama',
    family: 'qwen',
    hfRepo: 'Qwen/Qwen3-Embedding-4B-GGUF',
    ggufFile: 'Qwen3-Embedding-4B-Q4_K_M.gguf',
    downloadUrl: HF('Qwen/Qwen3-Embedding-4B-GGUF', 'Qwen3-Embedding-4B-Q4_K_M.gguf'),
    sha256: '',
    sizeBytes: 2_497_000_000,
    minRamGb: 4,
    contextLen: 32768,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 147_456,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 0.5 * 2_497_000_000,
    pooling: 'last',
  },
  {
    id: 'bge-m3-q8',
    displayName: 'BGE-M3 (multilingual)',
    modality: 'embed',
    runtime: 'llama',
    family: 'bge',
    hfRepo: 'ggml-org/bge-m3-Q8_0-GGUF',
    ggufFile: 'bge-m3-q8_0.gguf',
    downloadUrl: HF('ggml-org/bge-m3-Q8_0-GGUF', 'bge-m3-q8_0.gguf'),
    sha256: '',
    sizeBytes: 634_553_760,
    minRamGb: 2,
    contextLen: 8192,
    defaultGpuLayers: 99,
    license: 'MIT',
    shareable: true,
    // XLM-RoBERTa-large: 24 layers × 16 heads × 64 head_dim × 2 (K+V) × 2 bytes (f16)
    kvCacheBytesPerToken: 98_304,
    peakRamBytes: 0,
    minThroughputBytesPerSec: 0.5 * 634_553_760,
    pooling: 'cls',
  },

  // ─────────────── IMAGE (Flux schnell via sd.cpp) ────────────────
  {
    id: 'flux-schnell-q4',
    displayName: 'Flux schnell (Q4)',
    modality: 'image',
    runtime: 'sd',
    family: 'flux',
    hfRepo: 'city96/FLUX.1-schnell-gguf',
    ggufFile: 'flux1-schnell-Q4_0.gguf',
    downloadUrl: HF('city96/FLUX.1-schnell-gguf', 'flux1-schnell-Q4_0.gguf'),
    sha256: '',
    sizeBytes: 6_800_000_000,
    minRamGb: 12,
    contextLen: 1024, // native 1024×1024 generation
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 0,
    // sd.cpp peak: weights + VAE + text encoders ≈ size × 1.4
    peakRamBytes: 9_500_000_000,
    // ≥ 1 image / 60s = ~115 MB/s of model read at 4 steps schnell.
    minThroughputBytesPerSec: 115_000_000,
  },
  {
    id: 'flux-schnell-q8',
    displayName: 'Flux schnell (Q8, quality)',
    modality: 'image',
    runtime: 'sd',
    family: 'flux',
    hfRepo: 'city96/FLUX.1-schnell-gguf',
    ggufFile: 'flux1-schnell-Q8_0.gguf',
    downloadUrl: HF('city96/FLUX.1-schnell-gguf', 'flux1-schnell-Q8_0.gguf'),
    sha256: '',
    sizeBytes: 12_700_000_000,
    minRamGb: 20,
    contextLen: 1024,
    defaultGpuLayers: 99,
    license: 'Apache-2.0',
    shareable: true,
    kvCacheBytesPerToken: 0,
    peakRamBytes: 17_000_000_000,
    minThroughputBytesPerSec: 215_000_000,
  },

  // ─────────────── TRANSCRIBE (whisper.cpp) ────────────────
  {
    id: 'whisper-small',
    displayName: 'Whisper Small (multi)',
    modality: 'transcribe',
    runtime: 'whisper',
    family: 'whisper',
    hfRepo: 'ggerganov/whisper.cpp',
    ggufFile: 'ggml-small.bin',
    downloadUrl: HF('ggerganov/whisper.cpp', 'ggml-small.bin'),
    sha256: '',
    sizeBytes: 488_000_000,
    minRamGb: 2,
    contextLen: 1500,
    defaultGpuLayers: 99,
    license: 'MIT',
    shareable: true,
    kvCacheBytesPerToken: 0,
    peakRamBytes: 700_000_000,
    // Realtime: process 30s of audio in ≤ 30s = read model ~5x in that window.
    minThroughputBytesPerSec: 80_000_000,
  },
  {
    id: 'whisper-large-v3-turbo-q5',
    displayName: 'Whisper Large v3 Turbo',
    modality: 'transcribe',
    runtime: 'whisper',
    family: 'whisper',
    hfRepo: 'ggerganov/whisper.cpp',
    ggufFile: 'ggml-large-v3-turbo-q5_0.bin',
    downloadUrl: HF('ggerganov/whisper.cpp', 'ggml-large-v3-turbo-q5_0.bin'),
    sha256: '',
    sizeBytes: 547_000_000,
    minRamGb: 3,
    contextLen: 1500,
    defaultGpuLayers: 99,
    license: 'MIT',
    shareable: true,
    kvCacheBytesPerToken: 0,
    peakRamBytes: 900_000_000,
    minThroughputBytesPerSec: 90_000_000,
  },

  // ─────────────── TTS (Piper ONNX voices) ────────────────
  // Each entry is one voice. ggufFile holds the .onnx filename; the sibling
  // <name>.onnx.json config is fetched by the runtime alongside it.
  // Voices are tiny (~60 MB) and run realtime on any CPU — picker gates are
  // mostly cosmetic for this modality.
  {
    id: 'piper-fr-siwis-medium',
    displayName: 'Piper FR · siwis (medium)',
    modality: 'tts',
    runtime: 'piper',
    family: 'piper',
    hfRepo: 'rhasspy/piper-voices',
    ggufFile: 'fr_FR-siwis-medium.onnx',
    downloadUrl: HF('rhasspy/piper-voices', 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx'),
    sha256: '',
    sizeBytes: 63_201_294,
    minRamGb: 1,
    contextLen: 256,
    defaultGpuLayers: 0,
    license: 'MIT',
    shareable: true,
    kvCacheBytesPerToken: 0,
    peakRamBytes: 350_000_000,
    minThroughputBytesPerSec: 50_000_000,
  },
  {
    id: 'piper-en-amy-medium',
    displayName: 'Piper EN · amy (medium)',
    modality: 'tts',
    runtime: 'piper',
    family: 'piper',
    hfRepo: 'rhasspy/piper-voices',
    ggufFile: 'en_US-amy-medium.onnx',
    downloadUrl: HF('rhasspy/piper-voices', 'en/en_US/amy/medium/en_US-amy-medium.onnx'),
    sha256: '',
    sizeBytes: 63_088_204,
    minRamGb: 1,
    contextLen: 256,
    defaultGpuLayers: 0,
    license: 'MIT',
    shareable: true,
    kvCacheBytesPerToken: 0,
    peakRamBytes: 350_000_000,
    minThroughputBytesPerSec: 50_000_000,
  },
];

export function findCatalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find(m => m.id === id);
}

export function findByGgufFile(file: string): CatalogModel | undefined {
  return CATALOG.find(m => m.ggufFile.toLowerCase() === file.toLowerCase());
}

export function catalogByModality(modality: Modality): CatalogModel[] {
  return CATALOG.filter(m => m.modality === modality);
}

export function verifyDigest(model: CatalogModel, computed: string): boolean {
  if (!model.sha256) return false;
  return model.sha256.toLowerCase() === computed.toLowerCase();
}

export const DEFAULT_MODEL_ID = 'phi-4-mini-instruct';

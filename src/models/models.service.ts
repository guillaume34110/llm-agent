// Post-pivot (2026-05-18): static catalog of whitelisted open-weight models.
// All Apache-2.0. No commercial-license models — credits-as-compensation
// requires permissive license. Costs are credit ratios calibrated against
// ~€0.10/1M tok electricity on consumer hardware + matchmaking margin.
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Throughput units, mutualized across tasks:
//   tokPerSec       — chat/vision/reasoning/code/guard (higher = better)
//   realtimeFactor  — ASR (1.0 = 1s audio per 1s compute, higher = better)
//   itemsPerSec     — embed/rerank/sentiment/image_classify (higher = better)
//   secondsPerImage — image-gen + ocr (LOWER is better; below-threshold check inverted)
type ThroughputUnit = 'tokPerSec' | 'realtimeFactor' | 'itemsPerSec' | 'secondsPerImage';

type Archetype = 'mac_unified' | 'single_gpu' | 'multi_gpu' | 'cpu';

interface WhitelistedModel {
  id: string;
  name: string;
  category: string;
  family: string;
  sizeB: number;
  activeB?: number;
  task: string;
  minVramGb: number;
  license: string;
  inputCostPer1MTokensCents: number;
  outputCostPer1MTokensCents: number;
  contextLength: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsAudioInput?: boolean;
  imageCostCents?: number;
  supportsImageOutput?: boolean;
  icon: string;
  // Perf SLA (2026-05-19): 30 tok/s baseline, 20 tok/s for large (32B+ dense,
  // 200B+ MoE). Below threshold → provider must announce `downgradeTo` instead.
  minThroughput: number;
  throughputUnit: ThroughputUnit;
  downgradeTo: string | null;
  // Layer-shardable across multiple GPUs. Defaults true (transformers).
  // Set false for diffusion + small audio models (need contiguous VRAM).
  shardable?: boolean;
  // Per-archetype SLA overrides. Defaults derived in `slaOverrides()` below.
  slaPerArchetype?: Partial<Record<Archetype, number>>;
}

// Derive per-archetype SLA from the generic minThroughput when the catalog
// entry doesn't specify overrides. Macs get a lower bar (decode is fast,
// prompt-eval is structurally slow on unified memory); CPU is generous.
// Only meaningful for tokPerSec models — others bypass the per-archetype
// check (Untested verdict in provider-runtime).
function defaultSlaOverrides(m: WhitelistedModel): Partial<Record<Archetype, number>> {
  if (m.throughputUnit !== 'tokPerSec') return {};
  const base = m.minThroughput;
  return {
    mac_unified: Math.max(5, Math.round(base * 0.7)),
    cpu: Math.max(2, Math.round(base * 0.2)),
  };
}

const WHITELIST: WhitelistedModel[] = [
  // ───── Qwen family ─────
  { id: 'qwen3:4b', name: 'Qwen3 4B', category: 'fast', family: 'qwen', sizeB: 4, task: 'chat', minVramGb: 4, license: 'Apache-2.0', inputCostPer1MTokensCents: 8, outputCostPer1MTokensCents: 8, contextLength: 131_072, supportsTools: true, supportsVision: false, icon: '⚡', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: null },
  { id: 'qwen3-vl:4b', name: 'Qwen3-VL 4B', category: 'fast', family: 'qwen', sizeB: 4, task: 'vision', minVramGb: 5, license: 'Apache-2.0', inputCostPer1MTokensCents: 10, outputCostPer1MTokensCents: 10, contextLength: 131_072, supportsTools: true, supportsVision: true, icon: '👁', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: null },
  { id: 'qwen3:8b', name: 'Qwen3 8B', category: 'balanced', family: 'qwen', sizeB: 8, task: 'chat', minVramGb: 6, license: 'Apache-2.0', inputCostPer1MTokensCents: 12, outputCostPer1MTokensCents: 12, contextLength: 131_072, supportsTools: true, supportsVision: false, icon: '⚖️', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: 'qwen3:4b' },
  { id: 'qwen3-vl:8b', name: 'Qwen3-VL 8B', category: 'balanced', family: 'qwen', sizeB: 8, task: 'vision', minVramGb: 8, license: 'Apache-2.0', inputCostPer1MTokensCents: 14, outputCostPer1MTokensCents: 14, contextLength: 131_072, supportsTools: true, supportsVision: true, icon: '👁', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: 'qwen3-vl:4b' },
  { id: 'qwen3:14b', name: 'Qwen3 14B', category: 'balanced', family: 'qwen', sizeB: 14, task: 'chat', minVramGb: 10, license: 'Apache-2.0', inputCostPer1MTokensCents: 18, outputCostPer1MTokensCents: 18, contextLength: 131_072, supportsTools: true, supportsVision: false, icon: '⚖️', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: 'qwen3:8b' },
  { id: 'qwen3:32b', name: 'Qwen3 32B', category: 'powerful', family: 'qwen', sizeB: 32, task: 'chat', minVramGb: 22, license: 'Apache-2.0', inputCostPer1MTokensCents: 28, outputCostPer1MTokensCents: 28, contextLength: 131_072, supportsTools: true, supportsVision: false, icon: '🔥', minThroughput: 20, throughputUnit: 'tokPerSec', downgradeTo: 'qwen3:14b' },
  { id: 'qwen3-vl:32b', name: 'Qwen3-VL 32B', category: 'powerful', family: 'qwen', sizeB: 32, task: 'vision', minVramGb: 24, license: 'Apache-2.0', inputCostPer1MTokensCents: 30, outputCostPer1MTokensCents: 30, contextLength: 131_072, supportsTools: true, supportsVision: true, icon: '👁', minThroughput: 20, throughputUnit: 'tokPerSec', downgradeTo: 'qwen3-vl:8b' },
  { id: 'qwen3.6:27b', name: 'Qwen3.6 27B', category: 'powerful', family: 'qwen', sizeB: 27, task: 'chat', minVramGb: 20, license: 'Apache-2.0', inputCostPer1MTokensCents: 26, outputCostPer1MTokensCents: 26, contextLength: 262_144, supportsTools: true, supportsVision: false, icon: '🔥', minThroughput: 20, throughputUnit: 'tokPerSec', downgradeTo: 'qwen3:14b' },
  { id: 'qwen3.6-35b-a3b', name: 'Qwen3.6 35B-A3B (MoE)', category: 'powerful', family: 'qwen', sizeB: 35, activeB: 3, task: 'chat', minVramGb: 22, license: 'Apache-2.0', inputCostPer1MTokensCents: 16, outputCostPer1MTokensCents: 16, contextLength: 262_144, supportsTools: true, supportsVision: false, icon: '⚡', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: 'qwen3:14b' },
  { id: 'qwen3-235b-a22b', name: 'Qwen3 235B-A22B (MoE)', category: 'flagship', family: 'qwen', sizeB: 235, activeB: 22, task: 'chat', minVramGb: 140, license: 'Apache-2.0', inputCostPer1MTokensCents: 45, outputCostPer1MTokensCents: 45, contextLength: 262_144, supportsTools: true, supportsVision: false, icon: '👑', minThroughput: 20, throughputUnit: 'tokPerSec', downgradeTo: 'qwen3.6-35b-a3b' },

  // ───── Mistral family (Apache-2.0 only, 24B+) ─────
  { id: 'mistral-small-3.1:24b', name: 'Mistral Small 3.1 24B', category: 'powerful', family: 'mistral', sizeB: 24, task: 'vision', minVramGb: 16, license: 'Apache-2.0', inputCostPer1MTokensCents: 22, outputCostPer1MTokensCents: 22, contextLength: 131_072, supportsTools: true, supportsVision: true, icon: '👁', minThroughput: 20, throughputUnit: 'tokPerSec', downgradeTo: null },
  { id: 'magistral:24b', name: 'Magistral 24B', category: 'reasoning', family: 'mistral', sizeB: 24, task: 'reasoning', minVramGb: 16, license: 'Apache-2.0', inputCostPer1MTokensCents: 25, outputCostPer1MTokensCents: 25, contextLength: 131_072, supportsTools: true, supportsVision: false, icon: '🧠', minThroughput: 20, throughputUnit: 'tokPerSec', downgradeTo: null },
  { id: 'devstral:24b', name: 'Devstral 24B', category: 'code', family: 'mistral', sizeB: 24, task: 'code', minVramGb: 16, license: 'Apache-2.0', inputCostPer1MTokensCents: 22, outputCostPer1MTokensCents: 22, contextLength: 131_072, supportsTools: true, supportsVision: false, icon: '💻', minThroughput: 20, throughputUnit: 'tokPerSec', downgradeTo: null },
  { id: 'voxtral:3b', name: 'Voxtral 3B (ASR)', category: 'asr', family: 'mistral', sizeB: 3, task: 'asr', minVramGb: 3, license: 'Apache-2.0', inputCostPer1MTokensCents: 6, outputCostPer1MTokensCents: 6, contextLength: 32_768, supportsTools: false, supportsVision: false, supportsAudioInput: true, icon: '🎤', minThroughput: 1.0, throughputUnit: 'realtimeFactor', downgradeTo: null },

  // ───── Phi family ─────
  { id: 'phi-4-mini:3.8b', name: 'Phi-4 Mini 3.8B', category: 'fast', family: 'phi', sizeB: 3.8, task: 'chat', minVramGb: 4, license: 'Apache-2.0', inputCostPer1MTokensCents: 7, outputCostPer1MTokensCents: 7, contextLength: 131_072, supportsTools: true, supportsVision: false, icon: '⚡', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: null },
  { id: 'phi-4-multimodal:5.6b', name: 'Phi-4 Multimodal 5.6B', category: 'balanced', family: 'phi', sizeB: 5.6, task: 'vision', minVramGb: 5, license: 'Apache-2.0', inputCostPer1MTokensCents: 10, outputCostPer1MTokensCents: 10, contextLength: 131_072, supportsTools: true, supportsVision: true, supportsAudioInput: true, icon: '👁', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: 'phi-4-mini:3.8b' },
  { id: 'phi-4:14b', name: 'Phi-4 14B', category: 'balanced', family: 'phi', sizeB: 14, task: 'chat', minVramGb: 10, license: 'Apache-2.0', inputCostPer1MTokensCents: 16, outputCostPer1MTokensCents: 16, contextLength: 16_384, supportsTools: true, supportsVision: false, icon: '⚖️', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: 'phi-4-mini:3.8b' },
  { id: 'phi-4-reasoning-vision:15b', name: 'Phi-4 Reasoning-Vision 15B', category: 'reasoning', family: 'phi', sizeB: 15, task: 'reasoning', minVramGb: 12, license: 'Apache-2.0', inputCostPer1MTokensCents: 20, outputCostPer1MTokensCents: 20, contextLength: 32_768, supportsTools: true, supportsVision: true, icon: '🧠', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: 'phi-4-multimodal:5.6b' },

  // ───── Specialty (out of family-auto routing) ─────
  { id: 'qwen3guard-stream:0.6b', name: 'Qwen3Guard-Stream 0.6B', category: 'safety', family: 'specialty', sizeB: 0.6, task: 'guard', minVramGb: 1, license: 'Apache-2.0', inputCostPer1MTokensCents: 4, outputCostPer1MTokensCents: 4, contextLength: 32_768, supportsTools: false, supportsVision: false, icon: '🛡️', minThroughput: 30, throughputUnit: 'tokPerSec', downgradeTo: null },
  { id: 'bge-m3', name: 'BGE-M3 Embeddings', category: 'embed', family: 'specialty', sizeB: 0.568, task: 'embed', minVramGb: 1, license: 'Apache-2.0', inputCostPer1MTokensCents: 3, outputCostPer1MTokensCents: 0, contextLength: 8_192, supportsTools: false, supportsVision: false, icon: '🔡', minThroughput: 100, throughputUnit: 'itemsPerSec', downgradeTo: null },
  { id: 'qwen3-vl-reranker', name: 'Qwen3-VL Reranker', category: 'rerank', family: 'specialty', sizeB: 4, task: 'rerank', minVramGb: 4, license: 'Apache-2.0', inputCostPer1MTokensCents: 5, outputCostPer1MTokensCents: 0, contextLength: 16_384, supportsTools: false, supportsVision: true, icon: '🔀', minThroughput: 50, throughputUnit: 'itemsPerSec', downgradeTo: null },
  { id: 'qwen-image', name: 'Qwen-Image', category: 'image-gen', family: 'specialty', sizeB: 20, task: 'image-gen', minVramGb: 16, license: 'Apache-2.0', inputCostPer1MTokensCents: 0, outputCostPer1MTokensCents: 0, imageCostCents: 8, contextLength: 2_048, supportsTools: false, supportsVision: false, supportsImageOutput: true, icon: '🎨', minThroughput: 30, throughputUnit: 'secondsPerImage', downgradeTo: null, shardable: false },
  // Voxtral (ASR): also non-shardable — short audio chunks don't benefit
  // from layer split and prompt fits in single GPU comfortably.

  // ───── Sidecar-served tasks (no Ollama, dispatched to Python sidecar) ─────
  // These models live in monkey/local_models/catalog.py with matching ids.
  // The provider-runtime detects task != chat/vision and routes the decrypted
  // request to the sidecar HTTP layer instead of Ollama /api/chat.
  { id: 'tesseract', name: 'Tesseract OCR', category: 'ocr', family: 'specialty', sizeB: 0, task: 'ocr', minVramGb: 0, license: 'Apache-2.0', inputCostPer1MTokensCents: 0, outputCostPer1MTokensCents: 0, imageCostCents: 1, contextLength: 0, supportsTools: false, supportsVision: true, icon: '📜', minThroughput: 5, throughputUnit: 'secondsPerImage', downgradeTo: null, shardable: false },
  { id: 'xlm-sentiment', name: 'XLM-R Sentiment (multi)', category: 'classify', family: 'specialty', sizeB: 0.278, task: 'sentiment', minVramGb: 1, license: 'MIT', inputCostPer1MTokensCents: 2, outputCostPer1MTokensCents: 0, contextLength: 512, supportsTools: false, supportsVision: false, icon: '🧭', minThroughput: 50, throughputUnit: 'itemsPerSec', downgradeTo: null, shardable: false },
  { id: 'vit-image-classify', name: 'ViT Image Classify', category: 'classify', family: 'specialty', sizeB: 0.086, task: 'image_classify', minVramGb: 1, license: 'Apache-2.0', inputCostPer1MTokensCents: 0, outputCostPer1MTokensCents: 0, imageCostCents: 1, contextLength: 0, supportsTools: false, supportsVision: true, icon: '🏷', minThroughput: 5, throughputUnit: 'itemsPerSec', downgradeTo: null, shardable: false },
];

@Injectable()
export class ModelsService implements OnModuleInit {
  private readonly logger = new Logger(ModelsService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedCatalog();
  }

  async seedCatalog() {
    const ids = new Set(WHITELIST.map(m => m.id));
    for (const m of WHITELIST) {
      const data = {
        name: m.name,
        category: m.category,
        family: m.family,
        sizeB: m.sizeB,
        activeB: m.activeB ?? null,
        task: m.task,
        minVramGb: m.minVramGb,
        license: m.license,
        imageCostCents: m.imageCostCents ?? null,
        contextLength: m.contextLength,
        tokensPerSecond: null,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsAudioInput: m.supportsAudioInput ?? false,
        supportsImageOutput: m.supportsImageOutput ?? false,
        supportsAudioOutput: false,
        musicCostCents: null,
        supportsVideoOutput: false,
        videoCostCentsPerSec: null,
        enabled: true,
        icon: m.icon,
      };
      await this.prisma.modelMeta.upsert({
        where: { id: m.id },
        create: { id: m.id, ...data },
        update: data,
      });
    }
    await this.prisma.modelMeta.updateMany({
      where: { id: { notIn: Array.from(ids) }, enabled: true },
      data: { enabled: false },
    });
    this.logger.log(`Seeded ${WHITELIST.length} whitelisted models`);
  }

  async getModelsGrouped(): Promise<Record<string, any[]>> {
    const models = await this.prisma.modelMeta.findMany({
      where: { enabled: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    const grouped: Record<string, any[]> = {};
    for (const m of models) {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push({
        id: m.id,
        name: m.name,
        category: m.category,
        family: m.family,
        sizeB: m.sizeB,
        activeB: m.activeB,
        task: m.task,
        minVramGb: m.minVramGb,
        license: m.license,
        imageCostCents: m.imageCostCents,
        contextLength: m.contextLength,
        tokensPerSecond: m.tokensPerSecond,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsAudioInput: m.supportsAudioInput,
        supportsImageOutput: m.supportsImageOutput,
        supportsAudioOutput: m.supportsAudioOutput,
        supportsVideoOutput: m.supportsVideoOutput,
        icon: m.icon,
        minThroughput: (m as any).minThroughput,
        throughputUnit: (m as any).throughputUnit,
        downgradeTo: (m as any).downgradeTo,
        shardable: (m as any).shardable ?? true,
        slaPerArchetype: (m as any).slaPerArchetype ?? null,
      });
    }
    return grouped;
  }
}

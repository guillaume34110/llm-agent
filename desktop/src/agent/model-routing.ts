import type { AppPreferences } from '../preferences/preferences-service';
import type { ModelInfo } from '../types';

export type ModelBudgetMode = AppPreferences['agentModelBudgetMode'];

export interface ModelRoutingPrefs {
  family: string;
  primaryModelId: string;
  budgetMode: ModelBudgetMode;
  allowFamilyFallback: boolean;
}

export interface ModelRouteDecision {
  family: string;
  primaryModelId: string;
  selectedModelId: string;
  reason: string;
  taskComplexity: 'simple' | 'normal' | 'hard';
}

const FAMILY_ALIASES: Record<string, string> = {
  qwen: 'Qwen',
  mistralai: 'Mistral',
  mistral: 'Mistral',
  microsoft: 'Phi',
  phi: 'Phi',
};

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getModelFamily(model: Pick<ModelInfo, 'id' | 'provider'>): string {
  const raw = (model.provider || model.id.split('/')[0] || 'Autres').trim();
  return FAMILY_ALIASES[raw.toLowerCase()] || raw;
}

export function groupModelsByFamily(models: ModelInfo[]) {
  const map = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const family = getModelFamily(model);
    if (!map.has(family)) map.set(family, []);
    map.get(family)!.push(model);
  }
  return map;
}

export function inferTaskComplexity(messages: Array<{ role: string; content: string | null }>): 'simple' | 'normal' | 'hard' {
  const lastUser = [...messages].reverse().find(message => message.role === 'user')?.content?.toLowerCase() || '';
  const hardSignals = [
    'jeu', 'game', 'fullstack', 'saas', 'dashboard', 'refactor', 'architecture', 'corrige', 'fixe',
    'debug', 'browser', 'navig', 'playwright', 'build', 'tests', 'workflow', 'multi', 'plusieurs',
  ];
  const simpleSignals = ['résume', 'resume', 'cherche', 'recherche', 'explique', 'rappel', 'tâche', 'calendar', 'mail'];
  const hardCount = hardSignals.filter(signal => lastUser.includes(signal)).length;
  const simpleCount = simpleSignals.filter(signal => lastUser.includes(signal)).length;
  if (hardCount >= 2) return 'hard';
  if (hardCount === 1 || lastUser.length > 450) return 'normal';
  if (simpleCount >= 1 && lastUser.length < 180) return 'simple';
  return 'normal';
}

function qualityScore(model: ModelInfo): number {
  const id = model.id.toLowerCase();
  let score = 0.45;
  if (id.includes('qwen3.6') || id.includes('qwen3-235b') || id.includes('magistral') || id.includes('phi-4-reasoning')) score += 0.4;
  else if (id.includes('qwen3-vl') || id.includes('qwen3:32b') || id.includes('mistral-small-3') || id.includes('devstral') || id.includes('phi-4:14b')) score += 0.22;
  else if (id.includes('mini') || id.includes(':4b') || id.includes('0.6b') || id.includes('3.8b')) score -= 0.05;
  score += Math.min(asNumber(model.contextLength) / 200_000, 0.18);
  score += Math.min(asNumber(model.tokensPerSecond) / 200, 0.1);
  if (model.supportsTools === false) score -= 1;
  return score;
}

function costScore(model: ModelInfo): number {
  const input = asNumber(model.inputCostPer1MTokensCents);
  const output = asNumber(model.outputCostPer1MTokensCents);
  const combined = input + output;
  if (combined <= 0) return 1;
  return 1 / Math.max(1, combined);
}

function rankModels(models: ModelInfo[], budgetMode: ModelBudgetMode, complexity: 'simple' | 'normal' | 'hard') {
  return [...models].sort((a, b) => {
    const qa = qualityScore(a);
    const qb = qualityScore(b);
    const ca = costScore(a);
    const cb = costScore(b);
    const sa = asNumber(a.tokensPerSecond);
    const sb = asNumber(b.tokensPerSecond);
    const scoreA =
      (budgetMode === 'power' ? qa * 0.75 + ca * 0.1 + sa * 0.002 :
        budgetMode === 'eco' ? qa * (complexity === 'hard' ? 0.45 : 0.3) + ca * 0.55 + sa * 0.0015 :
          qa * (complexity === 'hard' ? 0.65 : 0.55) + ca * 0.25 + sa * 0.0025);
    const scoreB =
      (budgetMode === 'power' ? qb * 0.75 + cb * 0.1 + sb * 0.002 :
        budgetMode === 'eco' ? qb * (complexity === 'hard' ? 0.45 : 0.3) + cb * 0.55 + sb * 0.0015 :
          qb * (complexity === 'hard' ? 0.65 : 0.55) + cb * 0.25 + sb * 0.0025);
    return scoreB - scoreA;
  });
}

export function pickBestInFamily(models: ModelInfo[], family: string | 'global', budgetMode: ModelBudgetMode = 'balanced'): ModelInfo | null {
  const pool = family === 'global'
    ? models.filter(m => m.supportsTools !== false)
    : models.filter(m => getModelFamily(m) === family && m.supportsTools !== false);
  if (!pool.length) return null;
  return rankModels(pool, budgetMode, 'normal')[0] || null;
}

export function resolveRoutingPrefs(models: ModelInfo[], preferredModelId: string | undefined, preferences: ModelRoutingPrefs): ModelRoutingPrefs {
  if (preferredModelId) {
    const match = models.find(model => model.id === preferredModelId);
    if (match) {
      return {
        ...preferences,
        family: getModelFamily(match),
        primaryModelId: match.id,
      };
    }
  }
  if (preferences.primaryModelId) {
    const match = models.find(model => model.id === preferences.primaryModelId);
    if (match) return { ...preferences, family: preferences.family || getModelFamily(match) };
  }
  if (preferences.family) return preferences;
  const first = rankModels(models.filter(model => model.supportsTools !== false), preferences.budgetMode, 'normal')[0] || models[0];
  return {
    ...preferences,
    family: first ? getModelFamily(first) : '',
    primaryModelId: first?.id || '',
  };
}

export function buildRouteDecision(models: ModelInfo[], preferredModelId: string | undefined, preferences: ModelRoutingPrefs, messages: Array<{ role: string; content: string | null }>): ModelRouteDecision | null {
  if (!models.length) return null;
  const resolved = resolveRoutingPrefs(models, preferredModelId, preferences);
  const complexity = inferTaskComplexity(messages);
  const familyModels = models.filter(model => getModelFamily(model) === resolved.family && model.supportsTools !== false);
  const rankedFamily = rankModels(familyModels.length ? familyModels : models.filter(model => model.supportsTools !== false), resolved.budgetMode, complexity);
  const primary = rankedFamily.find(model => model.id === resolved.primaryModelId) || rankedFamily[0] || models[0];
  if (!primary) return null;
  return {
    family: resolved.family || getModelFamily(primary),
    primaryModelId: primary.id,
    selectedModelId: primary.id,
    reason: preferredModelId ? 'override' : resolved.primaryModelId ? 'primary' : 'auto',
    taskComplexity: complexity,
  };
}

export function pickFamilyFallback(models: ModelInfo[], preferences: ModelRoutingPrefs, currentModelId: string, messages: Array<{ role: string; content: string | null }>, reason: string, attempted: string[]): ModelRouteDecision | null {
  if (!preferences.allowFamilyFallback) return null;
  const current = models.find(model => model.id === currentModelId);
  if (!current) return null;
  const family = preferences.family || getModelFamily(current);
  const complexity = inferTaskComplexity(messages);

  // For "model too slow" or transport-style errors, follow the catalog's
  // explicit downgradeTo chain first. The server publishes per-model targets
  // tuned for SLA — respect them before the heuristic ranker kicks in.
  if (reason === 'slow' || reason === 'timeout' || reason === 'no_provider') {
    let cursor: ModelInfo | undefined = current;
    while (cursor?.downgradeTo) {
      const next = models.find(m => m.id === cursor!.downgradeTo);
      if (!next) break;
      if (!attempted.includes(next.id) && next.supportsTools !== false) {
        return {
          family: getModelFamily(next),
          primaryModelId: preferences.primaryModelId || currentModelId,
          selectedModelId: next.id,
          reason: `${reason}_downgrade`,
          taskComplexity: complexity,
        };
      }
      cursor = next;
    }
  }

  const familyModels = rankModels(
    models.filter(model => getModelFamily(model) === family && model.supportsTools !== false),
    preferences.budgetMode,
    complexity,
  );
  if (!familyModels.length) return null;

  const currentIndex = familyModels.findIndex(model => model.id === currentModelId);
  const stronger = familyModels.slice(0, Math.max(currentIndex, 0)).filter(model => !attempted.includes(model.id));
  const cheaper = familyModels.slice(Math.max(currentIndex + 1, 0)).filter(model => !attempted.includes(model.id));
  const next =
    (reason === 'stalled' || reason === 'no_tools' || reason === 'llm_error'
      ? stronger[0] || cheaper[0]
      : cheaper[0] || stronger[0]) ||
    familyModels.find(model => !attempted.includes(model.id));

  if (!next || next.id === currentModelId) return null;
  return {
    family,
    primaryModelId: preferences.primaryModelId || currentModelId,
    selectedModelId: next.id,
    reason,
    taskComplexity: complexity,
  };
}

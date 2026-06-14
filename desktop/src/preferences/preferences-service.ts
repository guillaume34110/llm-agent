import { createLocalStore } from '../lib/local-store';
import { getCurrentAnimal, subscribe as subscribeAnimal } from '../animals/animal-service';
import { DEFAULT_ANIMAL, type AnimalId } from '../animals/registry';
import type { Locale } from '../i18n/i18n';
import { canonicalModelId } from '../models/model-id-alias';

export interface AppPreferences {
  onboardingDismissed: boolean;
  autoSpeakResponses: boolean;
  reminderNotifications: boolean;
  voiceInputLocale: string;
  voiceInputModel: string;
  voiceOutputVoiceURI: string;
  imageModelId: string;
  imageSize: string;
  musicModelId: string;
  videoModelId: string;
  agentModelFamily: string;
  primaryAgentModelId: string;
  agentModelBudgetMode: 'eco' | 'balanced' | 'power';
  allowAgentFamilyFallback: boolean;
  theme: 'dark' | 'light';
  chatStyle: 'bubbles' | 'flat' | 'compact';
  uiMode: 'simple' | 'advanced';
  lastActivityTs: number;
  tourDone: boolean;
  locale: Locale;
}

const DEFAULT_PREFERENCES: AppPreferences = {
  onboardingDismissed: false,
  autoSpeakResponses: false,
  reminderNotifications: true,
  voiceInputLocale: 'fr-FR',
  voiceInputModel: '',
  voiceOutputVoiceURI: '',
  imageModelId: 'black-forest-labs/flux-schnell',
  imageSize: '1024x1024',
  musicModelId: 'google/lyria-3-clip-preview',
  videoModelId: 'kwaivgi/kling-video-o1',
  agentModelFamily: '',
  primaryAgentModelId: '',
  agentModelBudgetMode: 'balanced',
  allowAgentFamilyFallback: true,
  theme: 'dark',
  chatStyle: 'bubbles',
  uiMode: 'simple',
  lastActivityTs: 0,
  tourDone: false,
  locale: 'fr',
};

type PrefMap = Record<string, AppPreferences>;

const STORAGE_KEY = 'app-preferences';
const LEGACY_KEY = 'monkey-preferences';
const GLOBAL_KEY = '__global__';

// Fields that stay global (not switched when animal changes).
type GlobalField = 'theme' | 'onboardingDismissed' | 'uiMode' | 'lastActivityTs' | 'tourDone' | 'locale';
const GLOBAL_FIELDS: ReadonlyArray<GlobalField> = ['theme', 'onboardingDismissed', 'uiMode', 'lastActivityTs', 'tourDone', 'locale'];

function migrateLegacy(): PrefMap {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return {};
    const parsed = JSON.parse(legacy) as Partial<AppPreferences>;
    const seed: PrefMap = {
      [DEFAULT_ANIMAL]: { ...DEFAULT_PREFERENCES, ...parsed },
      [GLOBAL_KEY]: {
        ...DEFAULT_PREFERENCES,
        ...(parsed.theme ? { theme: parsed.theme } : {}),
        ...(parsed.onboardingDismissed != null ? { onboardingDismissed: parsed.onboardingDismissed } : {}),
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    localStorage.removeItem(LEGACY_KEY);
    return seed;
  } catch {
    return {};
  }
}

if (typeof localStorage !== 'undefined' && !localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_KEY)) {
  migrateLegacy();
}

const store = createLocalStore<PrefMap>(STORAGE_KEY, {});

(function normalizeStoredPreferences() {
  try {
    const current = store.read();
    const normalized = normalizePrefMap(current);
    if (normalized !== current) {
      store.update(() => normalized);
    }
  } catch {}
})();

// One-shot: if global branch is missing, seed it from the default animal's current
// per-animal values so existing users keep their theme + onboarding state.
(function seedGlobalBranch() {
  try {
    const map = store.read();
    if (map[GLOBAL_KEY]) return;
    const source = map[DEFAULT_ANIMAL] ?? Object.values(map)[0];
    if (!source) return;
    store.update(prev => ({
      ...prev,
      [GLOBAL_KEY]: {
        ...DEFAULT_PREFERENCES,
        theme: source.theme ?? DEFAULT_PREFERENCES.theme,
        onboardingDismissed: source.onboardingDismissed ?? DEFAULT_PREFERENCES.onboardingDismissed,
      },
    }));
  } catch {}
})();

function currentId(): AnimalId {
  return getCurrentAnimal().id;
}

function branch(map: PrefMap, id: AnimalId): AppPreferences {
  const animalPrefs = { ...DEFAULT_PREFERENCES, ...(map[id] ?? {}) };
  const global = map[GLOBAL_KEY] ?? {};
  // Global fields win over per-animal
  for (const k of GLOBAL_FIELDS) {
    if (k in global) (animalPrefs as any)[k] = (global as any)[k];
  }
  animalPrefs.primaryAgentModelId = canonicalModelId(animalPrefs.primaryAgentModelId);
  return animalPrefs;
}

function normalizePatch(patch: Partial<AppPreferences>): Partial<AppPreferences> {
  if (!patch.primaryAgentModelId) return patch;
  return {
    ...patch,
    primaryAgentModelId: canonicalModelId(patch.primaryAgentModelId),
  };
}

function normalizePrefMap(map: PrefMap): PrefMap {
  let changed = false;
  const next: PrefMap = {};
  for (const [key, value] of Object.entries(map)) {
    const normalized = {
      ...value,
      primaryAgentModelId: canonicalModelId(value?.primaryAgentModelId || ''),
    };
    if ((value?.primaryAgentModelId || '') !== normalized.primaryAgentModelId) changed = true;
    next[key] = normalized as AppPreferences;
  }
  return changed ? next : map;
}

export function getPreferences(): AppPreferences {
  return branch(store.read(), currentId());
}

export function getPreferencesFor(id: AnimalId): AppPreferences {
  return branch(store.read(), id);
}

export function updatePreferences(patch: Partial<AppPreferences>) {
  patch = normalizePatch(patch);
  const id = currentId();
  const globalPatch: Partial<AppPreferences> = {};
  const animalPatch: Partial<AppPreferences> = {};
  for (const [k, v] of Object.entries(patch) as Array<[keyof AppPreferences, any]>) {
    if ((GLOBAL_FIELDS as readonly string[]).includes(k)) (globalPatch as any)[k] = v;
    else (animalPatch as any)[k] = v;
  }
  store.update(prev => {
    const next: PrefMap = { ...prev };
    if (Object.keys(animalPatch).length) {
      next[id] = { ...branch(prev, id), ...animalPatch };
    }
    if (Object.keys(globalPatch).length) {
      const prevGlobal = prev[GLOBAL_KEY] ?? ({} as AppPreferences);
      next[GLOBAL_KEY] = { ...DEFAULT_PREFERENCES, ...prevGlobal, ...globalPatch };
    }
    return next;
  });
  return getPreferences();
}

export function subscribePreferences(listener: (value: AppPreferences) => void) {
  const emit = () => listener(getPreferences());
  const unsubStore = store.subscribe(emit);
  const unsubAnimal = subscribeAnimal(emit);
  return () => { unsubStore(); unsubAnimal(); };
}

(async function initI18nLocale() {
  try {
    const { setLocale } = await import('../i18n/i18n');
    const i18next = (await import('../i18n')).default;
    const prefs = getPreferences();
    setLocale(prefs.locale);
    i18next.changeLanguage(prefs.locale);
    subscribePreferences(p => {
      setLocale(p.locale);
      i18next.changeLanguage(p.locale);
    });
  } catch {}
})();

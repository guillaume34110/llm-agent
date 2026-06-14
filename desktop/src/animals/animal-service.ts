import { ANIMALS, CODER_PROFILE, DEFAULT_ANIMAL, VANILLA_PROFILE, getAnimal, type AnimalId, type AnimalProfile } from './registry';

const STORAGE_KEY_SELECTED = 'app.selectedAnimal';
const STORAGE_KEY_OWNED = 'app.ownedAnimals';
const STORAGE_KEY_VANILLA = 'app.vanillaMode';
const STORAGE_KEY_CODER = 'app.coderMode';
const LEGACY_KEY_SELECTED = 'monkey.selectedAnimal';
const LEGACY_KEY_OWNED = 'monkey.ownedAnimals';

(function migrateLegacyAnimalKeys() {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!localStorage.getItem(STORAGE_KEY_SELECTED)) {
      const v = localStorage.getItem(LEGACY_KEY_SELECTED);
      if (v) { localStorage.setItem(STORAGE_KEY_SELECTED, v); localStorage.removeItem(LEGACY_KEY_SELECTED); }
    }
    if (!localStorage.getItem(STORAGE_KEY_OWNED)) {
      const v = localStorage.getItem(LEGACY_KEY_OWNED);
      if (v) { localStorage.setItem(STORAGE_KEY_OWNED, v); localStorage.removeItem(LEGACY_KEY_OWNED); }
    }
  } catch {}
})();

type Listener = (animal: AnimalProfile) => void;
const listeners = new Set<Listener>();

function readSelected(): AnimalId {
  try {
    const v = localStorage.getItem(STORAGE_KEY_SELECTED);
    if (v && v in ANIMALS) return v as AnimalId;
  } catch {}
  return DEFAULT_ANIMAL;
}

function readOwned(): Set<AnimalId> {
  const owned = new Set<AnimalId>([DEFAULT_ANIMAL]);
  try {
    const v = localStorage.getItem(STORAGE_KEY_OWNED);
    if (v) {
      for (const id of JSON.parse(v) as string[]) {
        if (id in ANIMALS) owned.add(id as AnimalId);
      }
    }
  } catch {}
  return owned;
}

let currentId: AnimalId = readSelected();

function readVanillaMode(): boolean {
  try { return localStorage.getItem(STORAGE_KEY_VANILLA) === '1'; } catch { return false; }
}

let vanillaMode: boolean = readVanillaMode();

function readCoderMode(): boolean {
  try { return localStorage.getItem(STORAGE_KEY_CODER) === '1'; } catch { return false; }
}

let coderMode: boolean = readCoderMode();

export function isVanillaMode(): boolean {
  return vanillaMode;
}

export function setVanillaMode(on: boolean) {
  vanillaMode = on;
  if (on && coderMode) {
    coderMode = false;
    try { localStorage.setItem(STORAGE_KEY_CODER, '0'); } catch {}
  }
  try { localStorage.setItem(STORAGE_KEY_VANILLA, on ? '1' : '0'); } catch {}
  const a = getCurrentAnimal();
  applyTheme(a);
  for (const fn of listeners) fn(a);
}

export function isCoderMode(): boolean {
  return coderMode;
}

export function setCoderMode(on: boolean) {
  coderMode = on;
  if (on && vanillaMode) {
    vanillaMode = false;
    try { localStorage.setItem(STORAGE_KEY_VANILLA, '0'); } catch {}
  }
  try { localStorage.setItem(STORAGE_KEY_CODER, on ? '1' : '0'); } catch {}
  const a = getCurrentAnimal();
  applyTheme(a);
  for (const fn of listeners) fn(a);
}

export function getCurrentAnimal(): AnimalProfile {
  if (coderMode) return CODER_PROFILE;
  if (vanillaMode) return VANILLA_PROFILE;
  return getAnimal(currentId);
}

// Demonetization (2026-05-25): every animal is free. Ownership is kept as a
// vestigial API for callers but always reports "owned".
export function getOwnedAnimals(): Set<AnimalId> {
  return new Set<AnimalId>(Object.keys(ANIMALS) as AnimalId[]);
}

export function isOwned(_id: AnimalId): boolean {
  return true;
}

export function markOwned(_id: AnimalId) {
  // no-op: nothing to mark, everything is owned.
}

export function setCurrentAnimal(id: AnimalId) {
  if (!(id in ANIMALS)) return;
  currentId = id;
  try { localStorage.setItem(STORAGE_KEY_SELECTED, id); } catch {}
  applyTheme(getAnimal(id));
  for (const fn of listeners) fn(getAnimal(id));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function wrap(h: number): number { return ((h % 360) + 360) % 360; }

function resolvePalette(animal: AnimalProfile): { hue: number; hue2: number; hue3: number } {
  const mode = animal.palette ?? 'bi';
  const h = animal.hue;
  if (mode === 'mono') return { hue: h, hue2: h, hue3: h };
  if (mode === 'tri') {
    const h2 = animal.hue2 ?? wrap(h + 120);
    const h3 = animal.hue3 ?? wrap(h + 240);
    return { hue: h, hue2: h2, hue3: h3 };
  }
  const h2 = animal.hue2 ?? wrap(h + 150);
  return { hue: h, hue2: h2, hue3: animal.hue3 ?? h2 };
}

function applyHexSlot(s: CSSStyleDeclaration, slot: '' | '-2' | '-3', hex: string, isLight: boolean) {
  // Direct hex injection + derived dim/glow/soft via color-mix.
  s.setProperty(`--accent${slot}`, hex);
  s.setProperty(`--accent${slot}-soft`, `color-mix(in srgb, ${hex} 10%, transparent)`);
  s.setProperty(`--accent${slot}-glow`, `color-mix(in srgb, ${hex} 22%, transparent)`);
  if (slot === '') {
    const dimMix = isLight ? 'white' : 'black';
    s.setProperty('--accent-dim', `color-mix(in srgb, ${hex} 75%, ${dimMix})`);
  }
}

function clearHexSlot(s: CSSStyleDeclaration, slot: '' | '-2' | '-3') {
  s.removeProperty(`--accent${slot}`);
  s.removeProperty(`--accent${slot}-soft`);
  s.removeProperty(`--accent${slot}-glow`);
  if (slot === '') s.removeProperty('--accent-dim');
}

export function applyTheme(animal: AnimalProfile) {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  const { hue, hue2, hue3 } = resolvePalette(animal);
  s.setProperty('--accent-hue', String(hue));
  s.setProperty('--accent-hue-2', String(hue2));
  s.setProperty('--accent-hue-3', String(hue3));
  s.setProperty('--accent-chroma-2', String(animal.chroma2 ?? 0.17));
  s.setProperty('--accent-chroma-3', String(animal.chroma3 ?? 0.17));
  document.documentElement.setAttribute('data-tool-style', animal.toolSkin ?? 'card');
  document.documentElement.setAttribute('data-animal', animal.id);
  // Light/dark theme awareness for neutral overrides
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const lightNeutral = isLight ? 'oklch(96% 0.005 0)' : 'oklch(94% 0.005 0)';
  const lightNeutralSoft = isLight ? 'oklch(96% 0.005 0 / 0.18)' : 'oklch(94% 0.005 0 / 0.16)';
  const lightNeutralGlow = isLight ? 'oklch(96% 0.005 0 / 0.28)' : 'oklch(94% 0.005 0 / 0.24)';
  const darkNeutral = isLight ? 'oklch(24% 0.005 0)' : 'oklch(18% 0.005 0)';
  const darkNeutralSoft = isLight ? 'oklch(24% 0.005 0 / 0.18)' : 'oklch(18% 0.005 0 / 0.20)';
  const darkNeutralGlow = isLight ? 'oklch(24% 0.005 0 / 0.28)' : 'oklch(18% 0.005 0 / 0.30)';
  // Primary accent: hex wins if provided. Vanilla: cream on dark (Oreo), milk chocolate on light.
  if (animal.id === VANILLA_PROFILE.id) {
    const vanillaAccent = isLight ? '#6B3E1F' : '#E8D8A8';
    applyHexSlot(s, '', vanillaAccent, isLight);
  } else if (animal.accent) {
    applyHexSlot(s, '', animal.accent, isLight);
  } else {
    clearHexSlot(s, '');
  }
  // Secondary: neutral override > hex > default OKLCH.
  if (animal.neutral2 === 'light') {
    s.setProperty('--accent-2', lightNeutral);
    s.setProperty('--accent-2-soft', lightNeutralSoft);
    s.setProperty('--accent-2-glow', lightNeutralGlow);
  } else if (animal.neutral2 === 'dark') {
    s.setProperty('--accent-2', darkNeutral);
    s.setProperty('--accent-2-soft', darkNeutralSoft);
    s.setProperty('--accent-2-glow', darkNeutralGlow);
  } else if (animal.accent2) {
    applyHexSlot(s, '-2', animal.accent2, isLight);
  } else {
    clearHexSlot(s, '-2');
  }
  if (animal.neutral3 === 'light') {
    s.setProperty('--accent-3', lightNeutral);
    s.setProperty('--accent-3-soft', lightNeutralSoft);
    s.setProperty('--accent-3-glow', lightNeutralGlow);
  } else if (animal.neutral3 === 'dark') {
    s.setProperty('--accent-3', darkNeutral);
    s.setProperty('--accent-3-soft', darkNeutralSoft);
    s.setProperty('--accent-3-glow', darkNeutralGlow);
  } else if (animal.accent3) {
    applyHexSlot(s, '-3', animal.accent3, isLight);
  } else {
    clearHexSlot(s, '-3');
  }
}

// Apply theme at module load so the UI picks up the saved animal immediately.
applyTheme(getCurrentAnimal());

// Kept for API compatibility with existing callers (App.tsx, AnimalPicker).
// Post-demonetization there is no server-side ownership to hydrate.
export async function hydrateOwnedAnimals(): Promise<void> {
  // no-op
}

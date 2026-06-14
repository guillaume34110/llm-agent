// Persona slot: unified "pro persona OR animal" selector.
//
// When a pro is selected, its id replaces the animal id sent to the backend
// (which triggers pack restriction + role overlay in monkey/personas.py) AND
// its skin overrides the animal theme. When cleared, the animal stays the
// source of truth (B2C default).

import { applyTheme as applyAnimalTheme, getCurrentAnimal, subscribe as subscribeAnimal } from '../animals/animal-service';
import { getPro, isProId, type ProId, type ProPersona } from './registry';

const STORAGE_KEY = 'app.selectedPro';

type Listener = (pro: ProPersona | null) => void;
const listeners = new Set<Listener>();

function readStored(): ProId | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY) || '';
    return isProId(v) ? v : null;
  } catch { return null; }
}

let currentProId: ProId | null = readStored();

export function getCurrentPro(): ProPersona | null {
  return currentProId ? getPro(currentProId) : null;
}

/** Backend id: pro id if active, else current animal id. Sent as `animal_id`. */
export function getActivePersonaId(): string {
  return currentProId || getCurrentAnimal().id;
}

export function setCurrentPro(id: ProId | null) {
  if (id && !isProId(id)) return;
  currentProId = id;
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
  applyActiveTheme();
  const pro = getCurrentPro();
  for (const fn of listeners) fn(pro);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function wrap(h: number): number { return ((h % 360) + 360) % 360; }

function applyHexSlot(s: CSSStyleDeclaration, slot: '' | '-2' | '-3', hex: string, isLight: boolean) {
  s.setProperty(`--accent${slot}`, hex);
  s.setProperty(`--accent${slot}-soft`, `color-mix(in srgb, ${hex} 10%, transparent)`);
  s.setProperty(`--accent${slot}-glow`, `color-mix(in srgb, ${hex} 22%, transparent)`);
  if (slot === '') {
    const dimMix = isLight ? 'white' : 'black';
    s.setProperty('--accent-dim', `color-mix(in srgb, ${hex} 75%, ${dimMix})`);
  }
}

function applyProTheme(pro: ProPersona) {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  const mode = pro.palette ?? 'mono';
  const h = pro.hue;
  const h2 = pro.hue2 ?? (mode === 'mono' ? h : wrap(h + 150));
  const h3 = pro.hue3 ?? h2;
  s.setProperty('--accent-hue', String(h));
  s.setProperty('--accent-hue-2', String(h2));
  s.setProperty('--accent-hue-3', String(h3));
  document.documentElement.setAttribute('data-tool-style', pro.toolSkin ?? 'card');
  document.documentElement.setAttribute('data-animal', pro.id);
  document.documentElement.setAttribute('data-pro', pro.id);
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (pro.accent) applyHexSlot(s, '', pro.accent, isLight);
  if (pro.accent2) applyHexSlot(s, '-2', pro.accent2, isLight);
  if (pro.accent3) applyHexSlot(s, '-3', pro.accent3, isLight);
}

function applyActiveTheme() {
  const pro = getCurrentPro();
  if (pro) {
    applyProTheme(pro);
  } else {
    if (typeof document !== 'undefined') {
      document.documentElement.removeAttribute('data-pro');
    }
    applyAnimalTheme(getCurrentAnimal());
  }
}

// React to animal changes while no pro is active.
subscribeAnimal(() => { if (!currentProId) applyActiveTheme(); });

// Apply on module load so persisted pro is honored at boot.
applyActiveTheme();

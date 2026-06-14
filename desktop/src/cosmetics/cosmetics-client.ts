// Cosmetics catalog (skins, profile frames, animals).
// Demonetization (2026-05-25): catalog is bundled and every item is free.
// Animals are surfaced separately via AnimalPicker; this module handles the
// non-animal kinds. Selection is purely local CSS.

export type CosmeticKind = 'animal' | 'skin' | 'profile_frame';

export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  priceCents: number;
  enabled: boolean;
}

const CATALOG: Cosmetic[] = [
  { id: 'monkey',      kind: 'animal',        name: 'MonkeyAgent',     priceCents: 0, enabled: true },
  { id: 'panda',       kind: 'animal',        name: 'Panda',      priceCents: 0, enabled: true },
  { id: 'fox',         kind: 'animal',        name: 'Fox',        priceCents: 0, enabled: true },
  { id: 'cat',         kind: 'animal',        name: 'Cat',        priceCents: 0, enabled: true },
  { id: 'wolf',        kind: 'animal',        name: 'Wolf',       priceCents: 0, enabled: true },
  { id: 'dragon',      kind: 'animal',        name: 'Dragon',     priceCents: 0, enabled: true },
  { id: 'skin-noir',   kind: 'skin',          name: 'Noir',       priceCents: 0, enabled: true },
  { id: 'skin-pastel', kind: 'skin',          name: 'Pastel',     priceCents: 0, enabled: true },
  { id: 'frame-gold',  kind: 'profile_frame', name: 'Gold frame', priceCents: 0, enabled: true },
];

export async function fetchCatalog(): Promise<Cosmetic[]> {
  return CATALOG.slice();
}

export async function fetchOwned(): Promise<string[]> {
  return CATALOG.map(c => c.id);
}

// Local selection state for skin + profile frame. Selecting them only changes
// CSS attributes on <html>.

const STORAGE_SKIN = 'app.selectedSkin';
const STORAGE_FRAME = 'app.selectedFrame';

export function getSelectedSkin(): string | null {
  try { return localStorage.getItem(STORAGE_SKIN); } catch { return null; }
}

export function setSelectedSkin(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_SKIN, id);
    else localStorage.removeItem(STORAGE_SKIN);
  } catch {}
  applyCosmeticAttributes();
}

export function getSelectedFrame(): string | null {
  try { return localStorage.getItem(STORAGE_FRAME); } catch { return null; }
}

export function setSelectedFrame(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_FRAME, id);
    else localStorage.removeItem(STORAGE_FRAME);
  } catch {}
  applyCosmeticAttributes();
}

export function applyCosmeticAttributes() {
  if (typeof document === 'undefined') return;
  const skin = getSelectedSkin();
  const frame = getSelectedFrame();
  if (skin) document.documentElement.setAttribute('data-skin', skin);
  else document.documentElement.removeAttribute('data-skin');
  if (frame) document.documentElement.setAttribute('data-frame', frame);
  else document.documentElement.removeAttribute('data-frame');
}

applyCosmeticAttributes();

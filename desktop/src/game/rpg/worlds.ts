import type { RpgSetupResult } from '../../api';
import type { NodeKind } from './types';
import { seedFrom } from './dice';

// ── Custom worlds (themes the player conjured from free text) ──────────────────
// A generated setup is kept as its own selection vignette so the player can come
// back to it instantly without paying for a regeneration. Stored separately from
// presets (which are hard-coded) and from the active save. Newest first, capped,
// deduped by theme so re-rolling the same prompt refreshes one card. Presets are
// never persisted here — only player-conjured worlds, which is why only these are
// deletable in the UI.
const WORLDS_KEY = 'monkey.rpg.worlds';
const WORLD_CAP = 12;

// A persisted player-conjured world: the full setup plus the decor/hero picked
// for its thumbnail. Numbers (location/hero counts) are read off the setup at
// render time — nothing extra is stored.
export interface CustomWorld {
  id: string;
  theme: string;            // the free-text prompt that conjured it
  setup: RpgSetupResult;    // the generated world (reused verbatim on click)
  decor: NodeKind;          // thumbnail biome
  createdAt: number;        // epoch ms
}

// Pick the most evocative biome present for the card thumbnail (the climactic
// site first), falling back to the first location's kind.
const DECOR_PRIORITY: NodeKind[] = ['dungeon', 'ruin', 'cave', 'forest', 'wild', 'camp', 'town', 'village'];
function pickDecor(setup: RpgSetupResult): NodeKind {
  const kinds = new Set(setup.locations.map(l => l.kind));
  for (const k of DECOR_PRIORITY) if (kinds.has(k)) return k;
  return (setup.locations[0]?.kind as NodeKind) || 'wild';
}

export function loadWorlds(): CustomWorld[] {
  try {
    const raw = localStorage.getItem(WORLDS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(w => w && w.setup && Array.isArray(w.setup.locations)) as CustomWorld[];
  } catch { return []; }
}

// Persist a freshly conjured world as a deletable vignette. Re-rolling the same
// theme replaces its card (dedup by theme) and floats it to the front. Returns
// the updated list so the caller can refresh its state in one step.
export function saveWorld(theme: string, setup: RpgSetupResult): CustomWorld[] {
  const t = theme.trim();
  if (!t) return loadWorlds();
  const fresh: CustomWorld = {
    id: `world:${seedFrom(`${t}:${Date.now()}`)}`,
    theme: t,
    setup,
    decor: pickDecor(setup),
    createdAt: Date.now(),
  };
  const rest = loadWorlds().filter(w => w.theme.toLowerCase() !== t.toLowerCase());
  const merged = [fresh, ...rest].slice(0, WORLD_CAP);
  try { localStorage.setItem(WORLDS_KEY, JSON.stringify(merged)); } catch { /* quota */ }
  return merged;
}

export function deleteWorld(id: string): CustomWorld[] {
  const merged = loadWorlds().filter(w => w.id !== id);
  try { localStorage.setItem(WORLDS_KEY, JSON.stringify(merged)); } catch { /* noop */ }
  return merged;
}

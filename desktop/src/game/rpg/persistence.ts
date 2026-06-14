import type { RpgState } from './types';
import { MORALE_MAX } from './morale';
import { PROV_MAX } from './provisions';
import { TRAITS, TRAIT_IDS } from './traits';
import { seedFrom } from './dice';

// ── Persistence (the active run, in localStorage) ─────────────────────────────
// Local-first: the run state never leaves the device. loadState is forward-compat —
// it backfills every field added after an older save was written, so a save from a
// past build always rehydrates into a playable run rather than crashing.
const SAVE_KEY = 'monkey.rpg.save';

export function saveState(state: RpgState): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

export function loadState(): RpgState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.version !== 1) return null;
    // Backfill fields added after a save was written (forward-compat).
    if (!Array.isArray(s.rumors)) s.rumors = [];
    if (s.dialogue === undefined) s.dialogue = null;
    if (s.phase === 'dialogue' && !s.dialogue) s.phase = 'scene';
    if (!Array.isArray(s.inventory)) s.inventory = [];
    if (typeof s.gold !== 'number') s.gold = 0;
    if (typeof s.ngPlus !== 'number') s.ngPlus = 0;
    if (s.difficulty !== 'easy' && s.difficulty !== 'normal' && s.difficulty !== 'hard') s.difficulty = 'normal';
    if (typeof s.morale !== 'number') s.morale = MORALE_MAX;
    if (s.dicePool === undefined) s.dicePool = null;
    if (typeof s.provisions !== 'number') s.provisions = PROV_MAX;
    if (s.dilemma === undefined) s.dilemma = null;
    if (s.phase === 'dilemma' && !s.dilemma) s.phase = 'scene';
    // Objectives + rivals added 2026-06: a pre-feature save was always a boss-slay
    // run with no competing expeditions. Default accordingly so old saves still win.
    if (s.quest && s.quest.objective === undefined) s.quest.objective = 'slay';
    if (!Array.isArray(s.rivals)) s.rivals = [];
    if (s.rivalEncounter === undefined) s.rivalEncounter = null;
    if (s.phase === 'rival' && !s.rivalEncounter) s.phase = 'scene';
    // Combat is now staged inline on the scene screen (no 'combat' phase). A save
    // written mid-fight under the old screen carried phase==='combat'; drop back to
    // the scene (the live combat object, if any, still drives the inline overlay).
    if (s.phase === 'combat') s.phase = 'scene';
    // Companion traits: back-assign one deterministically (from the member's id) to
    // anyone saved before traits existed. No retro HP for a back-assigned `tough`.
    const backfillTraits = (arr: unknown) => {
      if (Array.isArray(arr)) for (const c of arr) {
        if (c && !c.trait) c.trait = TRAITS[TRAIT_IDS[seedFrom(String(c.id)) % TRAIT_IDS.length]];
      }
    };
    backfillTraits(s.party);
    backfillTraits(s.recruitPool);
    // Scouting added after some saves: a node seen before the feature was fully known,
    // so back-mark any discovered node as scouted (preserves the old "discovered = shown" behaviour).
    if (s.nodes) for (const id in s.nodes) {
      const n = s.nodes[id];
      if (n && n.scouted === undefined) n.scouted = !!n.discovered;
    }
    return s as RpgState;
  } catch { return null; }
}

export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* noop */ }
}

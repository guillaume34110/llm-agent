import type { RpgState } from './types';
import { AFFLICT_MORALE } from './afflictions';
import { adjustMorale } from './morale';

// ── Sanity hallucinations (low-morale flavour; Curious-Expedition-style) ──────
// When the expedition's resolve frays, the mind plays tricks. Mostly pure narration
// (the prize of CE2 atmosphere); a vivid spell may cost a sliver of morale, never HP.
export const HALLUCINATIONS = [
  'A companion swears the trees just whispered their name. No one else heard it.',
  'The shadows at the edge of camp seem to breathe. You blink and they are still.',
  'For a heartbeat the road ahead forks into a dozen roads, then snaps back to one.',
  'Someone counts the party and reaches one more than there should be.',
  'A cold familiar voice calls from behind — but the path back is empty.',
  'The stars rearrange into a face that watches, then scatter when you look twice.',
  'A pack-strap feels like a hand on the shoulder. You do not turn around.',
];
// Roll a hallucination when morale is low. Returns a log line (and may shave morale)
// or null. Mutates state. Kept rare so it unsettles without punishing.
export function maybeHallucinate(state: RpgState, rng: () => number): string | null {
  if (state.morale >= AFFLICT_MORALE) return null;
  const chance = Math.min(0.4, (AFFLICT_MORALE - state.morale) / 120);
  if (rng() >= chance) return null;
  const line = HALLUCINATIONS[Math.floor(rng() * HALLUCINATIONS.length)];
  // A vivid spell (a third of the time) gnaws a little further at resolve.
  if (rng() < 0.34) adjustMorale(state, -2);
  return `A trick of the mind: ${line}`;
}

import { makeRng, seedFrom } from './dice';
import { TRADE_GOODS } from './peoples';
import type { TradeGood } from './peoples';

// ── The Exposition Universelle's featured exhibit (CE2's campaign-level haul) ─
// The hub the party returns to between expeditions is a great Exposition; each
// chapter it features ONE category of treasure (the season's headline gallery).
// A valuable of that category, banked home, is worth a fame premium — the
// campaign-scale echo of the regional prize economy: bring back what the
// Exposition wants this season, not just any haul. Pure + client-owned: the code
// picks the category and owns the bonus; the LLM authors only the gallery's
// flavour from the category handed to it. Deterministic per (campaign, chapter)
// so the same chapter always headlines the same gallery (no save-scumming the
// feature, no drift across a remount).

// The fame premium a featured-category valuable earns when banked at the
// Exposition, over its face worth (player-favourable, floored at the call site).
export const EXHIBIT_BONUS = 0.5;

// The trade good the Exposition headlines for a given campaign chapter. Stable
// for the campaign's life (seeded from its startedAt) yet rotating chapter to
// chapter, so a long campaign cycles through galleries.
export function featuredExhibit(campaignSeed: number, chapter: number): TradeGood {
  const rng = makeRng(seedFrom(`exhibit:${campaignSeed}:${chapter}`));
  return TRADE_GOODS[Math.floor(rng() * TRADE_GOODS.length)];
}

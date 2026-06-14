import type { RpgState } from './types';
import { satchelValue } from './loot';
import { EXHIBIT_BONUS } from './exposition';
import type { TradeGood } from './peoples';

// Worth of the haul toward fame: every carried valuable at face value, plus the
// Exposition's premium on those matching its featured category this chapter
// (CE2's bring-back-the-right-treasure pressure, raised to the campaign). With no
// featured category this is exactly satchelValue (values are integers) — so the
// plain logbook path is unchanged; only a campaign that names a featured gallery
// pays the bonus.
function haulFameValue(state: RpgState, featured?: TradeGood): number {
  if (!featured) return satchelValue(state);
  return (state.inventory || []).reduce((s, i) => {
    if (i.kind !== 'valuable') return s;
    const v = i.value ?? 0;
    const bonus = i.trade === featured ? EXHIBIT_BONUS : 0;
    return s + Math.floor(v * (1 + bonus));
  }, 0);
}

// ── Fame & logbook (light cross-run meta-progression; client-owned) ───────────
// A persistent record of past expeditions and a running Fame score. Fame is PURE
// bragging — it never feeds back into gameplay (no stat/price lever), so it can't
// pay-to-win or snowball difficulty. Victory is the lion's share; even a defeat
// earns a little for what was explored, so every run leaves a mark. All numbers
// are computed here (client-owned) — the LLM authors nothing in the logbook.
export interface LogbookEntry {
  id: string;                        // deterministic per run (idempotent record)
  title: string;                     // the world's title
  theme: string;
  outcome: 'victory' | 'defeat';
  fame: number;                      // fame this run earned
  ngPlus: number;
  heroLevel: number;                 // best hero level reached
  party: string[];                   // member names (display only)
  highlights: string[];             // notable deeds, authored client-side
  ts: number;                        // epoch ms
}
export interface Logbook {
  fame: number;                      // cumulative fame across all recorded runs
  entries: LogbookEntry[];           // newest first, capped
}

const LOGBOOK_KEY = 'monkey.rpg.logbook';
const LOGBOOK_CAP = 30;

// Score an expedition's deeds. Victory carries the bulk; exploration, levels,
// gold, NG+ tier and a flawless finish all add. Returns the fame plus the deed
// strings worth surfacing. Never negative.
export function computeFame(state: RpgState, outcome: 'victory' | 'defeat', featured?: TradeGood): { fame: number; highlights: string[] } {
  const nodes = Object.values(state.nodes);
  const cleared = nodes.filter(n => n.cleared).length;
  const discovered = nodes.filter(n => n.discovered).length;
  const heroLevel = Math.max(1, ...state.party.map(c => c.level));
  const partySize = state.party.length;
  const survivors = state.party.filter(c => c.alive).length;
  const ngPlus = state.ngPlus || 0;
  const highlights: string[] = [];
  let fame = 0;
  if (outcome === 'victory') {
    fame += 100;
    highlights.push(`Completed "${state.quest.title}"`);
    if (survivors === partySize && partySize >= 3) { fame += 40; highlights.push('Brought the whole party home'); }
    // Settling a grudge: winning a run where the returning nemesis was beaten to
    // the prize is worth a fame bump and a callout.
    const nem = (state.rivals || []).find(r => r.nemesis && !r.arrived);
    if (nem) { fame += 25; highlights.push(`Bested your old rival ${nem.name}`); }
  } else {
    highlights.push('Fell in the attempt');
  }
  fame += cleared * 8;
  fame += discovered * 2;
  fame += (heroLevel - 1) * 10;
  fame += ngPlus * 50;
  fame += Math.floor((state.gold || 0) / 20);
  // The haul: valuables carried home are the headline reward (CE2's bring-back-
  // treasure pressure). Lost on a wipe — only a band that walks out keeps its loot.
  const haul = survivors > 0 ? haulFameValue(state, featured) : 0;
  if (haul > 0) {
    fame += Math.floor(haul / 8);
    // Call out the featured gallery only when the band actually carried something
    // the Exposition wanted home (the deed list earns the bonus a line of credit).
    const featuredCarried = !!featured && survivors > 0 &&
      (state.inventory || []).some(i => i.kind === 'valuable' && i.trade === featured);
    highlights.push(featuredCarried
      ? `Hauled home ${haul} in treasures, the season's featured prize among them`
      : `Hauled home ${haul} in treasures`);
  }
  if (cleared > 0) highlights.push(`${cleared} site${cleared > 1 ? 's' : ''} cleared`);
  if (ngPlus > 0) highlights.push(`Reached NG+${ngPlus}`);
  return { fame: Math.max(0, Math.round(fame)), highlights };
}

export function loadLogbook(): Logbook {
  try {
    const raw = localStorage.getItem(LOGBOOK_KEY);
    if (!raw) return { fame: 0, entries: [] };
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.entries)) return { fame: 0, entries: [] };
    return { fame: typeof o.fame === 'number' ? o.fame : 0, entries: o.entries as LogbookEntry[] };
  } catch { return { fame: 0, entries: [] }; }
}

// Persist a whole logbook (used by the Crown-tribute fame faucet, which mints fame
// outside of a run). Swallows quota errors like the other writers here.
export function saveLogbook(book: Logbook): void {
  try { localStorage.setItem(LOGBOOK_KEY, JSON.stringify(book)); } catch { /* quota */ }
}

// Record a finished run. Idempotent per run (deterministic id) so a double-mounted
// end screen can't bank the fame twice. Adds the run's fame to the total and
// prepends the entry (capped). Returns the updated logbook.
export function recordRun(state: RpgState, outcome: 'victory' | 'defeat'): Logbook {
  const book = loadLogbook();
  const id = `run:${state.seed}:${state.ngPlus || 0}:${outcome}`;
  if (book.entries.some(e => e.id === id)) return book; // already banked this run
  const { fame, highlights } = computeFame(state, outcome);
  const entry: LogbookEntry = {
    id, title: state.title, theme: state.theme, outcome, fame,
    ngPlus: state.ngPlus || 0,
    heroLevel: Math.max(1, ...state.party.map(c => c.level)),
    party: state.party.map(c => c.name),
    highlights, ts: Date.now(),
  };
  const updated: Logbook = {
    fame: book.fame + fame,
    entries: [entry, ...book.entries].slice(0, LOGBOOK_CAP),
  };
  saveLogbook(updated);
  return updated;
}

export function clearLogbook(): void {
  try { localStorage.removeItem(LOGBOOK_KEY); } catch { /* noop */ }
}

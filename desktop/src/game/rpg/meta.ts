import type { RpgState, Character, Item, NodeKind, MapSize, Difficulty, SponsorId } from './types';
import { makeRng } from './dice';
import { computeFame, loadLogbook, saveLogbook, type Logbook } from './logbook';
import { featuredExhibit } from './exposition';
import { recordRapport } from './rapport';
import { PEOPLES, type TradeGood } from './peoples';
import { questSatisfied } from './quest';

// ── Hub: the persistent lodge between expeditions (CE2 "Paris" outer loop) ─────
// The step ABOVE adventure creation. Every run returns here, banking its spoils
// into a persistent meta-state that ties isolated runs into one career: a Funds
// bank (the seed of the future club shop), Tickets (milestone premium currency),
// lifetime counters, and a derived Renown rank that climbs forever (semi-endless).
//
// CLIENT-OWNS-NUMBERS: every figure below is computed & clamped here. The LLM
// authors nothing in the hub. LOCAL-FIRST: it lives in localStorage, never the
// server. NO PAY-TO-WIN: Renown is *derived* from cumulative Fame (itself non-
// power bragging), Funds/Tickets are earned only by play and (in later lots) buy
// options/cosmetics/recruit access — never raw stat power.
export interface HubState {
  funds: number;          // banked treasure across runs (the shop currency, lot 2)
  tickets: number;        // premium currency from milestones (victories, new NG+ highs)
  expeditions: number;    // lifetime runs returned (victory or defeat)
  victories: number;      // lifetime wins
  bestNgPlus: number;     // deepest NG+ tier ever cleared
  banked: string[];       // run ids already returned (idempotency guard, capped)
  sponsorXp: Record<SponsorId, number>;  // per-club rank xp (earned by sponsored runs)
  outfits: Record<SponsorId, number>;    // per-club outfitting tier bought (0..SPONSOR_OUTFIT_MAX)
  perks: string[];        // owned perk ids (one earned per victory, renown-gated, lot 3)
  perkRuns: string[];     // run ids that already granted a perk (idempotency guard, capped)
  standing: number;       // lodge standing, earned by fulfilling commissions (lot 4/5)
  contractsFulfilled: number; // lifetime commissions completed (drives story acts)
  boardSeed: number;      // deterministic seed for the current commission board
  activeContract: Contract | null; // the accepted commission (snapshot), or none
  contractRuns: string[]; // run:contract ids already settled (idempotency guard, capped)
  nemesis: Nemesis | null; // a rival who beat you and will return next run (grudge)
}

// A recurring antagonist: the rival expedition that last snatched a prize from you.
// They re-spawn in the NEXT run, tougher, until you beat them to a goal. Cleared on
// any victory where they were present. Client-owned; the LLM authors no field.
export interface Nemesis {
  name: string;   // carried from the rival who won (themable string, but client-set)
  glyph: string;  // their map marker
  wins: number;   // times they have bested you (escalates the grudge flavour)
}

const HUB_KEY = 'monkey.rpg.hub';
const HUB_BANKED_CAP = 100;

// The Renown ladder: cumulative-Fame thresholds → an explorer's standing in the
// lodge. The named rungs are fixed; past the last, Renown keeps climbing with a
// star count (one per RENOWN_STAR_STEP fame) so a career never tops out. Fame is
// the single authority (read from the logbook), so Renown can't drift from it.
const RENOWN_RUNGS: { at: number; name: string }[] = [
  { at: 0, name: 'Novice' },
  { at: 150, name: 'Wayfarer' },
  { at: 400, name: 'Pathfinder' },
  { at: 800, name: 'Trailblazer' },
  { at: 1500, name: 'Explorer' },
  { at: 2600, name: 'Adventurer' },
  { at: 4200, name: 'Renowned' },
  { at: 6500, name: 'Legend' },
];
const RENOWN_STAR_STEP = 3000; // fame per extra star beyond Legend

// Derive the Renown rank from a cumulative Fame total. Returns the rung name,
// its 0-based tier index, a star count (0 until past the top rung), and the fame
// needed for the next step (null once into the open-ended star track is moot —
// there's always a next star, so we surface that threshold too).
export function renownTier(fame: number): { name: string; tier: number; stars: number; next: number | null } {
  const f = Math.max(0, Math.floor(fame));
  let tier = 0;
  for (let i = 0; i < RENOWN_RUNGS.length; i++) if (f >= RENOWN_RUNGS[i].at) tier = i;
  const top = RENOWN_RUNGS[RENOWN_RUNGS.length - 1];
  if (tier < RENOWN_RUNGS.length - 1) {
    return { name: RENOWN_RUNGS[tier].name, tier, stars: 0, next: RENOWN_RUNGS[tier + 1].at };
  }
  // At/above the top rung: count stars and surface the next star threshold.
  const stars = Math.floor((f - top.at) / RENOWN_STAR_STEP);
  const next = top.at + (stars + 1) * RENOWN_STAR_STEP;
  return { name: top.name, tier, stars, next };
}

// Coerce a persisted per-sponsor number map, clamping to the known ids so a
// tampered/old blob can never inject a stray club or a non-number.
function loadSponsorMap(o: unknown, clampMax?: number): Record<SponsorId, number> {
  const out = { pathfinders: 0, armorers: 0, mystics: 0 } as Record<SponsorId, number>;
  if (o && typeof o === 'object') {
    for (const id of SPONSOR_IDS) {
      const v = (o as Record<string, unknown>)[id];
      if (typeof v === 'number' && isFinite(v) && v >= 0) {
        out[id] = clampMax !== undefined ? Math.min(clampMax, Math.floor(v)) : Math.floor(v);
      }
    }
  }
  return out;
}

export function loadHub(): HubState {
  const empty: HubState = {
    funds: 0, tickets: 0, expeditions: 0, victories: 0, bestNgPlus: 0, banked: [],
    sponsorXp: loadSponsorMap(null), outfits: loadSponsorMap(null),
    perks: [], perkRuns: [],
    standing: 0, contractsFulfilled: 0, boardSeed: 1, activeContract: null, contractRuns: [],
    nemesis: null,
  };
  try {
    const raw = localStorage.getItem(HUB_KEY);
    if (!raw) return empty;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return empty;
    return {
      funds: typeof o.funds === 'number' ? o.funds : 0,
      tickets: typeof o.tickets === 'number' ? o.tickets : 0,
      expeditions: typeof o.expeditions === 'number' ? o.expeditions : 0,
      victories: typeof o.victories === 'number' ? o.victories : 0,
      bestNgPlus: typeof o.bestNgPlus === 'number' ? o.bestNgPlus : 0,
      banked: Array.isArray(o.banked) ? o.banked.filter((x: unknown) => typeof x === 'string') : [],
      sponsorXp: loadSponsorMap(o.sponsorXp),
      outfits: loadSponsorMap(o.outfits, SPONSOR_OUTFIT_MAX),
      perks: Array.isArray(o.perks)
        ? o.perks.filter((x: unknown): x is string => typeof x === 'string' && x in PERKS)
        : [],
      perkRuns: Array.isArray(o.perkRuns) ? o.perkRuns.filter((x: unknown) => typeof x === 'string') : [],
      standing: typeof o.standing === 'number' && o.standing >= 0 ? Math.floor(o.standing) : 0,
      contractsFulfilled: typeof o.contractsFulfilled === 'number' && o.contractsFulfilled >= 0 ? Math.floor(o.contractsFulfilled) : 0,
      boardSeed: typeof o.boardSeed === 'number' && isFinite(o.boardSeed) ? Math.floor(o.boardSeed) : 1,
      activeContract: coerceContract(o.activeContract),
      contractRuns: Array.isArray(o.contractRuns) ? o.contractRuns.filter((x: unknown) => typeof x === 'string') : [],
      nemesis: coerceNemesis(o.nemesis),
    };
  } catch { return empty; }
}

// Validate a persisted nemesis blob — string name/glyph and a non-negative win
// count, else none. Keeps a tampered/old blob from injecting a bad grudge.
function coerceNemesis(o: unknown): Nemesis | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name) return null;
  const glyph = typeof r.glyph === 'string' && r.glyph ? r.glyph : '☠';
  const wins = typeof r.wins === 'number' && isFinite(r.wins) && r.wins >= 0 ? Math.floor(r.wins) : 1;
  return { name: r.name, glyph, wins };
}

// Bank a finished run into the hub. Idempotent per run (same id scheme as the
// logbook) so a remounted end screen can't double-bank. Skims the run's gold into
// the persistent Funds bank, bumps lifetime counters, and awards Tickets on
// milestones: +1 per victory, +1 the first time a new NG+ depth is reached.
// Returns the updated hub.
export function recordReturn(state: RpgState, outcome: 'victory' | 'defeat'): HubState {
  const hub = loadHub();
  const id = `run:${state.seed}:${state.ngPlus || 0}:${outcome}`;
  if (hub.banked.includes(id)) return hub; // already returned from this run
  // Bank the goodwill earned with this world's people (monotone-max, idempotent).
  recordRapport(state);
  const ng = state.ngPlus || 0;
  let tickets = hub.tickets;
  if (outcome === 'victory') tickets += 1;
  if (ng > hub.bestNgPlus) tickets += 1; // a new personal depth
  // Credit the backing club's rank xp (CE2: you earn a club's standing only by
  // running its expeditions). A win is worth far more than a flight; deeper NG+ and
  // richer hauls pay a little extra. Unsponsored runs credit nothing. Idempotent via
  // the same `banked` guard as the rest of the return.
  const sponsorXp = { ...hub.sponsorXp };
  const sid = state.sponsor?.id;
  if (sid && SPONSOR_IDS.includes(sid)) {
    const gain = (outcome === 'victory' ? 40 : 10) + Math.floor(Math.max(0, state.gold || 0) / 10) + ng * 15;
    // The club also pays for the haul it covets — favoured valuables brought home.
    sponsorXp[sid] = (sponsorXp[sid] || 0) + gain + sponsorHaulXp(state, sid);
  }
  // Grudge bookkeeping. A defeat where a rival reached the goal first mints (or
  // escalates) a nemesis who returns next run. A victory where the standing nemesis
  // was in the field — and did NOT win — settles the score and clears it.
  let nemesis = hub.nemesis;
  if (outcome === 'defeat') {
    const winner = (state.rivals || []).find(r => r.arrived);
    if (winner) {
      const sameFoe = hub.nemesis && hub.nemesis.name === winner.name;
      nemesis = { name: winner.name, glyph: winner.glyph, wins: sameFoe ? hub.nemesis!.wins + 1 : 1 };
    }
  } else if (outcome === 'victory' && (state.rivals || []).some(r => r.nemesis)) {
    nemesis = null;
  }
  const updated: HubState = {
    funds: hub.funds + Math.max(0, Math.floor(state.gold || 0)),
    tickets,
    expeditions: hub.expeditions + 1,
    victories: hub.victories + (outcome === 'victory' ? 1 : 0),
    bestNgPlus: Math.max(hub.bestNgPlus, ng),
    banked: [id, ...hub.banked].slice(0, HUB_BANKED_CAP),
    sponsorXp,
    outfits: { ...hub.outfits },
    perks: [...hub.perks],
    perkRuns: [...hub.perkRuns],
    standing: hub.standing,
    contractsFulfilled: hub.contractsFulfilled,
    boardSeed: hub.boardSeed,
    activeContract: hub.activeContract,
    contractRuns: [...hub.contractRuns],
    nemesis,
  };
  try { localStorage.setItem(HUB_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  return updated;
}

export function clearHub(): void {
  try { localStorage.removeItem(HUB_KEY); } catch { /* noop */ }
}

// ── Campaign: the one persistent adventure (the step ABOVE a single expedition) ─
// CE2's outer arc made concrete. ONE explorer (chosen once at creation) leads a
// chain of expeditions. The party, its satchel and gold PERSIST between every
// expedition. Fame accrues toward a fixed goal (`goalFame`) — that goal is the
// SCALE for every progress bar (the player's and the rivals'). Reach it → the
// adventure can be FINISHED in triumph. A total wipe FAILS it. Either way the
// player may RESTART a fresh adventure. The chronicle records each chapter so the
// whole run reads as one chronologised saga.
//
// CLIENT-OWNS-NUMBERS: goalFame, fame, every rival score & bar fraction are
// computed here. The LLM authors only the per-world flavour (theme, narration).
// LOCAL-FIRST: the campaign lives in localStorage, never the server. NO PAY-TO-
// WIN: fame stays non-power; the only thing it gates is the triumphant ending.
const CAMPAIGN_KEY = 'monkey.rpg.campaign';
const CAMPAIGN_CHRONICLE_CAP = 60;
// Recruitable companions met per expedition stay deliberately FEW — the party is
// meant to be a tight, persistent band, not a swelling army (CE2 keeps crews small).
export const CAMPAIGN_RECRUIT_CAP = 2;

// The fame finish-line per difficulty — the single scale every progress bar reads
// against. Tuned so a focused run clears it in roughly 5–8 expeditions.
export const CAMPAIGN_GOAL_FAME: Record<Difficulty, number> = {
  easy: 900, normal: 1400, hard: 2100,
};
export function campaignGoalFame(d: Difficulty): number {
  return CAMPAIGN_GOAL_FAME[d] ?? CAMPAIGN_GOAL_FAME.normal;
}
// Roughly how many chapters the rival cast is paced to reach the goal in — sets
// how fast their bars fill (see campaignRace). Not a hard cap on the player.
const CAMPAIGN_PACE_CHAPTERS = 8;

export interface CampaignChapter {
  n: number;                                   // 1-based chapter number (chronology)
  theme: string;                               // the world's theme line
  title: string;                               // the world's title
  outcome: 'victory' | 'fled' | 'fell';        // how the expedition ended
  fameEarned: number;                          // fame this chapter added
  fameTotal: number;                           // campaign fame after this chapter
  ts: number;                                  // epoch ms
}

export interface Campaign {
  v: 1;
  leadClass: string;          // the explorer archetype chosen at creation (persists)
  leadEpithet: string;        // its flavour line (display only)
  difficulty: Difficulty;     // chosen once at creation; every expedition inherits it
  goalFame: number;           // the finish-line (scale for all bars)
  fame: number;               // campaign fame accrued so far
  chapter: number;            // the NEXT chapter number (1-based); = expeditions done + 1
  chronicle: CampaignChapter[];
  party: Character[];         // the persistent band carried between expeditions ([] = build from lead)
  inventory: Item[];          // the persistent satchel
  gold: number;               // the persistent purse
  done: boolean;              // goal reached → the adventure can be finished
  failed: boolean;            // a total wipe ended the band → only a restart remains
  startedAt: number;
}

export function loadCampaign(): Campaign | null {
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    const difficulty: Difficulty = (o.difficulty === 'easy' || o.difficulty === 'hard') ? o.difficulty : 'normal';
    return {
      v: 1,
      leadClass: typeof o.leadClass === 'string' && o.leadClass ? o.leadClass : 'Warrior',
      leadEpithet: typeof o.leadEpithet === 'string' ? o.leadEpithet : '',
      difficulty,
      goalFame: typeof o.goalFame === 'number' && o.goalFame > 0 ? Math.floor(o.goalFame) : campaignGoalFame(difficulty),
      fame: typeof o.fame === 'number' && o.fame >= 0 ? Math.floor(o.fame) : 0,
      chapter: typeof o.chapter === 'number' && o.chapter >= 1 ? Math.floor(o.chapter) : 1,
      chronicle: Array.isArray(o.chronicle) ? o.chronicle.filter((c: unknown) => c && typeof c === 'object') as CampaignChapter[] : [],
      party: Array.isArray(o.party) ? o.party as Character[] : [],
      inventory: Array.isArray(o.inventory) ? o.inventory as Item[] : [],
      gold: typeof o.gold === 'number' && o.gold >= 0 ? Math.floor(o.gold) : 0,
      done: !!o.done,
      failed: !!o.failed,
      startedAt: typeof o.startedAt === 'number' ? o.startedAt : Date.now(),
    };
  } catch { return null; }
}

export function saveCampaign(c: Campaign): void {
  try { localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(c)); } catch { /* quota */ }
}

export function clearCampaign(): void {
  try { localStorage.removeItem(CAMPAIGN_KEY); } catch { /* noop */ }
}

// Open a fresh adventure: lock in the lead explorer + difficulty (both immutable
// for the campaign's life), derive the fame finish-line, and persist. The party
// starts empty — the first expedition builds the lead from the chosen archetype.
export function startCampaign(leadClass: string, leadEpithet: string, difficulty: Difficulty): Campaign {
  const c: Campaign = {
    v: 1, leadClass, leadEpithet, difficulty,
    goalFame: campaignGoalFame(difficulty),
    fame: 0, chapter: 1, chronicle: [], party: [], inventory: [], gold: 0,
    done: false, failed: false, startedAt: Date.now(),
  };
  saveCampaign(c);
  return c;
}

// Fraction of the way to the finish-line (0..1). The scale for the player's bar.
export function campaignProgress(c: Campaign): number {
  if (c.goalFame <= 0) return 0;
  return Math.max(0, Math.min(1, c.fame / c.goalFame));
}

// Bank a finished expedition INTO the campaign. Idempotent per (chapter,seed,outcome)
// so a remounted end screen can't double-bank. Accrues the run's fame toward the
// goal, appends a chronicle entry, and CARRIES the surviving band + satchel + gold
// into the next chapter. A total wipe (no survivors) fails the adventure; reaching
// the goal marks it finishable. Returns the updated campaign.
export function recordChapter(c: Campaign, state: RpgState, outcome: 'victory' | 'defeat'): Campaign {
  const n = c.chapter;
  const last = c.chronicle[0];
  // Guard: same chapter+seed already banked (remount) → no-op.
  if (last && last.n === n && last.title === state.title && last.theme === state.theme) return c;
  const survivors = state.party.filter(ch => ch.alive);
  const ended: CampaignChapter['outcome'] =
    outcome === 'victory' ? 'victory' : survivors.length > 0 ? 'fled' : 'fell';
  // The Exposition's featured gallery this chapter pays a premium on matching
  // valuables banked home (seeded from the campaign, stable per chapter).
  const featured = featuredExhibit(c.startedAt, n);
  const { fame } = computeFame(state, outcome, featured);
  const fameTotal = c.fame + fame;
  const entry: CampaignChapter = {
    n, theme: state.theme, title: state.title, outcome: ended,
    fameEarned: fame, fameTotal, ts: Date.now(),
  };
  // Carry the band fully rested into the next chapter; strip transient combat
  // state. A wipe carries nothing and fails the adventure.
  const carried: Character[] = survivors.map(ch => ({
    ...ch, stats: { ...ch.stats }, hp: ch.maxHp, alive: true, status: undefined, affliction: undefined,
  }));
  const updated: Campaign = {
    ...c,
    fame: fameTotal,
    chapter: n + 1,
    chronicle: [entry, ...c.chronicle].slice(0, CAMPAIGN_CHRONICLE_CAP),
    party: carried,
    // The haul is BANKED on return: valuables were just counted into this chapter's
    // fame (computeFame), so they leave the satchel (CE2's donate-treasure loop) —
    // carrying them on would double-count. Keep potions, gear-boons, trinkets, relic.
    inventory: carried.length ? (state.inventory || []).filter(i => i.kind !== 'valuable').map(i => ({ ...i })) : [],
    gold: carried.length ? Math.max(0, Math.floor(state.gold || 0)) : 0,
    done: fameTotal >= c.goalFame,
    failed: carried.length === 0,
  };
  saveCampaign(updated);
  return updated;
}

// The Great Race, scaled to the GOAL. The rival cast advances with the chapter
// count toward the same finish-line, so every bar (theirs and yours) reads as a
// fraction of goalFame. Pure derivation — nothing extra is stored, nothing is
// authored by the model. Returns rows sorted leader-first plus the shared goal.
export function campaignRace(c: Campaign): { rows: SeasonRow[]; goal: number } {
  const goal = Math.max(1, c.goalFame);
  const step = Math.max(0, c.chapter - 1);              // expeditions completed
  const wob = makeRng((((step + 1) * 2246822519) >>> 0) || 1);
  const rows: SeasonRow[] = SEASON_RIVALS.map(r => {
    // The race opens with EVERYONE at the line — chapter 1 (step 0) is a fresh
    // season, no one has any fame yet. Rivals only pull ahead as expeditions
    // mount; reputation (base) + speed (pace) set how fast, so the strongest
    // approach the goal around CAMPAIGN_PACE_CHAPTERS and laggards trail.
    const frac = (step / CAMPAIGN_PACE_CHAPTERS) * ((r.pace / 80) + (r.base / 400));
    const f = Math.min(goal, Math.max(0, Math.floor(goal * frac + (step > 0 ? (wob() - 0.5) * 60 : 0))));
    return { name: r.name, glyph: r.glyph, fame: f, you: false, nemesis: false, rank: 0 };
  });
  rows.push({ name: 'You', glyph: '◉', fame: Math.min(goal, Math.max(0, c.fame)), you: true, nemesis: false, rank: 0 });
  rows.sort((a, b) => b.fame - a.fame || (a.you ? -1 : b.you ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return { rows, goal };
}
// ── Sponsors / explorer clubs (CE2's outer-loop spine) ────────────────────────
// Three fixed archetypes back your expeditions. Pick one before a run: its boon is
// folded into your starting kit (gold/rations/draughts), scaling with how far you
// have outfitted it in the lodge shop. Running its expeditions earns that club's
// rank xp, which GATES the shop tiers — so investment is per-club, and the natural
// play is to specialise (CE2: be a Patron of one society, an Associate of another).
//
// CLIENT-OWNS-NUMBERS: every figure here (rank thresholds, boon magnitudes, prices)
// is computed & clamped in this file. The LLM may only theme a sponsor's NAME/blurb
// to the conjured world (see RpgSetupResult.sponsors) — never a number. The archetype
// id is a closed whitelist, so a themed reskin can't smuggle in a new club.
// NO PAY-TO-WIN: the shop is bought only with Funds/Tickets earned by PLAY; boons are
// modest, bounded starting nudges (not runaway multipliers), and real money never
// touches them.
export const SPONSOR_IDS: SponsorId[] = ['pathfinders', 'armorers', 'mystics'];
export const SPONSOR_OUTFIT_MAX = 4; // top outfitting tier purchasable per club

export interface SponsorDef {
  id: SponsorId;
  name: string;     // default name (LLM may reskin per world)
  blurb: string;    // what the club is
  boon: string;     // one-line pitch of what sponsoring grants
  glyph: string;    // single-char crest for the UI
  // The trade good this club collects: valuables of this tag, carried home under
  // its banner, add to its rank xp (CE2's clubs-reward-their-own-interests). A
  // thematic split — each club covets a different category, none overlap.
  favours: TradeGood;
}
export const SPONSORS: Record<SponsorId, SponsorDef> = {
  pathfinders: {
    id: 'pathfinders', glyph: '⌖',
    name: "The Pathfinders' League",
    blurb: 'Cartographers and trail-cutters who prize the journey itself.',
    boon: 'surveys the region, revealing extra sites from the outset',
    favours: 'curios',
  },
  armorers: {
    id: 'armorers', glyph: '⚒',
    name: 'The Iron Concord',
    blurb: 'Smiths and quartermasters who fund those who come back laden.',
    boon: 'stakes the expedition a war-chest of starting gold',
    favours: 'craftwork',
  },
  mystics: {
    id: 'mystics', glyph: '✶',
    name: 'The Veiled Circle',
    blurb: 'Scholars of the unseen who arm explorers against the dark.',
    boon: 'blesses the expedition with warding draughts',
    favours: 'relics',
  },
};

// The bonus club rank xp a returning haul earns its backer: valuables of the
// sponsor's favoured category, carried home, at 1 xp per 20 worth (player-fair
// floor). A wiped band brings nothing home (parity with computeFame's haul rule),
// and an unsponsored or unrecognised club earns nothing. Pure + client-owned.
export function sponsorHaulXp(state: RpgState, sid: SponsorId): number {
  const fav = SPONSORS[sid]?.favours;
  if (!fav) return 0;
  if (!state.party.some(c => c.alive)) return 0;
  const worth = (state.inventory || []).reduce(
    (s, i) => s + (i.kind === 'valuable' && i.trade === fav ? (i.value ?? 0) : 0), 0);
  return Math.floor(worth / 20);
}

// Per-club rank ladder (xp → standing). Small fixed thresholds; the rank gates which
// shop tiers are buyable. Six named ranks; xp earned only via that club's runs.
const SPONSOR_RANK_AT = [0, 60, 180, 400, 800, 1400];
const SPONSOR_RANK_NAME = ['Associate', 'Member', 'Fellow', 'Patron', 'Director', 'Luminary'];

// Derive a club's rank from its xp. `tier` is 1-based (Associate = 1). `next` is the
// xp for the next rank, or null at the top.
export function sponsorRank(xp: number): { tier: number; name: string; next: number | null } {
  const x = Math.max(0, Math.floor(xp || 0));
  let i = 0;
  for (let k = 0; k < SPONSOR_RANK_AT.length; k++) if (x >= SPONSOR_RANK_AT[k]) i = k;
  const next = i < SPONSOR_RANK_AT.length - 1 ? SPONSOR_RANK_AT[i + 1] : null;
  return { tier: i + 1, name: SPONSOR_RANK_NAME[i], next };
}

// The boon a sponsor grants at a given outfitting tier (0 = just the base sponsorship,
// up to SPONSOR_OUTFIT_MAX). Each archetype boons a different axis; magnitude is a
// modest base + per-tier step. Pure numbers, applied at world-build.
export function sponsorBoon(id: SponsorId, tier: number): { gold: number; potions: number; scout: number; label: string } {
  const t = Math.max(0, Math.min(SPONSOR_OUTFIT_MAX, Math.floor(tier || 0)));
  switch (id) {
    case 'pathfinders': {
      const scout = 1 + t;
      return { gold: 0, potions: 0, scout, label: `survey +${scout} site${scout > 1 ? 's' : ''}` };
    }
    case 'armorers': {
      const gold = 15 + 20 * t;
      return { gold, potions: 0, scout: 0, label: `+${gold} gold` };
    }
    case 'mystics': {
      const potions = 1 + t;
      return { gold: 0, potions, scout: 0, label: `+${potions} warding draught${potions > 1 ? 's' : ''}` };
    }
  }
}

// The loyalty dividend a club pays for earned RANK (sponsorRank.tier, 1..6) — never
// bought, only earned by running that club's expeditions. It deepens the SAME axis the
// club's outfitting boon already grants (Armorers → gold, Pathfinders → survey, Mystics →
// draughts), so specialising in one society compounds its signature head-start. Modest +
// bounded (no snowball; rank can't be purchased → no pay-to-win): Associate (rank 1) earns
// nothing yet, topping out at +50 gold / +2 sites / +2 draughts at Luminary. Pure numbers,
// added at world-build alongside sponsorBoon. Mirrors sponsorBoon's exhaustive switch.
export function loyaltyBoon(id: SponsorId, rankTier: number): { gold: number; potions: number; scout: number; label: string } {
  const r = Math.max(1, Math.min(SPONSOR_RANK_AT.length, Math.floor(rankTier || 1)));
  const lvl = r - 1;                       // 0 at Associate, up to 5 at Luminary
  switch (id) {
    case 'pathfinders': {
      const scout = Math.floor(lvl / 2);   // 0..2
      return { gold: 0, potions: 0, scout, label: scout ? `survey +${scout} site${scout > 1 ? 's' : ''}` : '' };
    }
    case 'armorers': {
      const gold = 10 * lvl;               // 0..50
      return { gold, potions: 0, scout: 0, label: gold ? `+${gold} gold` : '' };
    }
    case 'mystics': {
      const potions = Math.floor(lvl / 2); // 0..2
      return { gold: 0, potions, scout: 0, label: potions ? `+${potions} warding draught${potions > 1 ? 's' : ''}` : '' };
    }
  }
}

// ── Club signature recruits (CE2 rank-gated hireable stable) ─────────────────
// Each club keeps a small stable of signature recruits, opened by club RANK — the
// reward for specialising in one society over many runs. These are ACCESS, not
// free power: an unlocked recruit merely joins the world's hire pool and must
// still be hired (recruitCost gold) or won over in dialogue. Pure archetypes
// (className drives the stat profile; epithet becomes the recruit's blurb); the
// world generator rolls full Characters from them. Three per club, gated at the
// club's tier 2, 4 and 6 — a fresh club shows the stable but all still locked, and
// the signature capstone only opens at Luminary (tier 6), rewarding a maxed society.
// The pull is to rank the society up, never to pay.
export interface ClubRecruit {
  className: string;  // the archetype hired (keyword drives statProfile)
  epithet: string;    // one-line flavour (becomes the recruit's blurb)
  rankReq: number;    // club rank tier (1-based) that unlocks this recruit
}
export const CLUB_RECRUITS: Record<SponsorId, ClubRecruit[]> = {
  pathfinders: [
    { className: 'Trail Scout', epithet: 'reads the land like a map', rankReq: 2 },
    { className: 'Wayfinder Ranger', epithet: 'never lost, never followed', rankReq: 4 },
    { className: 'Master Archer', epithet: 'one arrow, one horizon', rankReq: 6 },
  ],
  armorers: [
    { className: 'Hired Warrior', epithet: 'paid in steel and scars', rankReq: 2 },
    { className: 'Iron Knight', epithet: 'a wall that walks', rankReq: 4 },
    { className: 'Paladin Captain', epithet: 'leads from the breach', rankReq: 6 },
  ],
  mystics: [
    { className: 'Hedge Witch', epithet: 'mutters to things unseen', rankReq: 2 },
    { className: 'Circle Oracle', epithet: 'speaks what the veil whispers', rankReq: 4 },
    { className: 'Archmage', epithet: 'has read the book that reads back', rankReq: 6 },
  ],
};

// The club recruits a given rank has UNLOCKED (rankTier 1-based). An out-of-range
// club or a rank below the first gate yields none, so an unsponsored or low-rank
// run adds nobody to the hire pool (non-regression with the pre-feature world).
export function unlockedRecruits(id: SponsorId, rankTier: number): ClubRecruit[] {
  const r = Math.max(1, Math.floor(rankTier || 1));
  return (CLUB_RECRUITS[id] || []).filter(rec => r >= rec.rankReq);
}

// What buying the NEXT outfitting tier of a club costs. Funds for the first three,
// a Tickets premium for the top tier (a sink for the milestone currency).
const SPONSOR_OUTFIT_COST: { funds?: number; tickets?: number }[] = [
  {},                 // tier 0: free (the base sponsorship — you have it by picking)
  { funds: 50 },      // tier 1
  { funds: 120 },     // tier 2
  { funds: 250 },     // tier 3
  { tickets: 2 },     // tier 4 (premium)
];

// The next shop offer for a club: the tier you could buy next, its cost, and why it
// might be blocked (already maxed, club rank too low, or you can't afford it). Pure
// read — does not mutate. `affordable` folds rank + funds together for the UI.
export function sponsorOffer(hub: HubState, id: SponsorId): {
  nextTier: number | null;            // null once maxed
  cost: { funds?: number; tickets?: number };
  rankLocked: boolean;                // club rank below the tier
  affordable: boolean;                // rank ok AND enough currency
  preview: { gold: number; potions: number; scout: number; label: string } | null;
} {
  const have = Math.max(0, Math.min(SPONSOR_OUTFIT_MAX, hub.outfits[id] || 0));
  if (have >= SPONSOR_OUTFIT_MAX) {
    return { nextTier: null, cost: {}, rankLocked: false, affordable: false, preview: null };
  }
  const nextTier = have + 1;
  const cost = SPONSOR_OUTFIT_COST[nextTier] || {};
  const rankLocked = sponsorRank(hub.sponsorXp[id] || 0).tier < nextTier;
  const enough = (cost.funds === undefined || hub.funds >= cost.funds) &&
                 (cost.tickets === undefined || hub.tickets >= cost.tickets);
  return {
    nextTier, cost, rankLocked, affordable: !rankLocked && enough,
    preview: sponsorBoon(id, nextTier),
  };
}

// Buy the next outfitting tier of a club. Client-owned, atomic against the persisted
// hub (re-reads, validates rank + funds, deducts, bumps the tier, writes back).
// Returns the updated hub and an `ok` flag; on failure nothing is spent.
export function buySponsorUpgrade(id: SponsorId): { ok: boolean; hub: HubState; reason?: string } {
  const hub = loadHub();
  const offer = sponsorOffer(hub, id);
  if (offer.nextTier === null) return { ok: false, hub, reason: 'maxed' };
  if (offer.rankLocked) return { ok: false, hub, reason: 'rank_locked' };
  if (!offer.affordable) return { ok: false, hub, reason: 'insufficient' };
  const updated: HubState = {
    ...hub,
    funds: hub.funds - (offer.cost.funds || 0),
    tickets: hub.tickets - (offer.cost.tickets || 0),
    sponsorXp: { ...hub.sponsorXp },
    outfits: { ...hub.outfits, [id]: offer.nextTier },
  };
  try { localStorage.setItem(HUB_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  return { ok: true, hub: updated };
}

// ── Perks (CE2's one-reward-per-expedition, fame-gated) ───────────────────────
// CE2 grants a Perk for every successful expedition, and your standing unlocks
// richer ones over a career. Here: a closed catalogue of permanent passives. After
// a VICTORY the lodge offers the perks your Renown has unlocked that you don't yet
// own; you keep one. Their effects fold into the next run's starting kit.
//
// CLIENT-OWNS-NUMBERS: every effect magnitude and the Renown gate are fixed here.
// The LLM authors nothing about perks. LOCAL-FIRST: stored in the hub (localStorage).
// NO PAY-TO-WIN: perks are earned ONLY by winning runs (never bought, never real
// money); each is a small bounded nudge, and perkEffects() caps the aggregate so a
// full collection can't snowball into raw power.
export interface PerkDef {
  id: string;
  name: string;
  blurb: string;
  glyph: string;
  renown: number;   // 0-based renownTier().tier required to be offered this perk
  // `standing` is a flat bonus to the party's starting reputation at every
  // settlement (CE2's "Good Reputation" perk). Bounded by PERK_CAP so a full
  // collection still can't vault a fresh run past the welcomed tier.
  effect: { gold?: number; potions?: number; scout?: number; hp?: number; standing?: number };
}

// Two perks per Renown rung, one effect axis each. Ordered by the renown gate so
// the offer naturally surfaces the cheapest-unlocked first. The upper rungs
// (Explorer/Adventurer) unlock diplomacy — a head-start on local standing.
export const PERKS: Record<string, PerkDef> = {
  prospector:  { id: 'prospector',  glyph: '⛏', renown: 0, name: 'Prospector',   blurb: 'A nose for coin: begin each run a little richer.',      effect: { gold: 25 } },
  herbalist:   { id: 'herbalist',   glyph: '☘', renown: 0, name: 'Herbalist',    blurb: 'You pack a warding draught before setting out.',        effect: { potions: 1 } },
  cartographer:{ id: 'cartographer',glyph: '⌖', renown: 1, name: 'Cartographer', blurb: 'You chart a nearby site before the first step.',        effect: { scout: 1 } },
  hardened:    { id: 'hardened',    glyph: '♥', renown: 1, name: 'Hardened',      blurb: 'Hard miles toughen the lead explorer.',                 effect: { hp: 3 } },
  treasurer:   { id: 'treasurer',   glyph: '◈', renown: 2, name: 'Treasurer',     blurb: 'The lodge stakes a healthier war-chest.',               effect: { gold: 50 } },
  alchemist:   { id: 'alchemist',   glyph: '⚗', renown: 2, name: 'Alchemist',     blurb: 'Two draughts brewed and bottled for the road.',         effect: { potions: 2 } },
  pathwise:    { id: 'pathwise',    glyph: '✦', renown: 3, name: 'Pathwise',      blurb: 'You read the land: two sites known from the outset.',   effect: { scout: 2 } },
  ironhide:    { id: 'ironhide',    glyph: '⛨', renown: 3, name: 'Ironhide',      blurb: 'Scars become armour for the one who leads.',            effect: { hp: 6 } },
  envoy:       { id: 'envoy',       glyph: '✉', renown: 4, name: 'Envoy',         blurb: 'Letters of introduction smooth your arrival in every town.', effect: { standing: 3 } },
  diplomat:    { id: 'diplomat',    glyph: '❖', renown: 5, name: 'Diplomat',      blurb: 'Your reputation precedes you: locals greet you as a friend.', effect: { standing: 5 } },
};
export const PERK_IDS = Object.keys(PERKS);

// Aggregate caps — a full perk collection still can't snowball. Each axis is summed
// across owned perks and clamped here (belt-and-suspenders on top of the small pool).
const PERK_CAP = { gold: 150, potions: 4, scout: 3, hp: 12, standing: 8 } as const;

// Fold a set of owned perk ids into one bounded starting-kit bonus. Unknown ids are
// ignored. Pure: applied at world-build alongside the sponsor boon.
export function perkEffects(perks: string[]): { gold: number; potions: number; scout: number; hp: number; standing: number } {
  const out = { gold: 0, potions: 0, scout: 0, hp: 0, standing: 0 };
  for (const id of perks) {
    const p = PERKS[id];
    if (!p) continue;
    out.gold += p.effect.gold || 0;
    out.potions += p.effect.potions || 0;
    out.scout += p.effect.scout || 0;
    out.hp += p.effect.hp || 0;
    out.standing += p.effect.standing || 0;
  }
  return {
    gold: Math.min(PERK_CAP.gold, out.gold),
    potions: Math.min(PERK_CAP.potions, out.potions),
    scout: Math.min(PERK_CAP.scout, out.scout),
    hp: Math.min(PERK_CAP.hp, out.hp),
    standing: Math.min(PERK_CAP.standing, out.standing),
  };
}

// The perks the lodge can offer right now: unlocked by current Renown and not yet
// owned. Pure read. The end screen shows these as the post-victory choice.
export function perkOffer(hub: HubState, fame: number): PerkDef[] {
  const tier = renownTier(fame).tier;
  return PERK_IDS
    .map(id => PERKS[id])
    .filter(p => p.renown <= tier && !hub.perks.includes(p.id))
    .sort((a, b) => a.renown - b.renown);
}

// Whether this run still has a perk to grant (a victory grants exactly one). Keyed
// by the same run id scheme as the logbook/return, so a remounted end screen can't
// double-grant.
export function perkRunId(state: RpgState): string {
  return `run:${state.seed}:${state.ngPlus || 0}:victory`;
}
export function canClaimPerk(hub: HubState, runId: string): boolean {
  return !hub.perkRuns.includes(runId);
}

const HUB_PERKRUNS_CAP = 100;

// Claim one perk as this run's reward. Atomic against the persisted hub (re-reads,
// validates the run hasn't already paid out and the perk is unlocked + unowned, then
// records both the perk and the run id). Returns the updated hub and an `ok` flag.
export function claimPerk(runId: string, perkId: string, fame: number): { ok: boolean; hub: HubState; reason?: string } {
  const hub = loadHub();
  if (hub.perkRuns.includes(runId)) return { ok: false, hub, reason: 'already_claimed' };
  const perk = PERKS[perkId];
  if (!perk) return { ok: false, hub, reason: 'unknown_perk' };
  if (hub.perks.includes(perkId)) return { ok: false, hub, reason: 'owned' };
  if (perk.renown > renownTier(fame).tier) return { ok: false, hub, reason: 'rank_locked' };
  const updated: HubState = {
    ...hub,
    sponsorXp: { ...hub.sponsorXp },
    outfits: { ...hub.outfits },
    perks: [...hub.perks, perkId],
    perkRuns: [runId, ...hub.perkRuns].slice(0, HUB_PERKRUNS_CAP),
  };
  try { localStorage.setItem(HUB_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  return { ok: true, hub: updated };
}

// ── Commissions / contract board + standing + story acts (lots 4 & 5) ─────────
// CE2's job board: between expeditions the lodge posts commissions — bonus goals
// (win in a given biome, bring everyone home, finish rich, go deeper…) that pay out
// when your NEXT run satisfies them. Fulfilling them raises your lodge STANDING,
// which unlocks harder/richer commissions, and advances a semi-endless STORY of
// numbered acts (CE2's overarching campaign).
//
// CLIENT-OWNS-NUMBERS: the board is generated procedurally & deterministically here
// (every condition, reward, threshold, the standing ladder and act steps are fixed
// in this file). LOCAL-FIRST: the whole campaign lives in the hub (localStorage).
// NO PAY-TO-WIN: rewards are Funds/Tickets/Standing earned by PLAY; standing only
// gates which commissions appear (and the act narrative) — never raw stat power.
// Real money never touches it. Prose here is static client flavour; the LLM authors
// nothing about commissions or acts.

// A commission's win condition — a discriminated union, all checkable from the
// finished RpgState at victory (no extra run state needed).
export type ContractCond =
  | { k: 'win' }
  | { k: 'ngplus'; n: number }
  | { k: 'gold'; n: number }
  | { k: 'flawless' }
  | { k: 'sponsored'; id: SponsorId }
  | { k: 'biome'; kind: NodeKind };

export interface ContractReward { funds: number; tickets: number; standing: number; }

export interface Contract {
  id: string;
  name: string;     // evocative title (templated, client-owned)
  blurb: string;    // what it asks + what it pays
  cond: ContractCond;
  reward: ContractReward;
  tier: number;     // difficulty tier (1..5), gated by standing
}

const HUB_CONTRACTRUNS_CAP = 100;
const CONTRACT_BIOMES: NodeKind[] = ['ruin', 'cave', 'dungeon', 'forest', 'wild'];
const KIND_NOUN: Record<NodeKind, string> = {
  village: 'Village', town: 'Town', wild: 'Wilds', forest: 'Forest',
  dungeon: 'Depths', ruin: 'Ruins', cave: 'Caverns', camp: 'Camp',
};

// Lodge standing ladder (cumulative standing → a named tier). The tier caps the
// hardest commission the board can post. Five named ranks; standing is earned only
// by fulfilling commissions.
const STANDING_AT = [0, 4, 10, 20, 36];
const STANDING_NAME = ['Unproven', 'Trusted', 'Esteemed', 'Honored', 'Exalted'];
export function standingTier(standing: number): { tier: number; name: string; next: number | null } {
  const s = Math.max(0, Math.floor(standing || 0));
  let i = 0;
  for (let k = 0; k < STANDING_AT.length; k++) if (s >= STANDING_AT[k]) i = k;
  const next = i < STANDING_AT.length - 1 ? STANDING_AT[i + 1] : null;
  return { tier: i + 1, name: STANDING_NAME[i], next };
}

// The story spine: a semi-endless run of acts, one advanced every ACT_STEP fulfilled
// commissions. The first few are named; past them it keeps numbering forever.
const ACT_STEP = 3;
const ACTS: { name: string; blurb: string }[] = [
  { name: 'The Opening Road',       blurb: 'A fledgling name takes its first commissions and learns the trade.' },
  { name: 'Rumors and Routes',      blurb: 'Word of your work spreads; richer patrons start to take notice.' },
  { name: 'Into the Unknown',       blurb: 'The easy maps are spent — the lodge sends you past the edges.' },
  { name: 'The Deepening',          blurb: 'Each return is harder won; the stakes and the rewards both climb.' },
  { name: 'Legends in the Making',  blurb: 'Your expeditions are talked of in every hall. The tale runs on.' },
];
export function storyAct(contractsFulfilled: number): {
  act: number; name: string; blurb: string; into: number; step: number; next: number;
} {
  const n = Math.max(0, Math.floor(contractsFulfilled || 0));
  const idx = Math.floor(n / ACT_STEP);
  const named = ACTS[idx];
  return {
    act: idx + 1,
    name: named ? named.name : `Act ${idx + 1}`,
    blurb: named ? named.blurb : 'The expedition\'s tale rolls on — new commissions, deeper stakes.',
    into: n - idx * ACT_STEP,
    step: ACT_STEP,
    next: (idx + 1) * ACT_STEP,
  };
}

// Plain-language statement of a commission's condition (for the blurb + UI).
export function contractCondText(c: ContractCond): string {
  switch (c.k) {
    case 'win': return 'Return victorious from any expedition.';
    case 'ngplus': return `Win at New Game+${c.n} or deeper.`;
    case 'gold': return `Finish a winning run holding at least ${c.n} gold.`;
    case 'flawless': return 'Win without losing a single companion.';
    case 'sponsored': return `Win an expedition backed by ${SPONSORS[c.id].name}.`;
    case 'biome': return `Win an expedition that crosses the ${KIND_NOUN[c.kind]}.`;
  }
}

function contractName(c: ContractCond): string {
  switch (c.k) {
    case 'win': return 'Bring It Home';
    case 'ngplus': return `Descend to NG+${c.n}`;
    case 'gold': return `A Haul of ${c.n} Coin`;
    case 'flawless': return 'Everyone Comes Home';
    case 'sponsored': return `${SPONSORS[c.id].name} Patronage`;
    case 'biome': return `Survey the ${KIND_NOUN[c.kind]}`;
  }
}

// Pick a condition appropriate to the tier (harder tiers pull from harder pools).
function pickCond(rng: () => number, tier: number): ContractCond {
  const pool: ContractCond['k'][] =
    tier <= 1 ? ['win', 'biome'] :
    tier === 2 ? ['biome', 'gold', 'sponsored'] :
    tier === 3 ? ['gold', 'sponsored', 'flawless'] :
    ['flawless', 'ngplus', 'gold'];
  const k = pool[Math.floor(rng() * pool.length)];
  switch (k) {
    case 'biome': return { k: 'biome', kind: CONTRACT_BIOMES[Math.floor(rng() * CONTRACT_BIOMES.length)] };
    case 'gold': return { k: 'gold', n: 40 + 40 * tier };
    case 'sponsored': return { k: 'sponsored', id: SPONSOR_IDS[Math.floor(rng() * SPONSOR_IDS.length)] };
    case 'flawless': return { k: 'flawless' };
    case 'ngplus': return { k: 'ngplus', n: Math.max(1, tier - 2) };
    case 'win': default: return { k: 'win' };
  }
}

function genContract(rng: () => number, seed: number, slot: number, tier: number): Contract {
  const t = Math.max(1, Math.min(5, tier));
  const cond = pickCond(rng, t);
  const reward: ContractReward = {
    funds: 30 + 25 * t,
    tickets: (t >= 3 ? 1 : 0) + (t >= 5 ? 1 : 0),
    standing: t,
  };
  const r = reward.tickets > 0 ? `◈${reward.funds} ✦${reward.tickets}` : `◈${reward.funds}`;
  return {
    id: `c:${seed}:${slot}`,
    name: contractName(cond),
    blurb: `${contractCondText(cond)} Pays ${r} · standing +${reward.standing}.`,
    cond, reward, tier: t,
  };
}

// The current commission board: three slots, generated deterministically from the
// hub's boardSeed, with difficulty capped by standing. Slot 0 is always an easy
// catch-all; the rest scale toward your standing tier. Pure read.
export function contractBoard(hub: HubState): Contract[] {
  const maxTier = standingTier(hub.standing).tier;
  const rng = makeRng((Math.floor(hub.boardSeed || 1) * 2654435761) >>> 0);
  const out: Contract[] = [];
  for (let slot = 0; slot < 3; slot++) {
    const tier = slot === 0 ? 1 : 1 + Math.floor(rng() * maxTier);
    out.push(genContract(rng, Math.floor(hub.boardSeed || 1), slot, tier));
  }
  return out;
}

// Validate a persisted commission (a tampered/old blob can never inject a bad cond
// or unbounded reward). Returns null if unusable.
function coerceContract(o: unknown): Contract | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.blurb !== 'string') return null;
  const cond = coerceCond(r.cond);
  if (!cond) return null;
  const rw = (r.reward && typeof r.reward === 'object' ? r.reward : {}) as Record<string, unknown>;
  const clamp = (v: unknown, max: number) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.min(max, Math.floor(v)) : 0);
  const reward: ContractReward = { funds: clamp(rw.funds, 1000), tickets: clamp(rw.tickets, 10), standing: clamp(rw.standing, 10) };
  const tier = typeof r.tier === 'number' && r.tier >= 1 ? Math.min(9, Math.floor(r.tier)) : 1;
  return { id: r.id.slice(0, 64), name: r.name.slice(0, 64), blurb: r.blurb.slice(0, 200), cond, reward, tier };
}
function coerceCond(o: unknown): ContractCond | null {
  if (!o || typeof o !== 'object') return null;
  const c = o as Record<string, unknown>;
  switch (c.k) {
    case 'win': return { k: 'win' };
    case 'flawless': return { k: 'flawless' };
    case 'ngplus': return typeof c.n === 'number' && c.n >= 1 ? { k: 'ngplus', n: Math.floor(c.n) } : null;
    case 'gold': return typeof c.n === 'number' && c.n >= 0 ? { k: 'gold', n: Math.floor(c.n) } : null;
    case 'sponsored': return typeof c.id === 'string' && SPONSOR_IDS.includes(c.id as SponsorId) ? { k: 'sponsored', id: c.id as SponsorId } : null;
    case 'biome': return typeof c.kind === 'string' && (KIND_NOUN as Record<string, string>)[c.kind] ? { k: 'biome', kind: c.kind as NodeKind } : null;
    default: return null;
  }
}

// Whether a finished (victorious) run satisfies a commission. Pure check.
export function contractMet(c: Contract, state: RpgState): boolean {
  const cond = c.cond;
  switch (cond.k) {
    case 'win': return true;
    case 'ngplus': return (state.ngPlus || 0) >= cond.n;
    case 'gold': return (state.gold || 0) >= cond.n;
    case 'flawless': return state.party.length > 0 && state.party.every(ch => ch.alive);
    case 'sponsored': return state.sponsor?.id === cond.id;
    case 'biome': { const k = cond.kind; return state.order.some(id => state.nodes[id].kind === k); }
  }
}

// Live, mid-run read of how the active commission is tracking. Mirrors contractMet
// but returns a label + a human progress detail + whether it is currently on track
// (it would pay out IF the run were won now). Pure; used by the in-run ledger so the
// player can steer toward the commission. The win cond resolves to questSatisfied
// (the live victory test), every other cond to its own running tally.
export function contractProgress(c: Contract, state: RpgState): { label: string; detail: string; met: boolean } {
  const cond = c.cond;
  switch (cond.k) {
    case 'win': {
      const ok = questSatisfied(state);
      return { label: 'Complete the expedition', detail: ok ? 'objective met' : 'in progress', met: ok };
    }
    case 'ngplus': {
      const ng = state.ngPlus || 0;
      return { label: `Run at NG+${cond.n} or deeper`, detail: `NG+${ng} / NG+${cond.n}`, met: ng >= cond.n };
    }
    case 'gold': {
      const g = Math.max(0, Math.floor(state.gold || 0));
      return { label: `Finish holding ${cond.n} gold`, detail: `${g} / ${cond.n} gold`, met: g >= cond.n };
    }
    case 'flawless': {
      const alive = state.party.filter(ch => ch.alive).length;
      const size = state.party.length;
      return { label: 'Bring everyone home alive', detail: `${alive} / ${size} alive`, met: size > 0 && alive === size };
    }
    case 'sponsored': {
      const ok = state.sponsor?.id === cond.id;
      return { label: `Backed by ${SPONSORS[cond.id].name}`, detail: ok ? 'sponsor confirmed' : 'other backer', met: ok };
    }
    case 'biome': {
      const k = cond.kind;
      const ok = state.order.some(id => state.nodes[id].kind === k);
      return { label: `Visit the ${KIND_NOUN[k]}`, detail: ok ? 'on the map' : 'not on this map', met: ok };
    }
  }
}

// Accept a commission off the current board (only one active at a time). Snapshots
// it into the hub so a later board refresh can't change the deal.
export function acceptContract(id: string): { ok: boolean; hub: HubState; reason?: string } {
  const hub = loadHub();
  if (hub.activeContract) return { ok: false, hub, reason: 'already_active' };
  const c = contractBoard(hub).find(x => x.id === id);
  if (!c) return { ok: false, hub, reason: 'not_found' };
  const updated: HubState = { ...hub, activeContract: c };
  try { localStorage.setItem(HUB_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  return { ok: true, hub: updated };
}

// Drop the active commission (free; you simply forfeit it). Returns the updated hub.
export function abandonContract(): HubState {
  const hub = loadHub();
  const updated: HubState = { ...hub, activeContract: null };
  try { localStorage.setItem(HUB_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  return updated;
}

// Re-roll the board (free). Bumps the seed; an accepted commission is untouched (it's
// a snapshot). Returns the updated hub so the UI can re-render the new board.
export function refreshBoard(): HubState {
  const hub = loadHub();
  const updated: HubState = { ...hub, boardSeed: Math.floor(hub.boardSeed || 1) + 1 };
  try { localStorage.setItem(HUB_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  return updated;
}

// Settle the active commission against a finished run. Pays out (Funds/Tickets/
// Standing), advances the story, clears the commission and rolls a fresh board —
// only on a VICTORY that meets the condition. Idempotent per run+contract via the
// contractRuns guard (a remounted end screen can't double-pay). Returns whether it
// settled, plus the act number before/after so the UI can flag an act advance.
export function settleContract(state: RpgState, outcome: 'victory' | 'defeat'): {
  hub: HubState; settled: boolean; contract?: Contract; reward?: ContractReward; actBefore: number; actAfter: number;
} {
  const hub = loadHub();
  const actBefore = storyAct(hub.contractsFulfilled).act;
  const c = hub.activeContract;
  if (outcome !== 'victory' || !c) return { hub, settled: false, actBefore, actAfter: actBefore };
  const key = `run:${state.seed}:${state.ngPlus || 0}:victory:${c.id}`;
  if (hub.contractRuns.includes(key)) return { hub, settled: false, actBefore, actAfter: actBefore };
  if (!contractMet(c, state)) return { hub, settled: false, actBefore, actAfter: actBefore };
  const updated: HubState = {
    ...hub,
    funds: hub.funds + c.reward.funds,
    tickets: hub.tickets + c.reward.tickets,
    standing: hub.standing + c.reward.standing,
    contractsFulfilled: hub.contractsFulfilled + 1,
    activeContract: null,
    boardSeed: Math.floor(hub.boardSeed || 1) + 1,
    contractRuns: [key, ...hub.contractRuns].slice(0, HUB_CONTRACTRUNS_CAP),
  };
  try { localStorage.setItem(HUB_KEY, JSON.stringify(updated)); } catch { /* quota */ }
  return { hub: updated, settled: true, contract: c, reward: c.reward, actBefore, actAfter: storyAct(updated.contractsFulfilled).act };
}

// ── The King's Court, the Great Race, and the destination board ───────────────
// CE2's main-screen outer loop, in three pieces: bring treasure back to the
// crown (donate Funds → Renown), race a fixed cast of rival explorers across
// the season (a fame leaderboard that advances between runs), and choose WHERE
// the next expedition goes (a procedural destination board whose pick shapes
// the generated world). CLIENT-OWNS-NUMBERS: every figure is computed and
// clamped here — the LLM authors nothing. LOCAL-FIRST: localStorage only.

// Donating to the Crown converts banked Funds into Fame at a fixed rate — the
// player's fame faucet between runs, and a real economic choice against
// outfitting clubs with the same Funds. Fame stays non-power (renown titles and
// race score only), so this can never buy strength.
export const CROWN_DONATION_STEP = 50;     // fixed tribute size, in Funds
export const CROWN_FAME_PER_DONATION = 30; // fame minted per tribute

export function donateToCrown(): {
  ok: boolean; reason?: string; hub: HubState; logbook: Logbook; fameGained: number;
} {
  const hub = loadHub();
  const book = loadLogbook();
  if (hub.funds < CROWN_DONATION_STEP) {
    return { ok: false, reason: 'not enough funds', hub, logbook: book, fameGained: 0 };
  }
  const updatedHub: HubState = { ...hub, funds: hub.funds - CROWN_DONATION_STEP };
  const updatedBook: Logbook = { ...book, fame: book.fame + CROWN_FAME_PER_DONATION };
  try { localStorage.setItem(HUB_KEY, JSON.stringify(updatedHub)); } catch { /* quota */ }
  saveLogbook(updatedBook);
  return { ok: true, hub: updatedHub, logbook: updatedBook, fameGained: CROWN_FAME_PER_DONATION };
}

// Does the Lodge hold something the player can act on RIGHT NOW? Drives the
// top-bar attention badge so the stars button only lights up when there is real
// business inside — not as constant noise. Three genuine "do something" cues:
//   1. a club outfit upgrade you can afford (rank ok AND enough Funds/Tickets),
//   2. no commission running while the board has offers (go pick one to earn),
//   3. enough Funds to pay a tribute to the Crown for fame.
// Pure read of the persisted hub; client-owned like every other number here.
export function lodgeHasActions(hub: HubState): boolean {
  const canOutfit = SPONSOR_IDS.some(id => {
    const o = sponsorOffer(hub, id);
    return o.nextTier !== null && o.affordable;
  });
  const canCommission = !hub.activeContract && contractBoard(hub).length > 0;
  const canTribute = hub.funds >= CROWN_DONATION_STEP;
  return canOutfit || canCommission || canTribute;
}

// The Great Race: a season-long fame contest against a fixed cast of rival
// explorers. Their scores advance deterministically with the player's career
// (one season step per expedition returned, with a seeded wobble), so the
// leaderboard moves between runs and the pressure never stalls. Pure
// derivation — nothing extra is stored, nothing is authored by the model.
const SEASON_RIVALS: { name: string; glyph: string; base: number; pace: number }[] = [
  { name: 'Lady Ashworth',   glyph: 'A', base: 60, pace: 88 },
  { name: 'Professor Quill', glyph: 'Q', base: 30, pace: 72 },
  { name: 'Captain Moreau',  glyph: 'M', base: 90, pace: 61 },
  { name: 'Brother Silas',   glyph: 'S', base: 10, pace: 47 },
];

export interface SeasonRow {
  name: string; glyph: string; fame: number;
  you: boolean; nemesis: boolean; rank: number;
}

export function seasonStandings(hub: HubState, fame: number): SeasonRow[] {
  const step = Math.max(0, Math.floor(hub.expeditions));
  const wob = makeRng((((Math.floor(hub.boardSeed || 1) + step) * 2246822519) >>> 0) || 1);
  // step 0 (no expeditions returned yet) → every rival starts at 0, like you;
  // they only accrue fame as the season's expeditions mount (pace per return).
  const rows: SeasonRow[] = SEASON_RIVALS.map(r => ({
    name: r.name, glyph: r.glyph,
    fame: Math.max(0, Math.floor(r.pace * step + (step > 0 ? wob() * 40 : 0))),
    you: false, nemesis: false, rank: 0,
  }));
  // The standing nemesis rides the board too, parked just above the player —
  // the grudge stays in reach and in sight until it is settled on the field.
  if (hub.nemesis) {
    rows.push({
      name: hub.nemesis.name, glyph: hub.nemesis.glyph,
      fame: Math.max(0, Math.floor(fame)) + 25 + hub.nemesis.wins * 40,
      you: false, nemesis: true, rank: 0,
    });
  }
  rows.push({ name: 'You', glyph: '◉', fame: Math.max(0, Math.floor(fame)), you: true, nemesis: false, rank: 0 });
  rows.sort((a, b) => b.fame - a.fame || (a.you ? -1 : b.you ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// Destination board: WHERE the next expedition goes. Three procedurally minted
// offers (deterministic from the hub's boardSeed + career length, so the board
// rotates after every return). Each offer is a named region with a biome, a
// size and a difficulty; picking one hands its theme line to the world
// generator so the world is built in consequence. The board MIXES with — never
// replaces — the player's own conjured prompts and the preset tales below it.
export interface Destination {
  id: string;
  name: string;        // e.g. "The Ashen Caverns of Vhar"
  hook: string;        // one-line rumor (client template, not LLM)
  theme: string;       // the line handed to the world generator
  decor: NodeKind;     // diorama preview + biome bias
  size: MapSize;
  difficulty: Difficulty;
  // The native people that will live in this destination's world (CE2 regional
  // economy). Fixed on the board so its prize/craft hint is authoritative — the
  // player reads who buys what HERE and picks the run by economy. Threaded into
  // worldgen so the world honours it (worldgen's seed roll can't be predicted from
  // the board, hence a forced id). The board shows two distinct peoples max so the
  // offers feel like different lands.
  peopleId: string;
}

const DEST_ADJ = ['Ashen', 'Sunken', 'Howling', 'Gilded', 'Frozen', 'Verdant', 'Shattered', 'Silent', 'Crimson', 'Forgotten', 'Burning', 'Pale'];
const DEST_OWNERS = ['Vhar', 'Okmund', 'Seralis', 'the Old King', 'Mor Duna', 'Ilvyr', 'the Deep Queen', 'Karthis', 'Belmoor', 'Nharu'];
const DEST_KINDS: NodeKind[] = ['village', 'town', 'wild', 'forest', 'dungeon', 'ruin', 'cave', 'camp'];
const DEST_HOOKS: Record<NodeKind, string> = {
  village: 'A village pleads for help — its letters stopped mid-sentence.',
  town: 'A town of rumors: every tavern swears the prize is real.',
  wild: 'Uncharted wilds. The last survey party never came back.',
  forest: 'A forest that rearranges its paths after dark.',
  dungeon: 'A sealed depth, freshly broken open from the inside.',
  ruin: 'Ruins older than the crown — with freshly looted footprints.',
  cave: 'Caverns that breathe. Locals refuse to guide anyone in.',
  camp: 'A rival camp went silent a week ago. Their claim is up for grabs.',
};

export function destinationBoard(hub: HubState, count = 3): Destination[] {
  const seed = (((Math.floor(hub.boardSeed || 1) * 31 + Math.floor(hub.expeditions)) * 2654435761) >>> 0) || 1;
  const rng = makeRng(seed);
  const sizes: MapSize[] = ['small', 'medium', 'large'];
  const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
  const out: Destination[] = [];
  const used = new Set<NodeKind>();
  const usedPeople = new Set<string>();
  for (let i = 0; i < count; i++) {
    let decor = DEST_KINDS[Math.floor(rng() * DEST_KINDS.length)];
    if (used.has(decor)) decor = DEST_KINDS[(DEST_KINDS.indexOf(decor) + 3) % DEST_KINDS.length];
    used.add(decor);
    const adj = DEST_ADJ[Math.floor(rng() * DEST_ADJ.length)];
    const who = DEST_OWNERS[Math.floor(rng() * DEST_OWNERS.length)];
    const name = `The ${adj} ${KIND_NOUN[decor]} of ${who}`;
    const size = sizes[Math.floor(rng() * sizes.length)];
    // Slot 0 stays approachable; later slots may run hard.
    const difficulty: Difficulty = i === 0 ? (rng() < 0.5 ? 'easy' : 'normal') : diffs[Math.floor(rng() * diffs.length)];
    // Pin the locals, biasing toward a people not yet on the board so the offers
    // feel like different lands with different buyers.
    let people = PEOPLES[Math.floor(rng() * PEOPLES.length)];
    if (usedPeople.has(people.id)) people = PEOPLES[(PEOPLES.indexOf(people) + 1 + Math.floor(rng() * (PEOPLES.length - 1))) % PEOPLES.length];
    usedPeople.add(people.id);
    out.push({
      id: `dest:${seed}:${i}`, name, hook: DEST_HOOKS[decor],
      theme: `${name} — ${DEST_HOOKS[decor]}`,
      decor, size, difficulty, peopleId: people.id,
    });
  }
  return out;
}

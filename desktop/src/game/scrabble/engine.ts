// Heads-up (you vs LLM) Scrabble engine. Pure client-side: the client owns EVERY
// number — tile bag, shuffle, racks, board, placement geometry, premium squares,
// scoring, bingo bonus, end-game. The LLM is ONLY the lexicon oracle (is this a
// word in language X?) and the opponent's move proposer; it never emits a score
// or a tile count. Word validity is resolved OUTSIDE the engine (an async LLM
// call): the engine computes the formed words + geometry, the console asks the
// model to judge them, then commits. Local-first: state lives on the client.

import {
  type Lang, type Premium, BOARD_SIZE, CENTER,
  bagLetters, letterPoints, buildPremiums,
} from './data';

export interface Tile { letter: string; points: number; blank: boolean }
export interface Cell { tile: Tile | null; premium: Premium }
export type Seat = 'you' | 'cpu';

// A tentative or committed placement of one rack tile onto an empty board cell.
export interface Placement { r: number; c: number; tile: Tile }

export interface FormedWord { word: string; cells: { r: number; c: number }[] }

export interface ScrabbleState {
  lang: Lang;
  board: Cell[][];
  bag: Tile[];
  rackYou: Tile[];
  rackCpu: Tile[];
  scoreYou: number;
  scoreCpu: number;
  toAct: Seat;
  firstMove: boolean;
  passStreak: number;     // consecutive pass/exchange turns — 4 ends the game (deadlock)
  over: boolean;
  message: string;
  log: string[];
  turnNo: number;
}

const RACK_SIZE = 7;

// ── Setup ──────────────────────────────────────────────────────────────────────

export function newGame(lang: Lang, rng: () => number = () => Math.random()): ScrabbleState {
  const premiums = buildPremiums();
  const board: Cell[][] = premiums.map(row => row.map(p => ({ tile: null, premium: p })));
  const bag = shuffle(bagLetters(lang).map(l => makeTile(lang, l)), rng);
  const s: ScrabbleState = {
    lang, board, bag,
    rackYou: [], rackCpu: [],
    scoreYou: 0, scoreCpu: 0,
    toAct: 'you', firstMove: true, passStreak: 0, over: false,
    message: 'Your move — place tiles, then PLAY.', log: [],
    turnNo: 1,
  };
  refill(s, 'you');
  refill(s, 'cpu');
  s.log.push(`New game (${lang.toUpperCase()}). You start.`);
  return s;
}

function makeTile(lang: Lang, letter: string): Tile {
  if (letter === '') return { letter: '', points: 0, blank: true };
  return { letter, points: letterPoints(lang, letter), blank: false };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rack(s: ScrabbleState, seat: Seat): Tile[] { return seat === 'you' ? s.rackYou : s.rackCpu; }

function refill(s: ScrabbleState, seat: Seat) {
  const r = rack(s, seat);
  while (r.length < RACK_SIZE && s.bag.length) r.push(s.bag.pop()!);
}

// ── Placement geometry + word extraction ────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  error?: string;
  words: FormedWord[];   // all words formed (length >= 2), main first
  score: number;         // total score if these words are accepted
  bingo: boolean;        // all 7 tiles placed → +50
}

// Validate the GEOMETRY of a set of tentative placements against the current board
// and compute the words they form + the score. Does NOT check the dictionary — the
// caller does that via the LLM, then commits. Pure (no mutation).
export function validatePlacement(s: ScrabbleState, placements: Placement[]): ValidationResult {
  const empty: ValidationResult = { ok: false, words: [], score: 0, bingo: false };
  if (!placements.length) return { ...empty, error: 'no tiles placed' };

  // No overlap with existing tiles or duplicate cells.
  const seen = new Set<string>();
  for (const p of placements) {
    const k = `${p.r},${p.c}`;
    if (seen.has(k)) return { ...empty, error: 'two tiles on one square' };
    seen.add(k);
    if (p.r < 0 || p.r >= BOARD_SIZE || p.c < 0 || p.c >= BOARD_SIZE) return { ...empty, error: 'off board' };
    if (s.board[p.r][p.c].tile) return { ...empty, error: 'square occupied' };
  }

  // Must be a single line (all same row OR all same col).
  const rows = new Set(placements.map(p => p.r));
  const cols = new Set(placements.map(p => p.c));
  const single = placements.length === 1;
  let dir: 'H' | 'V';
  if (single) dir = 'H'; // resolved below by which neighbour exists
  else if (rows.size === 1) dir = 'H';
  else if (cols.size === 1) dir = 'V';
  else return { ...empty, error: 'tiles must be in one line' };

  // Merged occupant lookup (existing tiles + tentative placements).
  const place = new Map<string, Tile>();
  for (const p of placements) place.set(`${p.r},${p.c}`, p.tile);
  const at = (r: number, c: number): Tile | null => {
    if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
    return place.get(`${r},${c}`) ?? s.board[r][c].tile;
  };

  // First move: must cover the centre star.
  if (s.firstMove) {
    if (!placements.some(p => p.r === CENTER && p.c === CENTER)) {
      return { ...empty, error: 'first word must cross the centre' };
    }
  }

  // Build the word(s). For a single tile, choose the orientation that yields a
  // length>=2 word for the "main"; the perpendicular becomes a cross word.
  const newCells = new Set(placements.map(p => `${p.r},${p.c}`));
  const words: FormedWord[] = [];

  const extract = (r: number, c: number, d: 'H' | 'V'): FormedWord => {
    const dr = d === 'V' ? 1 : 0;
    const dc = d === 'H' ? 1 : 0;
    let sr = r, sc = c;
    while (at(sr - dr, sc - dc)) { sr -= dr; sc -= dc; }
    const cells: { r: number; c: number }[] = [];
    let word = '';
    let cr = sr, cc = sc;
    while (at(cr, cc)) {
      const t = at(cr, cc)!;
      word += t.blank ? t.letter : t.letter; // blank carries its chosen letter
      cells.push({ r: cr, c: cc });
      cr += dr; cc += dc;
    }
    return { word, cells };
  };

  if (single) {
    const p = placements[0];
    const h = extract(p.r, p.c, 'H');
    const v = extract(p.r, p.c, 'V');
    if (h.word.length >= 2) { words.push(h); dir = 'H'; }
    if (v.word.length >= 2) { words.push(v); }
    if (!words.length) {
      // Isolated single tile (only legal as the very first move, which needs >=2).
      return { ...empty, error: 'word must be at least 2 letters' };
    }
  } else {
    const main = extract(placements[0].r, placements[0].c, dir);
    // Every placement must lie within the contiguous main word (no gaps).
    for (const p of placements) {
      if (!main.cells.some(c => c.r === p.r && c.c === p.c)) {
        return { ...empty, error: 'tiles are not contiguous' };
      }
    }
    if (main.word.length >= 2) words.push(main);
    const perp = dir === 'H' ? 'V' : 'H';
    for (const p of placements) {
      const cw = extract(p.r, p.c, perp);
      if (cw.word.length >= 2) words.push(cw);
    }
    if (!words.length) return { ...empty, error: 'no word formed' };
  }

  // Connection: after the first move, at least one formed word must include a
  // pre-existing tile (a hook), otherwise the play floats unattached.
  if (!s.firstMove) {
    const touches = words.some(w => w.cells.some(c => !newCells.has(`${c.r},${c.c}`)));
    if (!touches) return { ...empty, error: 'word must connect to the board' };
  }

  // Score: premiums apply only to tiles placed THIS turn.
  let total = 0;
  for (const w of words) {
    let wordScore = 0;
    let wordMult = 1;
    for (const cell of w.cells) {
      const t = at(cell.r, cell.c)!;
      let pts = t.points;
      if (newCells.has(`${cell.r},${cell.c}`)) {
        const prem = s.board[cell.r][cell.c].premium;
        if (prem === 'DL') pts *= 2;
        else if (prem === 'TL') pts *= 3;
        else if (prem === 'DW') wordMult *= 2;
        else if (prem === 'TW') wordMult *= 3;
      }
      wordScore += pts;
    }
    total += wordScore * wordMult;
  }
  const bingo = placements.length === RACK_SIZE;
  if (bingo) total += 50;

  return { ok: true, words, score: total, bingo };
}

// ── Commit / turn actions ────────────────────────────────────────────────────────

// Apply a validated, dictionary-approved play: drop the tiles, add the score, remove
// the used tiles from the rack, refill, swap turn. Returns a new state (clones).
export function commitPlacement(prev: ScrabbleState, seat: Seat, placements: Placement[], score: number, words: FormedWord[]): ScrabbleState {
  const s = clone(prev);
  for (const p of placements) {
    s.board[p.r][p.c] = { ...s.board[p.r][p.c], tile: { ...p.tile } };
  }
  // Remove the played tiles from the rack (match a blank tile for a blank placement,
  // else the exact letter).
  const r = rack(s, seat);
  for (const p of placements) {
    const idx = p.tile.blank
      ? r.findIndex(t => t.blank)
      : r.findIndex(t => !t.blank && t.letter === p.tile.letter);
    if (idx >= 0) r.splice(idx, 1);
  }
  addScore(s, seat, score);
  refill(s, seat);
  s.firstMove = false;
  s.passStreak = 0;
  const who = seat === 'you' ? 'You' : 'Opponent';
  const main = words[0]?.word ?? '';
  s.log.push(`${who} played ${main.toUpperCase()} for ${score}.`);
  endTurn(s, seat);
  return s;
}

// Pass (no move). Two passes each (streak 4) ends the game.
export function passTurn(prev: ScrabbleState, seat: Seat): ScrabbleState {
  const s = clone(prev);
  s.passStreak += 1;
  s.log.push(`${seat === 'you' ? 'You' : 'Opponent'} passed.`);
  if (s.passStreak >= 4) return finishGame(s, 'deadlock');
  endTurn(s, seat);
  return s;
}

// Exchange tiles: return chosen tiles to the bag, draw replacements. Only legal when
// the bag still holds at least a full rack.
export function exchangeTiles(prev: ScrabbleState, seat: Seat, tileIdx: number[]): ScrabbleState {
  const s = clone(prev);
  if (s.bag.length < RACK_SIZE) { return passTurn(prev, seat); }
  const r = rack(s, seat);
  const give = tileIdx.filter(i => i >= 0 && i < r.length).sort((a, b) => b - a);
  const returned: Tile[] = [];
  for (const i of give) returned.push(r.splice(i, 1)[0]);
  refill(s, seat);
  for (const t of returned) s.bag.push(t);
  s.bag = shuffle(s.bag, () => Math.random());
  s.passStreak += 1;
  s.log.push(`${seat === 'you' ? 'You' : 'Opponent'} exchanged ${returned.length}.`);
  if (s.passStreak >= 4) return finishGame(s, 'deadlock');
  endTurn(s, seat);
  return s;
}

function endTurn(s: ScrabbleState, seat: Seat) {
  // Out-of-tiles end: a player emptied their rack and the bag is empty.
  if (s.bag.length === 0 && rack(s, seat).length === 0) {
    finishGame(s, 'out');
    return;
  }
  s.toAct = seat === 'you' ? 'cpu' : 'you';
  s.turnNo += 1;
  s.message = s.toAct === 'you' ? 'Your move.' : 'Opponent is thinking…';
}

// End the game and settle leftover-rack penalties (standard rules).
function finishGame(s: ScrabbleState, reason: 'out' | 'deadlock'): ScrabbleState {
  const leftYou = s.rackYou.reduce((a, t) => a + t.points, 0);
  const leftCpu = s.rackCpu.reduce((a, t) => a + t.points, 0);
  if (reason === 'out') {
    // The player who went out gets the opponent's remaining tile points; the other
    // loses their own.
    if (s.rackYou.length === 0) { s.scoreYou += leftCpu; s.scoreCpu -= leftCpu; }
    else { s.scoreCpu += leftYou; s.scoreYou -= leftYou; }
  } else {
    s.scoreYou -= leftYou;
    s.scoreCpu -= leftCpu;
  }
  s.over = true;
  const winner = s.scoreYou === s.scoreCpu ? 'tie' : s.scoreYou > s.scoreCpu ? 'you' : 'cpu';
  s.message = winner === 'tie' ? `Game over — tie ${s.scoreYou}-${s.scoreCpu}.`
    : winner === 'you' ? `Game over — you win ${s.scoreYou}-${s.scoreCpu}!`
    : `Game over — opponent wins ${s.scoreCpu}-${s.scoreYou}.`;
  s.log.push(s.message);
  return s;
}

function addScore(s: ScrabbleState, seat: Seat, n: number) { if (seat === 'you') s.scoreYou += n; else s.scoreCpu += n; }

// ── Opponent move helpers (used by the console with the LLM proposer) ────────────

// Fog-limited view handed to the LLM opponent: its OWN rack + the board, never the
// human's rack or the bag contents.
export interface ScrabbleView {
  lang: Lang;
  rack: string[];        // cpu rack letters ('_' = blank)
  board: string[];       // 15 strings, '.' = empty cell
  scoreCpu: number;
  scoreYou: number;
  bagLeft: number;
  firstMove: boolean;
}

export function cpuView(s: ScrabbleState): ScrabbleView {
  return {
    lang: s.lang,
    rack: s.rackCpu.map(t => (t.blank ? '_' : t.letter)),
    board: s.board.map(row => row.map(c => (c.tile ? c.tile.letter : '.')).join('')),
    scoreCpu: s.scoreCpu,
    scoreYou: s.scoreYou,
    bagLeft: s.bag.length,
    firstMove: s.firstMove,
  };
}

// Turn an LLM proposal {word,row,col,dir} into concrete placements using the cpu
// rack (resolving blanks for letters the rack lacks). Returns null if the proposal
// is geometrically impossible or the rack can't supply the tiles → caller falls
// back to exchange/pass. The board's existing letters act as hooks (skipped, not
// re-placed). The CALLER still runs validatePlacement + the dictionary check.
export function cpuPlacements(s: ScrabbleState, word: string, row: number, col: number, dir: 'H' | 'V'): Placement[] | null {
  const w = (word || '').toUpperCase().replace(/[^A-ZÀ-Ÿ]/g, '');
  if (!w || row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
  const dr = dir === 'V' ? 1 : 0;
  const dc = dir === 'H' ? 1 : 0;
  const available = [...s.rackCpu];
  const placements: Placement[] = [];
  let r = row, c = col;
  for (const ch of w) {
    if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) return null;
    const existing = s.board[r][c].tile;
    if (existing) {
      if (existing.letter.toUpperCase() !== ch) return null; // hook mismatch
    } else {
      let idx = available.findIndex(t => !t.blank && t.letter.toUpperCase() === ch);
      let tile: Tile;
      if (idx >= 0) { tile = available.splice(idx, 1)[0]; }
      else {
        idx = available.findIndex(t => t.blank);
        if (idx < 0) return null; // rack can't supply this letter
        available.splice(idx, 1);
        tile = { letter: ch, points: 0, blank: true };
      }
      placements.push({ r, c, tile });
    }
    r += dr; c += dc;
  }
  if (!placements.length) return null; // entirely overlapping existing tiles
  return placements;
}

// Deterministic fallback when the LLM can't produce a legal play: exchange the whole
// rack if the bag allows, else pass. Always legal — the game never stalls.
export function cpuFallback(s: ScrabbleState): ScrabbleState {
  if (s.bag.length >= RACK_SIZE) {
    return exchangeTiles(s, 'cpu', s.rackCpu.map((_, i) => i));
  }
  return passTurn(s, 'cpu');
}

// Words formed by a placement, as plain strings (for the dictionary check).
export function wordStrings(words: FormedWord[]): string[] {
  return words.map(w => w.word.toUpperCase());
}

function clone(s: ScrabbleState): ScrabbleState {
  return {
    ...s,
    board: s.board.map(row => row.map(c => ({ tile: c.tile ? { ...c.tile } : null, premium: c.premium }))),
    bag: s.bag.map(t => ({ ...t })),
    rackYou: s.rackYou.map(t => ({ ...t })),
    rackCpu: s.rackCpu.map(t => ({ ...t })),
    log: [...s.log],
  };
}

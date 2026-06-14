// Heads-up (1 vs 1) No-Limit Texas Hold'em engine. Pure client-side: the client
// owns EVERY number — deck, shuffle, blinds, pot, stacks, betting legality, hand
// ranking, win/loss. The LLM never emits a chip amount; it only picks ONE action
// token from the exact legal list we hand it (mirrors the chess legal-SAN list).
// Local-first: state lives on the client, the server sees only a fog-limited view
// (cpu hole cards + board + pot + legal tokens) when it picks the opponent action.

export type Suit = 's' | 'h' | 'd' | 'c';
export interface Card { rank: number; suit: Suit } // rank 2..14 (14 = ace)
export type Seat = 'you' | 'cpu';
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'done';

// Action tokens — the discrete legal set, mirror of chess SAN. Raise sizings are
// NAMED (the client maps each to a clamped chip amount); the model only picks a
// word, never a number.
export type ActionToken =
  | 'fold'
  | 'check'
  | 'call'
  | 'raise_half'
  | 'raise_pot'
  | 'all_in';

export interface PokerState {
  deck: Card[];          // remaining undealt cards
  board: Card[];         // community cards (0,3,4,5)
  holeYou: Card[];
  holeCpu: Card[];
  stackYou: number;
  stackCpu: number;
  potCommitted: number;  // chips banked from prior closed streets
  betYou: number;        // chips wagered in front this street
  betCpu: number;
  button: Seat;          // dealer / small blind (alternates each hand)
  toAct: Seat;
  street: Street;
  actedYou: boolean;     // has acted at least once this street
  actedCpu: boolean;
  lastRaise: number;     // min legal raise increment this street
  blind: number;         // big blind size
  handNo: number;
  handOver: boolean;
  revealCpu: boolean;    // show opponent's hole cards (showdown only)
  result: HandResult | null;
  message: string;       // short status line
  log: string[];         // play-by-play (newest last)
}

export interface HandResult {
  winner: Seat | 'split';
  reason: 'fold' | 'showdown';
  pot: number;
  youName?: string;
  cpuName?: string;
}

// Fog-limited snapshot handed to the opponent picker (server/LLM). Never includes
// the human's hole cards — the model plays blind to them, like a real opponent.
export interface PokerView {
  hole: string[];        // cpu's own two cards, e.g. ["Ah","Kd"]
  board: string[];       // community cards revealed so far
  street: Street;
  pot: number;           // total pot incl. live bets
  toCall: number;        // chips the cpu must put in to call
  stackCpu: number;
  stackYou: number;
  blind: number;
}

const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
const START_STACK = 200;
const BIG_BLIND = 2;

const RANK_LABEL: Record<number, string> = {
  14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: 'T',
  9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
};

export function cardCode(c: Card): string { return `${RANK_LABEL[c.rank]}${c.suit}`; }

function freshDeck(rng: () => number): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ rank: r, suit: s });
  // Fisher-Yates
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ── New game / new hand ──────────────────────────────────────────────────────

export function newGame(): PokerState {
  const s: PokerState = {
    deck: [], board: [], holeYou: [], holeCpu: [],
    stackYou: START_STACK, stackCpu: START_STACK,
    potCommitted: 0, betYou: 0, betCpu: 0,
    button: 'you', toAct: 'you', street: 'preflop',
    actedYou: false, actedCpu: false, lastRaise: BIG_BLIND,
    blind: BIG_BLIND, handNo: 0, handOver: false, revealCpu: false,
    result: null, message: '', log: [],
  };
  return dealHand(s, () => Math.random());
}

// Start a new hand: rotate the button, post blinds, deal hole cards. Keeps stacks.
export function dealHand(prev: PokerState, rng: () => number = () => Math.random()): PokerState {
  // Match over when someone is broke — caller restarts via newGame.
  const button: Seat = prev.handNo === 0 ? prev.button : (prev.button === 'you' ? 'cpu' : 'you');
  const deck = freshDeck(rng);
  const holeYou = [deck.pop()!, deck.pop()!];
  const holeCpu = [deck.pop()!, deck.pop()!];
  const s: PokerState = {
    deck, board: [], holeYou, holeCpu,
    stackYou: prev.stackYou, stackCpu: prev.stackCpu,
    potCommitted: 0, betYou: 0, betCpu: 0,
    button, toAct: button, street: 'preflop',
    actedYou: false, actedCpu: false, lastRaise: BIG_BLIND,
    blind: BIG_BLIND, handNo: prev.handNo + 1, handOver: false, revealCpu: false,
    result: null, message: '', log: [],
  };
  // Heads-up blinds: button posts the small blind and acts first preflop.
  const sb = Math.min(Math.floor(BIG_BLIND / 2) || 1, sStack(s, button));
  const bbSeat: Seat = button === 'you' ? 'cpu' : 'you';
  const bb = Math.min(BIG_BLIND, sStack(s, bbSeat));
  postBlind(s, button, sb);
  postBlind(s, bbSeat, bb);
  s.message = button === 'you' ? 'Your turn — preflop.' : 'Opponent to act…';
  s.log.push(`Hand #${s.handNo} — you are ${button === 'you' ? 'button (SB)' : 'big blind'}.`);
  return s;
}

function sStack(s: PokerState, seat: Seat): number { return seat === 'you' ? s.stackYou : s.stackCpu; }
function addStack(s: PokerState, seat: Seat, d: number) { if (seat === 'you') s.stackYou += d; else s.stackCpu += d; }
function addBet(s: PokerState, seat: Seat, d: number) { if (seat === 'you') s.betYou += d; else s.betCpu += d; }
function getBet(s: PokerState, seat: Seat): number { return seat === 'you' ? s.betYou : s.betCpu; }

function postBlind(s: PokerState, seat: Seat, amt: number) {
  addStack(s, seat, -amt);
  addBet(s, seat, amt);
}

// ── Legal actions ─────────────────────────────────────────────────────────────

export function pot(s: PokerState): number { return s.potCommitted + s.betYou + s.betCpu; }
export function toCall(s: PokerState, seat: Seat): number {
  const opp: Seat = seat === 'you' ? 'cpu' : 'you';
  return Math.max(0, getBet(s, opp) - getBet(s, seat));
}

// Map a raise sizing token to the TOTAL "raise to" chip target for this street,
// clamped to a legal min-raise and to the all-in ceiling. Returns null when the
// sizing collapses to an existing option (deduped by the caller).
function raiseTarget(s: PokerState, seat: Seat, frac: number): number {
  const opp: Seat = seat === 'you' ? 'cpu' : 'you';
  const oppBet = getBet(s, opp);
  const myBet = getBet(s, seat);
  const call = Math.max(0, oppBet - myBet);
  const potAfterCall = pot(s) + call;
  const sizeRaw = Math.round(potAfterCall * frac);
  const minInc = Math.max(s.blind, s.lastRaise);
  const target = oppBet + Math.max(minInc, sizeRaw);
  const ceil = myBet + sStack(s, seat); // all-in
  return Math.min(target, ceil);
}

export function legalActions(s: PokerState, seat: Seat): ActionToken[] {
  if (s.handOver || s.street === 'showdown' || s.street === 'done') return [];
  if (s.toAct !== seat) return [];
  const call = toCall(s, seat);
  const stack = sStack(s, seat);
  const acts: ActionToken[] = [];
  if (call > 0) {
    acts.push('fold');
    acts.push('call'); // calls (or auto all-in-call when call >= stack)
  } else {
    acts.push('check');
  }
  // Raises only when the player has chips beyond the call and the opponent isn't
  // already all-in (nothing to raise into).
  const oppStack = sStack(s, seat === 'you' ? 'cpu' : 'you');
  const canAggress = stack > call && oppStack > 0;
  if (canAggress) {
    const myBet = getBet(s, seat);
    const ceil = myBet + stack;
    const half = raiseTarget(s, seat, 0.5);
    const full = raiseTarget(s, seat, 1.0);
    if (half < ceil && half > getBet(s, seat === 'you' ? 'cpu' : 'you')) acts.push('raise_half');
    if (full < ceil && full > half) acts.push('raise_pot');
    acts.push('all_in');
  }
  return acts;
}

// ── Apply an action ────────────────────────────────────────────────────────────

const LABEL_YOU = 'You';
const LABEL_CPU = 'Opp';

export function applyAction(prev: PokerState, seat: Seat, token: ActionToken): PokerState {
  const s = clone(prev);
  if (s.toAct !== seat || s.handOver) return s;
  const legal = legalActions(prev, seat);
  if (!legal.includes(token)) return s; // ignore illegal — caller guards too
  const who = seat === 'you' ? LABEL_YOU : LABEL_CPU;
  const opp: Seat = seat === 'you' ? 'cpu' : 'you';
  const call = toCall(s, seat);
  const stack = sStack(s, seat);

  if (token === 'fold') {
    s.log.push(`${who} folds.`);
    return finishByFold(s, opp);
  }

  if (token === 'check') {
    s.log.push(`${who} checks.`);
    markActed(s, seat);
    return advanceTurn(s, seat);
  }

  if (token === 'call') {
    const pay = Math.min(call, stack);
    addStack(s, seat, -pay);
    addBet(s, seat, pay);
    s.log.push(`${who} calls ${pay}.`);
    markActed(s, seat);
    return advanceTurn(s, seat);
  }

  // Raise / bet / all-in: compute the "raise to" target, move the chip difference.
  let target: number;
  if (token === 'all_in') target = getBet(s, seat) + stack;
  else if (token === 'raise_half') target = raiseTarget(s, seat, 0.5);
  else target = raiseTarget(s, seat, 1.0); // raise_pot
  const myBet = getBet(s, seat);
  const delta = Math.min(target - myBet, stack);
  const inc = (myBet + delta) - getBet(s, opp); // raise increment over opponent's bet
  if (inc > 0) s.lastRaise = inc;
  addStack(s, seat, -delta);
  addBet(s, seat, delta);
  const allIn = sStack(s, seat) === 0;
  const verb = call > 0 ? 'raises to' : 'bets';
  s.log.push(`${who} ${verb} ${getBet(s, seat)}${allIn ? ' (all-in)' : ''}.`);
  markActed(s, seat);
  // A raise reopens the action: opponent must respond.
  if (seat === 'you') s.actedCpu = false; else s.actedYou = false;
  return advanceTurn(s, seat);
}

function markActed(s: PokerState, seat: Seat) { if (seat === 'you') s.actedYou = true; else s.actedCpu = true; }

// Decide whether the street's betting round is closed, then either move to the
// next street, run the board out (both committed) or hand the turn to the other.
function advanceTurn(s: PokerState, justActed: Seat): PokerState {
  const opp: Seat = justActed === 'you' ? 'cpu' : 'you';
  const betsEqual = s.betYou === s.betCpu;
  const bothActed = s.actedYou && s.actedCpu;
  const oppAllIn = sStack(s, opp) === 0;
  const meAllIn = sStack(s, justActed) === 0;

  // Round closes when both have acted and bets match (or someone is all-in and
  // the other has matched).
  if (betsEqual && (bothActed || (oppAllIn && bothActed))) {
    return closeStreet(s);
  }
  // If the opponent is all-in and can't act, but bets aren't yet matched, the
  // actor (me) just called → bets equal handled above; otherwise continue.
  if (oppAllIn && betsEqual) return closeStreet(s);

  // Otherwise pass the turn. Skip a seat that is all-in (no chips to act).
  if (oppAllIn) {
    // Opponent can't act; if I'm also all-in or bets equal we'd have closed. Edge
    // case: I bet into an all-in opp who can't call more — just close.
    return closeStreet(s);
  }
  s.toAct = opp;
  s.message = opp === 'you' ? 'Your turn.' : 'Opponent to act…';
  void meAllIn;
  return s;
}

function bankBets(s: PokerState) {
  s.potCommitted += s.betYou + s.betCpu;
  s.betYou = 0;
  s.betCpu = 0;
}

// Close the current street: bank the bets, deal the next board card(s), reset the
// per-street flags, and set the postflop first actor (the non-button). When both
// players are all-in, run the rest of the board out to showdown immediately.
function closeStreet(s: PokerState): PokerState {
  bankBets(s);
  s.actedYou = false;
  s.actedCpu = false;
  s.lastRaise = s.blind;

  const allInRunout = s.stackYou === 0 || s.stackCpu === 0;

  const order: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const next = order[order.indexOf(s.street) + 1];
  s.street = next;
  if (next === 'flop') dealBoard(s, 3);
  else if (next === 'turn') dealBoard(s, 1);
  else if (next === 'river') dealBoard(s, 1);

  if (next === 'showdown') return showdown(s);

  if (allInRunout) {
    // Neither can act — keep dealing to showdown.
    return closeStreet(s);
  }

  // Postflop, the non-button acts first.
  s.toAct = s.button === 'you' ? 'cpu' : 'you';
  s.message = s.toAct === 'you' ? 'Your turn.' : 'Opponent to act…';
  return s;
}

function dealBoard(s: PokerState, n: number) {
  for (let i = 0; i < n; i++) s.board.push(s.deck.pop()!);
}

function finishByFold(s: PokerState, winner: Seat): PokerState {
  bankBets(s);
  const p = s.potCommitted;
  addStack(s, winner, p);
  s.potCommitted = 0;
  s.handOver = true;
  s.street = 'done';
  s.result = { winner, reason: 'fold', pot: p };
  s.message = winner === 'you' ? `You win ${p} (opponent folded).` : `Opponent wins ${p} (you folded).`;
  return s;
}

function showdown(s: PokerState): PokerState {
  s.revealCpu = true;
  const you = rankHand([...s.holeYou, ...s.board]);
  const cpu = rankHand([...s.holeCpu, ...s.board]);
  const cmp = compareScore(you.score, cpu.score);
  const p = s.potCommitted;
  let winner: Seat | 'split';
  if (cmp > 0) { winner = 'you'; addStack(s, 'you', p); }
  else if (cmp < 0) { winner = 'cpu'; addStack(s, 'cpu', p); }
  else {
    winner = 'split';
    const half = Math.floor(p / 2);
    addStack(s, 'you', p - half); // odd chip to you (button-agnostic, harmless)
    addStack(s, 'cpu', half);
  }
  s.potCommitted = 0;
  s.handOver = true;
  s.street = 'done';
  s.result = { winner, reason: 'showdown', pot: p, youName: you.name, cpuName: cpu.name };
  s.message =
    winner === 'split' ? `Split pot — both ${you.name}.`
    : winner === 'you' ? `You win ${p} with ${you.name}.`
    : `Opponent wins ${p} with ${cpu.name}.`;
  s.log.push(`Showdown — you: ${you.name} · opp: ${cpu.name}.`);
  return s;
}

export function matchOver(s: PokerState): boolean { return s.stackYou <= 0 || s.stackCpu <= 0; }

// ── Fog-limited opponent view ──────────────────────────────────────────────────

export function cpuView(s: PokerState): PokerView {
  return {
    hole: s.holeCpu.map(cardCode),
    board: s.board.map(cardCode),
    street: s.street,
    pot: pot(s),
    toCall: toCall(s, 'cpu'),
    stackCpu: s.stackCpu,
    stackYou: s.stackYou,
    blind: s.blind,
  };
}

// Authoritative client fallback when no model / garbled reply: passive but never
// crashing — check when free, call a cheap bet, otherwise fold.
export function fallbackAction(s: PokerState, seat: Seat): ActionToken {
  const legal = legalActions(s, seat);
  if (legal.includes('check')) return 'check';
  const call = toCall(s, seat);
  if (legal.includes('call') && call <= pot(s) * 0.5) return 'call';
  if (legal.includes('call') && call <= s.blind * 2) return 'call';
  return 'fold';
}

// ── Hand ranking (best 5 of 7) ──────────────────────────────────────────────────

export interface RankedHand { score: number[]; name: string }

const CAT_NAME = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

export function rankHand(cards: Card[]): RankedHand {
  // Evaluate every 5-card subset of the (5..7) cards, keep the best.
  let best: number[] | null = null;
  const combos = choose5(cards);
  for (const c of combos) {
    const sc = score5(c);
    if (!best || compareScore(sc, best) > 0) best = sc;
  }
  best = best || [0];
  return { score: best, name: CAT_NAME[best[0]] };
}

function score5(cards: Card[]): number[] {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const flush = suits.every(s => s === suits[0]);
  const straightHigh = straightHighCard(ranks);
  // Count rank multiplicities.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  // Sort by (count desc, rank desc).
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const pattern = groups.map(g => g[1]);
  const kickers = groups.map(g => g[0]);

  if (flush && straightHigh) return [8, straightHigh];
  if (pattern[0] === 4) return [7, kickers[0], kickers[1]];
  if (pattern[0] === 3 && pattern[1] === 2) return [6, kickers[0], kickers[1]];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (pattern[0] === 3) return [3, kickers[0], kickers[1], kickers[2]];
  if (pattern[0] === 2 && pattern[1] === 2) return [2, kickers[0], kickers[1], kickers[2]];
  if (pattern[0] === 2) return [1, kickers[0], kickers[1], kickers[2], kickers[3]];
  return [0, ...ranks];
}

function straightHighCard(ranksDesc: number[]): number | null {
  const uniq = [...new Set(ranksDesc)];
  if (uniq.length < 5) return null;
  // Ace-low wheel: treat A(14) as 1 for A-2-3-4-5.
  const withWheel = uniq.includes(14) ? [...uniq, 1] : uniq;
  for (let i = 0; i + 4 < withWheel.length || i === 0; i++) {
    const window = withWheel.slice(i, i + 5);
    if (window.length === 5 && window[0] - window[4] === 4) return window[0];
    if (i + 5 >= withWheel.length) break;
  }
  return null;
}

function choose5(cards: Card[]): Card[][] {
  if (cards.length <= 5) return [cards];
  const out: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            out.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
  return out;
}

export function compareScore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function clone(s: PokerState): PokerState {
  return {
    ...s,
    deck: [...s.deck], board: [...s.board],
    holeYou: [...s.holeYou], holeCpu: [...s.holeCpu],
    result: s.result ? { ...s.result } : null,
    log: [...s.log],
  };
}

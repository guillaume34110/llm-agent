import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Power, RotateCcw } from 'lucide-react';
import { api } from '../api';
import {
  type PokerState,
  type ActionToken,
  type Seat,
  type Card,
  newGame,
  dealHand,
  legalActions,
  applyAction,
  fallbackAction,
  cpuView,
  pot,
  toCall,
  matchOver,
  cardCode,
} from '../game/poker/engine';

// Same Game Boy DMG 4-shade ramp as the chess console — follows the active theme.
const SHELL = 'var(--gb-shell)';
const SCREEN_BG = 'var(--gb-screen)';
const FELT = 'var(--gb-dark)';
const INK = 'var(--gb-ink)';
const MID = 'var(--gb-mid)';
const LIGHT = 'var(--gb-light)';

// Persist the table so it survives a tab switch / reopen / restart. Local-first:
// the whole game state stays on the client; the server never sees it.
const SAVE_KEY = 'monkey:poker:v1';
function loadSaved(): PokerState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && Array.isArray(s.deck) && typeof s.stackYou === 'number' && Array.isArray(s.holeYou)) {
      return s as PokerState;
    }
  } catch { /* ignore corrupt save */ }
  return null;
}

const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = new Set(['h', 'd']);

interface Props {
  onExit: () => void;
  modelId?: string;
  providerMode?: 'local' | 'friend';
  providerUserId?: string;
}

const TOKEN_LABEL: Record<ActionToken, string> = {
  fold: 'FOLD',
  check: 'CHECK',
  call: 'CALL',
  raise_half: 'RAISE ½',
  raise_pot: 'RAISE POT',
  all_in: 'ALL-IN',
};

export default function PokerConsole({ onExit, modelId, providerMode, providerUserId }: Props) {
  const game = useRef<PokerState>(loadSaved() ?? newGame());
  const [, force] = useState(0);
  const rerender = () => force(n => n + 1);
  const [thinking, setThinking] = useState(false);
  const [booting, setBooting] = useState(true);
  const [lastFallback, setLastFallback] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1000);
    return () => clearTimeout(t);
  }, []);

  // Save after every state bump.
  const save = useCallback(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.current)); } catch { /* storage full */ }
  }, []);

  const playCpu = useCallback(async () => {
    const s = game.current;
    if (s.handOver || s.toAct !== 'cpu') return;
    setThinking(true);
    const legal = legalActions(s, 'cpu');
    let chosen: ActionToken | null = null;
    let fb = false;
    try {
      const res = await api.pokerMove(cpuView(s), legal, { modelId, providerMode, providerUserId });
      chosen = (res.action as ActionToken) || null;
      fb = res.fallback;
    } catch {
      chosen = null;
    }
    // Guard-rail: re-validate the token locally; on any miss play a passive legal action.
    if (!chosen || !legal.includes(chosen)) {
      chosen = fallbackAction(s, 'cpu');
      fb = true;
    }
    game.current = applyAction(s, 'cpu', chosen);
    setLastFallback(fb);
    setThinking(false);
    save();
    rerender();
  }, [modelId, providerMode, providerUserId, save]);

  // Drive the opponent whenever it's the CPU's turn (initial deal, after a player
  // action, or a restored hand that stopped on the CPU).
  useEffect(() => {
    const s = game.current;
    if (!booting && !s.handOver && s.toAct === 'cpu' && !thinking) {
      const id = setTimeout(() => { void playCpu(); }, 650);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting, thinking, game.current.toAct, game.current.handOver, game.current.handNo, game.current.street]);

  const onPlayerAction = useCallback((token: ActionToken) => {
    const s = game.current;
    if (booting || thinking || s.handOver || s.toAct !== 'you') return;
    if (!legalActions(s, 'you').includes(token)) return;
    game.current = applyAction(s, 'you', token);
    save();
    rerender();
  }, [booting, thinking, save]);

  const nextHand = useCallback(() => {
    const s = game.current;
    if (matchOver(s)) { game.current = newGame(); }
    else { game.current = dealHand(s); }
    setLastFallback(false);
    save();
    rerender();
  }, [save]);

  const resetMatch = useCallback(() => {
    game.current = newGame();
    setLastFallback(false);
    setThinking(false);
    save();
    rerender();
  }, [save]);

  const s = game.current;
  const youActs = !s.handOver && s.toAct === 'you' && !thinking && !booting;
  const legalYou = youActs ? legalActions(s, 'you') : [];
  const callAmt = toCall(s, 'you');
  const over = matchOver(s);

  const status = (() => {
    if (booting) return 'SHUFFLING…';
    if (s.handOver) return s.message;
    if (thinking) return 'OPPONENT THINKING…';
    if (s.toAct === 'you') return callAmt > 0 ? `YOUR MOVE — ${callAmt} to call` : 'YOUR MOVE';
    return 'OPPONENT TO ACT';
  })();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-1 flex-col overflow-hidden"
      style={{ background: SHELL }}
    >
      {/* Console top bar */}
      <div className="flex items-center justify-between px-4 py-3" style={{ color: INK }}>
        <span className="text-[11px] font-bold tracking-[0.2em]" style={{ fontFamily: 'monospace' }}>
          MONKEY · HOLD'EM
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={resetMatch}
            title="New match"
            className="flex items-center justify-center rounded-md"
            style={{ background: MID, color: INK, width: 26, height: 26 }}
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={onExit}
            title="Power off"
            className="flex items-center justify-center rounded-md"
            style={{ background: '#7a1f1f', color: '#f0d0d0', width: 26, height: 26 }}
          >
            <Power size={15} />
          </button>
        </div>
      </div>

      {/* Screen — the felt table */}
      <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col items-center justify-between p-4" style={{ background: SCREEN_BG }}>
        {/* Opponent */}
        <div className="flex flex-col items-center gap-1.5 w-full">
          <div className="text-[10px] font-bold tracking-wider" style={{ color: INK, fontFamily: 'monospace' }}>
            OPPONENT · {s.stackCpu} chips {s.button === 'cpu' ? '· BTN' : ''}
          </div>
          <div className="flex gap-2">
            <CardView card={s.revealCpu ? s.holeCpu[0] : null} />
            <CardView card={s.revealCpu ? s.holeCpu[1] : null} />
          </div>
        </div>

        {/* Board + pot */}
        <div className="flex flex-col items-center gap-2 w-full"
             style={{ background: FELT, borderRadius: 14, padding: '14px 10px' }}>
          <div className="text-[10px] font-bold tracking-[0.15em]" style={{ color: LIGHT, fontFamily: 'monospace' }}>
            POT {pot(s)}
          </div>
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4].map(i => <CardView key={i} card={s.board[i] ?? null} small placeholder />)}
          </div>
          {(s.betYou > 0 || s.betCpu > 0) && (
            <div className="text-[9px] tracking-wider" style={{ color: LIGHT, fontFamily: 'monospace', opacity: 0.85 }}>
              you bet {s.betYou} · opp bet {s.betCpu}
            </div>
          )}
        </div>

        {/* You */}
        <div className="flex flex-col items-center gap-1.5 w-full">
          <div className="flex gap-2">
            <CardView card={s.holeYou[0] ?? null} />
            <CardView card={s.holeYou[1] ?? null} />
          </div>
          <div className="text-[10px] font-bold tracking-wider" style={{ color: INK, fontFamily: 'monospace' }}>
            YOU · {s.stackYou} chips {s.button === 'you' ? '· BTN' : ''}
          </div>
        </div>

        {/* Power-on sweep */}
        {booting && (
          <motion.div
            className="absolute inset-0"
            style={{ background: INK, pointerEvents: 'none' }}
            initial={{ scaleY: 1, opacity: 1 }}
            animate={{ scaleY: 0, opacity: [1, 1, 0.8, 0] }}
            transition={{ duration: 0.85, ease: 'easeInOut' }}
          />
        )}
      </div>

      {/* Status + controls */}
      <div className="px-4 py-2.5" style={{ background: SHELL, color: INK, fontFamily: 'monospace' }}>
        <div className="text-center text-[11px] font-bold tracking-wider" style={{ minHeight: 16 }}>
          {status}
        </div>

        {/* Action buttons (player to act) */}
        {youActs && legalYou.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {legalYou.map(tok => (
              <button
                key={tok}
                onClick={() => onPlayerAction(tok)}
                className="rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide"
                style={{
                  background: tok === 'fold' ? '#7a1f1f' : tok === 'all_in' ? INK : MID,
                  color: tok === 'fold' || tok === 'all_in' ? LIGHT : INK,
                }}
              >
                {TOKEN_LABEL[tok]}{tok === 'call' && callAmt > 0 ? ` ${callAmt}` : ''}
              </button>
            ))}
          </div>
        )}

        {/* Hand-over: next hand / new match */}
        {s.handOver && !booting && (
          <div className="mt-2 flex items-center justify-center">
            <button
              onClick={nextHand}
              className="rounded-md px-4 py-1.5 text-[11px] font-bold tracking-wide"
              style={{ background: MID, color: INK }}
            >
              {over ? 'NEW MATCH' : 'NEXT HAND'}
            </button>
          </div>
        )}

        <div className="mt-1.5 flex items-center justify-between text-[10px]">
          <span>hand {s.handNo}</span>
          <span>{lastFallback ? 'opp. played safe' : modelId ? 'vs LLM' : 'vs house'}</span>
        </div>
      </div>
    </motion.div>
  );
}

// One card. `null` card → face-down (opponent) or empty board slot (placeholder).
function CardView({ card, small, placeholder }: { card: Card | null; small?: boolean; placeholder?: boolean }) {
  const w = small ? 30 : 40;
  const h = small ? 42 : 56;
  if (!card) {
    return (
      <div
        className="flex items-center justify-center rounded-md"
        style={{
          width: w, height: h,
          background: placeholder ? 'transparent' : INK,
          border: placeholder ? `1.5px dashed ${MID}` : `1.5px solid ${MID}`,
          color: LIGHT, fontSize: small ? 14 : 18,
        }}
      >
        {placeholder ? '' : '🂠'}
      </div>
    );
  }
  const code = cardCode(card);
  const rankTxt = code.slice(0, -1);
  const suit = code.slice(-1);
  const red = RED.has(suit);
  return (
    <div
      className="flex flex-col items-center justify-center rounded-md"
      style={{
        width: w, height: h, background: LIGHT, border: `1.5px solid ${INK}`,
        color: red ? '#b4302a' : INK, fontFamily: 'monospace', lineHeight: 1,
      }}
    >
      <span style={{ fontSize: small ? 13 : 16, fontWeight: 700 }}>{rankTxt}</span>
      <span style={{ fontSize: small ? 14 : 18 }}>{SUIT_GLYPH[suit]}</span>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Power, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { LANGS, alphabet, BOARD_SIZE, type Lang, type Premium } from '../game/scrabble/data';
import {
  type ScrabbleState,
  type Placement,
  type Tile,
  newGame,
  validatePlacement,
  commitPlacement,
  passTurn,
  exchangeTiles,
  cpuView,
  cpuPlacements,
  cpuFallback,
  wordStrings,
} from '../game/scrabble/engine';

// Same Game Boy DMG 4-shade ramp as the chess / poker consoles — follows the theme.
const SHELL = 'var(--gb-shell)';
const SCREEN_BG = 'var(--gb-screen)';
const INK = 'var(--gb-ink)';
const MID = 'var(--gb-mid)';
const LIGHT = 'var(--gb-light)';

// Premium-square tints (color-coded like a real board — clarity beats palette purity).
const PREMIUM_BG: Record<Premium, string> = {
  '.': 'var(--gb-screen)',
  DL: '#7d9bc4',
  TL: '#3f6196',
  DW: '#c08a6a',
  TW: '#9a3b2c',
};
const PREMIUM_LABEL: Record<Premium, string> = { '.': '', DL: '2L', TL: '3L', DW: '2W', TW: '3W' };
const COMMITTED_BG = 'var(--gb-light)';
const PENDING_BG = '#d8c25a';
const CENTER_CELL = 7;

// Persist the board so it survives a tab switch / reopen / restart. Local-first:
// the whole game state stays on the client; the server never sees it.
const SAVE_KEY = 'monkey:scrabble:v1';
function loadSaved(): ScrabbleState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && Array.isArray(s.board) && Array.isArray(s.rackYou) && typeof s.scoreYou === 'number') {
      return s as ScrabbleState;
    }
  } catch { /* ignore corrupt save */ }
  return null;
}

interface Props {
  onExit: () => void;
  modelId?: string;
  providerMode?: 'local' | 'friend';
  providerUserId?: string;
}

// A tentatively-placed tile (this turn, not yet committed). `rackIdx` points into
// the live rack so RECALL can release it; blanks carry their chosen letter.
interface Pending { r: number; c: number; rackIdx: number; tile: Tile }

export default function ScrabbleConsole({ onExit, modelId, providerMode, providerUserId }: Props) {
  const game = useRef<ScrabbleState>(loadSaved() ?? newGame('en'));
  const [, force] = useState(0);
  const rerender = () => force(n => n + 1);
  const [thinking, setThinking] = useState(false);
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState('');
  const [lastFallback, setLastFallback] = useState(false);

  const [pending, setPending] = useState<Pending[]>([]);
  const [selRack, setSelRack] = useState<number | null>(null);
  const [blankPick, setBlankPick] = useState<{ rackIdx: number; r: number; c: number } | null>(null);
  const [exchangeMode, setExchangeMode] = useState(false);
  const [exchangeSel, setExchangeSel] = useState<Set<number>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1000);
    return () => clearTimeout(t);
  }, []);

  const save = useCallback(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.current)); } catch { /* storage full */ }
  }, []);

  const clearTurnUi = () => {
    setPending([]); setSelRack(null); setBlankPick(null);
    setExchangeMode(false); setExchangeSel(new Set());
  };

  // ── Opponent loop: drive the CPU whenever it's its turn. ───────────────────────
  const playCpu = useCallback(async () => {
    const s = game.current;
    if (s.over || s.toAct !== 'cpu') return;
    setThinking(true);
    let next: ScrabbleState | null = null;
    let fb = false;
    try {
      const res = await api.scrabbleMove(cpuView(s), { modelId, providerMode, providerUserId });
      if (res.pass || !res.word) {
        next = passTurn(s, 'cpu'); fb = true;
      } else {
        const placements = cpuPlacements(s, res.word, res.row ?? 0, res.col ?? 0, res.dir ?? 'H');
        const geo = placements ? validatePlacement(s, placements) : null;
        if (placements && geo && geo.ok) {
          // Dictionary check — the opponent can't sneak a fake word past the oracle.
          let valid = false;
          try {
            const judged = await api.scrabbleValidate(wordStrings(geo.words), s.lang, { modelId, providerMode, providerUserId });
            valid = !!judged.valid;
          } catch { valid = false; }
          if (valid) next = commitPlacement(s, 'cpu', placements, geo.score, geo.words);
        }
      }
    } catch { /* network/garble → fallback below */ }
    if (!next) { next = cpuFallback(s); fb = true; }
    game.current = next;
    setLastFallback(fb);
    setThinking(false);
    save();
    rerender();
  }, [modelId, providerMode, providerUserId, save]);

  useEffect(() => {
    const s = game.current;
    if (!booting && !s.over && s.toAct === 'cpu' && !thinking) {
      const id = setTimeout(() => { void playCpu(); }, 650);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting, thinking, game.current.toAct, game.current.over, game.current.turnNo]);

  // ── Language selector (only before any tile is on the board). ──────────────────
  const s = game.current;
  const boardEmpty = s.board.every(row => row.every(c => !c.tile));
  const canChangeLang = boardEmpty && pending.length === 0 && !s.over;

  const setLang = useCallback((lang: Lang) => {
    if (lang === game.current.lang) return;
    game.current = newGame(lang);
    clearTurnUi();
    setLastFallback(false);
    setNotice('');
    save();
    rerender();
  }, [save]);

  // ── Tentative placement interactions. ──────────────────────────────────────────
  const youTurn = !s.over && s.toAct === 'you' && !thinking && !booting;
  const pendingAt = (r: number, c: number) => pending.find(p => p.r === r && p.c === c);
  const rackUsed = (idx: number) => pending.some(p => p.rackIdx === idx);

  const onRackClick = (idx: number) => {
    if (!youTurn) return;
    if (exchangeMode) {
      setExchangeSel(prev => {
        const n = new Set(prev);
        if (n.has(idx)) n.delete(idx); else n.add(idx);
        return n;
      });
      return;
    }
    if (rackUsed(idx)) return;
    setSelRack(prev => (prev === idx ? null : idx));
    setNotice('');
  };

  const onCellClick = (r: number, c: number) => {
    if (!youTurn || exchangeMode) return;
    const here = pendingAt(r, c);
    if (here) {
      // Recall this tentative tile back to the rack.
      setPending(prev => prev.filter(p => !(p.r === r && p.c === c)));
      return;
    }
    if (s.board[r][c].tile) return; // committed square
    if (selRack === null) return;
    const tile = s.rackYou[selRack];
    if (!tile) return;
    if (tile.blank) { setBlankPick({ rackIdx: selRack, r, c }); return; }
    setPending(prev => [...prev, { r, c, rackIdx: selRack, tile: { ...tile } }]);
    setSelRack(null);
  };

  const chooseBlank = (letter: string) => {
    if (!blankPick) return;
    const { rackIdx, r, c } = blankPick;
    setPending(prev => [...prev, { r, c, rackIdx, tile: { letter, points: 0, blank: true } }]);
    setBlankPick(null);
    setSelRack(null);
  };

  // ── Turn actions. ───────────────────────────────────────────────────────────────
  const onPlay = useCallback(async () => {
    const cur = game.current;
    if (cur.toAct !== 'you' || cur.over || thinking || booting) return;
    const placements: Placement[] = pending.map(p => ({ r: p.r, c: p.c, tile: p.tile }));
    const geo = validatePlacement(cur, placements);
    if (!geo.ok) { setNotice(geo.error || 'invalid placement'); return; }
    setThinking(true);
    setNotice('');
    let valid = false;
    try {
      const judged = await api.scrabbleValidate(wordStrings(geo.words), cur.lang, { modelId, providerMode, providerUserId });
      valid = !!judged.valid;
    } catch { valid = false; }
    if (!valid) {
      setNotice('Not a valid word — tiles returned.');
      setThinking(false);
      return; // pending stays; player can rearrange
    }
    game.current = commitPlacement(cur, 'you', placements, geo.score, geo.words);
    clearTurnUi();
    setThinking(false);
    save();
    rerender();
  }, [pending, thinking, booting, modelId, providerMode, providerUserId, save]);

  const onPass = useCallback(() => {
    const cur = game.current;
    if (cur.toAct !== 'you' || cur.over || thinking || booting) return;
    game.current = passTurn(cur, 'you');
    clearTurnUi();
    setNotice('');
    save();
    rerender();
  }, [thinking, booting, save]);

  const onExchange = useCallback(() => {
    const cur = game.current;
    if (cur.toAct !== 'you' || cur.over || thinking || booting) return;
    if (!exchangeMode) { setPending([]); setSelRack(null); setExchangeMode(true); return; }
    if (exchangeSel.size === 0) { setExchangeMode(false); return; }
    game.current = exchangeTiles(cur, 'you', [...exchangeSel]);
    clearTurnUi();
    setNotice('');
    save();
    rerender();
  }, [exchangeMode, exchangeSel, thinking, booting, save]);

  const resetGame = useCallback(() => {
    game.current = newGame(game.current.lang);
    clearTurnUi();
    setLastFallback(false);
    setNotice('');
    setThinking(false);
    save();
    rerender();
  }, [save]);

  // ── Derived display. ──────────────────────────────────────────────────────────
  const status = (() => {
    if (booting) return 'SHUFFLING…';
    if (s.over) return s.message;
    if (thinking) return s.toAct === 'cpu' ? 'OPPONENT THINKING…' : 'CHECKING WORD…';
    if (exchangeMode) return `EXCHANGE — pick tiles (${exchangeSel.size})`;
    if (s.toAct === 'you') return notice || 'YOUR MOVE';
    return 'OPPONENT TO ACT';
  })();
  const pendingScore = (() => {
    if (!pending.length) return null;
    const geo = validatePlacement(s, pending.map(p => ({ r: p.r, c: p.c, tile: p.tile })));
    return geo.ok ? geo.score : null;
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
          MONKEY · SCRABBLE
        </span>
        <div className="flex items-center gap-2">
          {/* Language selector — locked once a tile hits the board. */}
          <div className="flex items-center gap-1">
            {LANGS.map(l => (
              <button
                key={l.code}
                onClick={() => canChangeLang && setLang(l.code)}
                disabled={!canChangeLang}
                title={canChangeLang ? `Play in ${l.label}` : 'Finish or reset to change language'}
                className="rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide"
                style={{
                  background: s.lang === l.code ? INK : MID,
                  color: s.lang === l.code ? LIGHT : INK,
                  opacity: canChangeLang || s.lang === l.code ? 1 : 0.5,
                }}
              >
                {l.code.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={resetGame}
            title="New game"
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

      {/* Screen — scores + board */}
      <div className="relative flex-1 min-h-0 overflow-auto flex flex-col items-center gap-2 p-3" style={{ background: SCREEN_BG }}>
        <div className="flex w-full max-w-[440px] items-center justify-between text-[10px] font-bold tracking-wider"
             style={{ color: INK, fontFamily: 'monospace' }}>
          <span>OPPONENT {s.scoreCpu}</span>
          <span style={{ opacity: 0.7 }}>bag {s.bag.length}</span>
          <span>YOU {s.scoreYou}</span>
        </div>

        {/* 15×15 board */}
        <div
          className="grid w-full max-w-[440px]"
          style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`, gap: 1, aspectRatio: '1 / 1' }}
        >
          {s.board.map((row, r) =>
            row.map((cell, c) => {
              const pend = pendingAt(r, c);
              const tile = cell.tile ?? pend?.tile ?? null;
              const isCenter = r === CENTER_CELL && c === CENTER_CELL && !tile;
              const bg = tile
                ? (pend ? PENDING_BG : COMMITTED_BG)
                : PREMIUM_BG[cell.premium];
              return (
                <button
                  key={`${r},${c}`}
                  onClick={() => onCellClick(r, c)}
                  className="flex items-center justify-center"
                  style={{
                    background: bg,
                    color: tile ? INK : LIGHT,
                    aspectRatio: '1 / 1',
                    fontFamily: 'monospace',
                    fontSize: tile ? '0.62rem' : '0.42rem',
                    fontWeight: 700,
                    lineHeight: 1,
                    borderRadius: 2,
                    position: 'relative',
                    cursor: youTurn && !exchangeMode ? 'pointer' : 'default',
                  }}
                >
                  {tile ? (
                    <>
                      <span>{(tile.blank ? tile.letter : tile.letter).toUpperCase()}</span>
                      {tile.points > 0 && (
                        <span style={{ position: 'absolute', right: 1, bottom: 0, fontSize: '0.34rem', opacity: 0.7 }}>
                          {tile.points}
                        </span>
                      )}
                    </>
                  ) : isCenter ? '★' : PREMIUM_LABEL[cell.premium]}
                </button>
              );
            }),
          )}
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

        {/* Blank-letter picker */}
        {blankPick && (
          <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <div className="rounded-lg p-3" style={{ background: SHELL, maxWidth: 320 }}>
              <div className="mb-2 text-center text-[11px] font-bold tracking-wider" style={{ color: INK, fontFamily: 'monospace' }}>
                BLANK — pick a letter
              </div>
              <div className="flex flex-wrap justify-center gap-1">
                {alphabet(s.lang).map(L => (
                  <button
                    key={L}
                    onClick={() => chooseBlank(L)}
                    className="flex items-center justify-center rounded"
                    style={{ width: 24, height: 24, background: LIGHT, color: INK, fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}
                  >
                    {L}
                  </button>
                ))}
                <button
                  onClick={() => setBlankPick(null)}
                  className="rounded px-2 text-[10px] font-bold"
                  style={{ height: 24, background: '#7a1f1f', color: LIGHT }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status + rack + controls */}
      <div className="px-4 py-2.5" style={{ background: SHELL, color: INK, fontFamily: 'monospace' }}>
        <div className="text-center text-[11px] font-bold tracking-wider" style={{ minHeight: 16 }}>
          {status}{pendingScore != null ? ` · +${pendingScore}` : ''}
        </div>

        {/* Player rack */}
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {s.rackYou.map((t, idx) => {
            const used = rackUsed(idx);
            const sel = selRack === idx;
            const xsel = exchangeSel.has(idx);
            return (
              <button
                key={idx}
                onClick={() => onRackClick(idx)}
                disabled={!youTurn || (used && !exchangeMode)}
                className="flex items-center justify-center"
                style={{
                  width: 30, height: 34, borderRadius: 4,
                  background: used ? MID : LIGHT,
                  border: sel ? `2px solid ${INK}` : xsel ? '2px solid #7a1f1f' : `1px solid ${MID}`,
                  color: INK, fontWeight: 700, fontSize: 15, opacity: used ? 0.4 : 1,
                  position: 'relative',
                }}
              >
                {t.blank ? '·' : t.letter}
                {!t.blank && t.points > 0 && (
                  <span style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 8, opacity: 0.7 }}>{t.points}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Controls */}
        {!s.over && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {!exchangeMode ? (
              <>
                <button onClick={() => void onPlay()} disabled={!youTurn || pending.length === 0}
                  className="rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide"
                  style={{ background: INK, color: LIGHT, opacity: youTurn && pending.length ? 1 : 0.5 }}>
                  PLAY
                </button>
                <button onClick={() => setPending([])} disabled={!youTurn || pending.length === 0}
                  className="rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide"
                  style={{ background: MID, color: INK, opacity: youTurn && pending.length ? 1 : 0.5 }}>
                  RECALL
                </button>
                <button onClick={onExchange} disabled={!youTurn}
                  className="rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide"
                  style={{ background: MID, color: INK, opacity: youTurn ? 1 : 0.5 }}>
                  EXCHANGE
                </button>
                <button onClick={onPass} disabled={!youTurn}
                  className="rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide"
                  style={{ background: MID, color: INK, opacity: youTurn ? 1 : 0.5 }}>
                  PASS
                </button>
              </>
            ) : (
              <>
                <button onClick={onExchange} disabled={!youTurn}
                  className="rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wide"
                  style={{ background: INK, color: LIGHT }}>
                  {exchangeSel.size ? `SWAP ${exchangeSel.size}` : 'CANCEL'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Game-over: new game */}
        {s.over && !booting && (
          <div className="mt-2 flex items-center justify-center">
            <button onClick={resetGame}
              className="rounded-md px-4 py-1.5 text-[11px] font-bold tracking-wide"
              style={{ background: MID, color: INK }}>
              NEW GAME
            </button>
          </div>
        )}

        <div className="mt-1.5 flex items-center justify-between text-[10px]">
          <span>turn {s.turnNo}</span>
          <span>{lastFallback ? 'opp. passed/swapped' : modelId ? 'vs LLM' : 'vs house'}</span>
        </div>
      </div>
    </motion.div>
  );
}

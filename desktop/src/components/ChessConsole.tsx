import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Chess, type Square } from 'chess.js';
import { Power, RotateCcw } from 'lucide-react';
import { api } from '../api';

// Game Boy DMG 4-shade ramp, tinted to the current theme hue (see --gb-* in
// styles.css). Keeps the chromatic console look but follows the active theme
// instead of being locked to green.
const SHELL = 'var(--gb-shell)';       // console plastic / bands
const SCREEN_BG = 'var(--gb-screen)';  // lightest — light squares + screen
const SQ_DARK = 'var(--gb-dark)';      // dark squares
const INK = 'var(--gb-ink)';           // darkest — black pieces / text
const MID = 'var(--gb-mid)';           // mid shade — accents
const WHITE_FILL = 'var(--gb-light)';  // off-screen light for white pieces (contrast)

const SIZE = 40;               // px per square
const BOARD = SIZE * 8;        // 320

const GLYPH: Record<string, string> = { p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' };
const FILES = 'abcdefgh';

// Persist the match so it survives a tab switch, a console close/reopen, or an
// app restart — the game must never reset on remount. Local-first: stays on the
// client, the server never sees it.
const SAVE_KEY = 'monkey:chess:v1';
function loadSaved(): { fen: string; san: string[] } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (typeof s?.fen === 'string') return { fen: s.fen, san: Array.isArray(s.san) ? s.san : [] };
  } catch { /* ignore corrupt save */ }
  return null;
}

function squareName(col: number, row: number): Square {
  // row 0 = rank 8 (top), col 0 = file a (left). White plays from the bottom.
  return `${FILES[col]}${8 - row}` as Square;
}

interface Props {
  onExit: () => void;
  modelId?: string;
  providerMode?: 'local' | 'friend';
  providerUserId?: string;
}

export default function ChessConsole({ onExit, modelId, providerMode, providerUserId }: Props) {
  const game = useRef<Chess>((() => {
    const g = new Chess();
    const saved = loadSaved();
    if (saved) { try { g.load(saved.fen); } catch { /* fall back to fresh board */ } }
    return g;
  })());
  const sanHistory = useRef<string[]>(loadSaved()?.san ?? []);
  const [tick, force] = useState(0);
  const rerender = () => force(n => n + 1);

  // Save after every state bump (player move, opponent move, new game).
  useEffect(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ fen: game.current.fen(), san: sanHistory.current }));
    } catch { /* storage full / disabled — game still playable in-memory */ }
  }, [tick]);

  const [selected, setSelected] = useState<Square | null>(null);
  const [targets, setTargets] = useState<Square[]>([]);
  const [thinking, setThinking] = useState(false);
  const [booting, setBooting] = useState(true);
  const [lastFallback, setLastFallback] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1100);
    return () => clearTimeout(t);
  }, []);

  const board = game.current.board();
  const turn = game.current.turn(); // 'w' | 'b'
  const isOver = game.current.isGameOver();

  const status = useMemo(() => {
    const g = game.current;
    if (g.isCheckmate()) return turn === 'w' ? 'CHECKMATE — Black wins' : 'CHECKMATE — White wins';
    if (g.isStalemate()) return 'STALEMATE — draw';
    if (g.isInsufficientMaterial()) return 'DRAW — insufficient material';
    if (g.isDraw()) return 'DRAW';
    if (thinking) return 'BLACK is thinking…';
    if (g.inCheck()) return turn === 'w' ? 'WHITE in CHECK' : 'BLACK in CHECK';
    return turn === 'w' ? 'YOUR MOVE (white)' : 'BLACK to move';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thinking, sanHistory.current.length, turn, isOver]);

  const playBlack = useCallback(async () => {
    const g = game.current;
    if (g.isGameOver() || g.turn() !== 'b') return;
    setThinking(true);
    const legal = g.moves(); // SAN strings
    let chosen: string | null = null;
    let fallback = false;
    try {
      const res = await api.chessMove(g.fen(), legal, [...sanHistory.current], {
        modelId,
        providerMode,
        providerUserId,
      });
      chosen = res.move;
      fallback = res.fallback;
    } catch {
      chosen = null;
    }
    // Guard-rail: validate the move locally; on any miss play a random legal move.
    let applied = null;
    if (chosen) {
      try { applied = g.move(chosen); } catch { applied = null; }
    }
    if (!applied) {
      const pick = legal[Math.floor(Math.random() * legal.length)];
      applied = g.move(pick);
      fallback = true;
    }
    if (applied) sanHistory.current.push(applied.san);
    setLastFallback(fallback);
    setThinking(false);
    rerender();
  }, [modelId, providerMode, providerUserId]);

  // If a restored game stopped on Black's turn (tab switched mid-think), resume
  // the opponent move once the power-on sweep clears.
  useEffect(() => {
    if (!booting && turn === 'b' && !isOver && !thinking) void playBlack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booting]);

  const onSquareClick = useCallback((sq: Square) => {
    const g = game.current;
    if (booting || thinking || g.isGameOver() || g.turn() !== 'w') return;

    // Complete a move when a target square is clicked.
    if (selected && targets.includes(sq)) {
      let applied = null;
      try { applied = g.move({ from: selected, to: sq, promotion: 'q' }); } catch { applied = null; }
      if (applied) {
        sanHistory.current.push(applied.san);
        setSelected(null);
        setTargets([]);
        rerender();
        void playBlack();
      }
      return;
    }

    // Otherwise (re)select one of our own pieces.
    const piece = g.get(sq);
    if (piece && piece.color === 'w') {
      const moves = g.moves({ square: sq, verbose: true }) as Array<{ to: string }>;
      setSelected(sq);
      setTargets(moves.map(m => m.to as Square));
    } else {
      setSelected(null);
      setTargets([]);
    }
  }, [booting, thinking, selected, targets, playBlack]);

  const newGame = useCallback(() => {
    game.current = new Chess();
    sanHistory.current = [];
    setSelected(null);
    setTargets([]);
    setThinking(false);
    setLastFallback(false);
    rerender();
  }, []);

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
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold tracking-[0.2em]" style={{ fontFamily: 'monospace' }}>
              MONKEY · CHESS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={newGame}
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

        {/* Screen — fills all remaining space; board centred and scaled to fit */}
        <div className="relative flex-1 min-h-0 overflow-hidden flex items-center justify-center p-3" style={{ background: SCREEN_BG }}>
            <svg viewBox={`0 0 ${BOARD} ${BOARD}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }}>
              {board.map((rankRow, row) =>
                rankRow.map((cell, col) => {
                  const sq = squareName(col, row);
                  const dark = (row + col) % 2 === 1;
                  const isSel = selected === sq;
                  const isTarget = targets.includes(sq);
                  return (
                    <g key={sq} onClick={() => onSquareClick(sq)} style={{ cursor: 'pointer' }}>
                      <rect
                        x={col * SIZE}
                        y={row * SIZE}
                        width={SIZE}
                        height={SIZE}
                        style={{ fill: dark ? SQ_DARK : SCREEN_BG }}
                      />
                      {isSel && (
                        <rect
                          x={col * SIZE}
                          y={row * SIZE}
                          width={SIZE}
                          height={SIZE}
                          strokeWidth={3}
                          style={{ fill: 'none', stroke: INK }}
                        />
                      )}
                      {cell && (
                        <text
                          x={col * SIZE + SIZE / 2}
                          y={row * SIZE + SIZE / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={SIZE * 0.74}
                          strokeWidth={cell.color === 'w' ? 0.8 : 0.5}
                          style={{
                            fill: cell.color === 'w' ? WHITE_FILL : INK,
                            stroke: cell.color === 'w' ? INK : MID,
                            pointerEvents: 'none',
                            userSelect: 'none',
                          }}
                        >
                          {GLYPH[cell.type]}
                        </text>
                      )}
                      {isTarget && !cell && (
                        <circle
                          cx={col * SIZE + SIZE / 2}
                          cy={row * SIZE + SIZE / 2}
                          r={6}
                          opacity={0.55}
                          style={{ fill: INK, pointerEvents: 'none' }}
                        />
                      )}
                      {isTarget && cell && (
                        <rect
                          x={col * SIZE + 2}
                          y={row * SIZE + 2}
                          width={SIZE - 4}
                          height={SIZE - 4}
                          strokeWidth={2.5}
                          opacity={0.6}
                          style={{ fill: 'none', stroke: INK, pointerEvents: 'none' }}
                        />
                      )}
                    </g>
                  );
                }),
              )}
            </svg>

            {/* Power-on sweep overlay */}
            {booting && (
              <motion.div
                className="absolute inset-0"
                style={{ background: INK, pointerEvents: 'none' }}
                initial={{ scaleY: 1, opacity: 1 }}
                animate={{ scaleY: 0, opacity: [1, 1, 0.8, 0] }}
                transition={{ duration: 0.9, ease: 'easeInOut' }}
              />
            )}
        </div>

        {/* Status + caption strip */}
        <div className="px-4 py-2.5" style={{ background: SHELL, color: INK, fontFamily: 'monospace' }}>
          <div className="text-center text-[11px] font-bold tracking-wider" style={{ minHeight: 16 }}>
            {booting ? 'POWER ON…' : status}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span>move {Math.ceil(sanHistory.current.length / 2) || 0}</span>
            <span>{lastFallback ? 'opp. played random' : modelId ? 'vs LLM' : 'vs random'}</span>
          </div>
        </div>
    </motion.div>
  );
}

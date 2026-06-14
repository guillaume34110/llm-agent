import React, { useEffect, useRef, useState } from 'react';
import { Power, RotateCcw, Pencil } from 'lucide-react';
import { CartRuntime } from '../game/engine/runtime';
import { getCart, loadCarts } from '../game/engine/storage';
import type { Cart } from '../game/engine/types';

const SHELL = 'var(--gb-shell)';
const SCREEN_BG = 'var(--gb-screen)';
const INK = 'var(--gb-ink)';
const MID = 'var(--gb-mid)';

interface Props {
  onExit: () => void;
  cartId?: string;
  onEdit?: (cartId: string) => void;
}

/** Generic player: loads any saved cart and runs it. One console for every game. */
export default function CartConsole({ onExit, cartId, onEdit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rtRef = useRef<CartRuntime | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const c = cartId ? getCart(cartId) : loadCarts()[0] || null;
    setCart(c);
  }, [cartId]);

  useEffect(() => {
    if (!cart || !canvasRef.current) return;
    setErr(null);
    const rt = new CartRuntime(canvasRef.current, { onError: setErr });
    rt.load(cart);
    rtRef.current = rt;
    canvasRef.current.focus();
    return () => rt.stop();
  }, [cart]);

  const reset = () => { if (cart) rtRef.current?.load(cart); setErr(null); };

  return (
    <div style={{ position: 'absolute', inset: 0, background: SHELL, display: 'flex', flexDirection: 'column', color: INK, fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `2px solid ${MID}` }}>
        <span style={{ fontWeight: 700, letterSpacing: 1 }}>{cart ? cart.name : 'no cart'}</span>
        <span style={{ flex: 1 }} />
        {cart && onEdit && (
          <button onClick={() => onEdit(cart.id)} title="edit" style={btn}><Pencil size={16} /></button>
        )}
        <button onClick={reset} title="restart" style={btn}><RotateCcw size={16} /></button>
        <button onClick={onExit} title="exit" style={btn}><Power size={16} /></button>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
        {cart ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <canvas
              ref={canvasRef}
              style={{
                width: 'min(70vh, 90vw)', height: 'min(70vh, 90vw)', imageRendering: 'pixelated',
                background: SCREEN_BG, border: `3px solid ${INK}`, borderRadius: 6, outline: 'none',
              }}
            />
            <div style={{ fontSize: 11, opacity: 0.7 }}>arrows / wasd · Z = O · X = X</div>
            {err && <div style={{ color: 'var(--gb-dark)', fontSize: 12, maxWidth: 360, textAlign: 'center' }}>⚠ {err}</div>}
          </div>
        ) : (
          <div style={{ opacity: 0.7 }}>No cart yet — open the maker to design one.</div>
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, border: `2px solid ${INK}`, borderRadius: 6,
  background: 'transparent', color: INK, cursor: 'pointer',
};

// Main-thread runtime: owns the cart Worker, the display canvas, the input
// capture and the fixed-step loop. The Worker does all cart logic + drawing;
// this side only feeds input and blits the returned framebuffer.

import { SCREEN } from './types';
import { paletteLUT } from './palette';
import type { Cart, WorkerOut } from './types';

const KEYMAP: Record<string, number> = {
  ArrowLeft: 0, ArrowRight: 1, ArrowUp: 2, ArrowDown: 3,
  a: 0, d: 1, w: 2, s: 3,
  z: 4, c: 4, n: 4, x: 5, v: 5, m: 5,
  ' ': 4, Enter: 5,
};

export interface RuntimeHooks {
  onError?: (message: string) => void;
}

export class CartRuntime {
  private worker: Worker | null = null;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private buf32: Uint32Array;
  private lut = paletteLUT();
  private held = 0;
  private prev = 0;
  private timer: number | null = null;
  private fps = 30;
  private keyDown = (e: KeyboardEvent) => this.onKey(e, true);
  private keyUp = (e: KeyboardEvent) => this.onKey(e, false);

  constructor(private canvas: HTMLCanvasElement, private hooks: RuntimeHooks = {}) {
    canvas.width = SCREEN;
    canvas.height = SCREEN;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.img = ctx.createImageData(SCREEN, SCREEN);
    this.buf32 = new Uint32Array(this.img.data.buffer);
  }

  /** Load (or reload) a cart and start running it. */
  load(cart: Cart) {
    this.stop();
    const w = new Worker(new URL('./cart-worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === 'frame') this.blit(m.px);
      else if (m.type === 'error') this.hooks.onError?.(m.message);
    };
    w.postMessage({ type: 'init', code: cart.code, sheet: cart.sheet, flags: cart.flags, map: cart.map });
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    this.canvas.tabIndex = 0;
    this.timer = window.setInterval(() => this.tick(), 1000 / this.fps);
  }

  stop() {
    if (this.timer != null) { clearInterval(this.timer); this.timer = null; }
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.held = this.prev = 0;
  }

  /** Current 128x128 frame as a data-URL (for cart thumbnails). */
  snapshot(): string {
    try { return this.canvas.toDataURL('image/png'); } catch { return ''; }
  }

  /** Press/release a button by index (for on-screen touch controls). */
  setButton(i: number, down: boolean) {
    if (down) this.held |= 1 << i; else this.held &= ~(1 << i);
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const i = KEYMAP[e.key];
    if (i == null) return;
    e.preventDefault();
    if (down) this.held |= 1 << i; else this.held &= ~(1 << i);
  }

  private tick() {
    if (!this.worker) return;
    const btnp = this.held & ~this.prev;
    this.prev = this.held;
    this.worker.postMessage({ type: 'tick', btn: this.held, btnp });
  }

  private blit(px: Uint8Array) {
    const buf = this.buf32;
    const lut = this.lut;
    for (let i = 0; i < px.length; i++) buf[i] = lut[px[i] & 15];
    this.ctx.putImageData(this.img, 0, 0);
  }
}

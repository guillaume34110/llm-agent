// Monkey 8-bit maker — core types & limits.
// See ENGINE-CONTEXT.md for the authoring spec these mirror.

export const SCREEN = 128; // px, square
export const SHEET = 128; // spritesheet px, square (16x16 sprites of 8x8)
export const SPR_PX = 8; // sprite edge in px
export const SPR_PER_ROW = SHEET / SPR_PX; // 16
export const SPRITE_COUNT = 256;
export const MAP_W = 128; // tiles
export const MAP_H = 32; // tiles
export const FB_LEN = SCREEN * SCREEN; // 16384 framebuffer bytes
export const SHEET_LEN = SHEET * SHEET; // 16384 sheet bytes
export const MAP_LEN = MAP_W * MAP_H; // 4096 map bytes

// Buttons (single player in v1): 0 left 1 right 2 up 3 down 4 O 5 X
export const BTN = { LEFT: 0, RIGHT: 1, UP: 2, DOWN: 3, O: 4, X: 5 } as const;

/** One game cart — fully client-owned, persisted in localStorage, server-blind. */
export interface Cart {
  id: string;
  name: string;
  code: string; // the cart program (the LLM/user writes this)
  sheet: Uint8Array; // SHEET_LEN indexed-colour bytes (the spritesheet)
  flags: Uint8Array; // SPRITE_COUNT flag bytes (collision tags)
  map: Uint8Array; // MAP_LEN sprite-id bytes (the tilemap)
  thumb?: string; // last _draw frame as a data-URL, for the library grid
  createdAt: number;
  updatedAt: number;
}

/** Per-frame input snapshot the runtime posts into the cart worker. */
export interface FrameInput {
  btn: number; // bitfield of held buttons
  btnp: number; // bitfield of edge-pressed buttons (this frame)
}

/** Worker → main messages. */
export type WorkerOut =
  | { type: 'ready' }
  | { type: 'frame'; px: Uint8Array }
  | { type: 'error'; message: string };

/** Main → worker messages. */
export type WorkerIn =
  | { type: 'init'; code: string; sheet: Uint8Array; flags: Uint8Array; map: Uint8Array }
  | { type: 'tick'; btn: number; btnp: number };

export function emptyCart(name = 'untitled'): Cart {
  return {
    id: (globalThis.crypto?.randomUUID?.() ?? `cart_${Date.now()}_${Math.random().toString(36).slice(2)}`),
    name,
    code: DEFAULT_CODE,
    sheet: new Uint8Array(SHEET_LEN),
    flags: new Uint8Array(SPRITE_COUNT),
    map: new Uint8Array(MAP_LEN),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export const DEFAULT_CODE = `// A tiny starter. Move with the arrow keys.
let x = 60, y = 60;

function _update() {
  if (btn(0)) x -= 2;
  if (btn(1)) x += 2;
  if (btn(2)) y -= 2;
  if (btn(3)) y += 2;
  x = mid(0, x, 120);
  y = mid(0, y, 120);
}

function _draw() {
  cls(1);
  print("hello world", 40, 8, 7);
  rectfill(x, y, x + 7, y + 7, 8);
  circ(x + 3, y + 3, 6, 10);
}
`;

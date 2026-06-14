// The fixed 16-colour palette (canonical PICO-8 order). Indices 0..15.
// Cart code only ever names an index; RGB lives here and on the render side.

export const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], // 0 black
  [29, 43, 83], // 1 dark-blue
  [126, 37, 83], // 2 dark-purple
  [0, 135, 81], // 3 dark-green
  [171, 82, 54], // 4 brown
  [95, 87, 79], // 5 dark-grey
  [194, 195, 199], // 6 light-grey
  [255, 241, 232], // 7 white
  [255, 0, 77], // 8 red
  [255, 163, 0], // 9 orange
  [255, 236, 39], // 10 yellow
  [0, 228, 54], // 11 green
  [41, 173, 255], // 12 blue
  [131, 118, 156], // 13 indigo
  [255, 119, 168], // 14 pink
  [255, 204, 170], // 15 peach
];

export const PALETTE_NAMES = [
  'black', 'dark-blue', 'dark-purple', 'dark-green',
  'brown', 'dark-grey', 'light-grey', 'white',
  'red', 'orange', 'yellow', 'green',
  'blue', 'indigo', 'pink', 'peach',
];

/** Pack the 16 colours into a Uint32 RGBA LUT for fast framebuffer → ImageData blit. */
export function paletteLUT(): Uint32Array {
  const lut = new Uint32Array(16);
  const big = new Uint8Array([1, 0, 0, 0])[0] === 0; // little-endian check (=> false on LE)
  for (let i = 0; i < 16; i++) {
    const [r, g, b] = PALETTE[i];
    // ImageData is RGBA little-endian => 0xAABBGGRR
    lut[i] = big ? ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0
                 : ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  return lut;
}

export function cssColor(i: number): string {
  const [r, g, b] = PALETTE[((i % 16) + 16) % 16];
  return `rgb(${r},${g},${b})`;
}

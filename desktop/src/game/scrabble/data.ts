// Scrabble static data: official tile distributions + point values per language,
// and the standard 15x15 premium-square layout. All numbers are client-owned (the
// client is authoritative on the bag, points and board); the LLM only judges word
// validity and picks its own placement. Adding a language = adding its tile table.

export type Lang = 'en' | 'fr';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

// [count, points] per letter. Blanks declared separately.
type TileTable = Record<string, [number, number]>;

const EN: TileTable = {
  A: [9, 1], B: [2, 3], C: [2, 3], D: [4, 2], E: [12, 1], F: [2, 4], G: [3, 2],
  H: [2, 4], I: [9, 1], J: [1, 8], K: [1, 5], L: [4, 1], M: [2, 3], N: [6, 1],
  O: [8, 1], P: [2, 3], Q: [1, 10], R: [6, 1], S: [4, 1], T: [6, 1], U: [4, 1],
  V: [2, 4], W: [2, 4], X: [1, 8], Y: [2, 4], Z: [1, 10],
};

const FR: TileTable = {
  A: [9, 1], B: [2, 3], C: [2, 3], D: [3, 2], E: [15, 1], F: [2, 4], G: [2, 2],
  H: [2, 4], I: [8, 1], J: [1, 8], K: [1, 10], L: [5, 1], M: [3, 2], N: [6, 1],
  O: [6, 1], P: [2, 3], Q: [1, 8], R: [6, 1], S: [6, 1], T: [6, 1], U: [6, 1],
  V: [2, 4], W: [1, 10], X: [1, 10], Y: [1, 10], Z: [1, 10],
};

const TABLES: Record<Lang, TileTable> = { en: EN, fr: FR };
const BLANKS = 2; // two blank tiles in every standard set

export function letterPoints(lang: Lang, letter: string): number {
  const t = TABLES[lang][letter.toUpperCase()];
  return t ? t[1] : 0;
}

// The full bag for a language as a flat list of letters ('' = blank), unshuffled.
export function bagLetters(lang: Lang): string[] {
  const out: string[] = [];
  const table = TABLES[lang];
  for (const [letter, [count]] of Object.entries(table)) {
    for (let i = 0; i < count; i++) out.push(letter);
  }
  for (let i = 0; i < BLANKS; i++) out.push('');
  return out;
}

// The alphabet a blank may stand for (used by the blank-letter picker UI).
export function alphabet(lang: Lang): string[] {
  return Object.keys(TABLES[lang]);
}

// ── Premium squares ──────────────────────────────────────────────────────────

export type Premium = '.' | 'DL' | 'TL' | 'DW' | 'TW';
export const BOARD_SIZE = 15;
export const CENTER = 7;

const TW: [number, number][] = [[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]];
const DW: [number, number][] = [
  [1, 1], [2, 2], [3, 3], [4, 4], [10, 10], [11, 11], [12, 12], [13, 13],
  [1, 13], [2, 12], [3, 11], [4, 10], [10, 4], [11, 3], [12, 2], [13, 1], [7, 7],
];
const TL: [number, number][] = [
  [1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13], [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9],
];
const DL: [number, number][] = [
  [0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14], [6, 2], [6, 6], [6, 8], [6, 12],
  [7, 3], [7, 11], [8, 2], [8, 6], [8, 8], [8, 12], [11, 0], [11, 7], [11, 14], [12, 6], [12, 8],
  [14, 3], [14, 11],
];

export function buildPremiums(): Premium[][] {
  const grid: Premium[][] = Array.from({ length: BOARD_SIZE }, () => Array<Premium>(BOARD_SIZE).fill('.'));
  for (const [r, c] of TW) grid[r][c] = 'TW';
  for (const [r, c] of DW) grid[r][c] = 'DW';
  for (const [r, c] of TL) grid[r][c] = 'TL';
  for (const [r, c] of DL) grid[r][c] = 'DL';
  return grid;
}

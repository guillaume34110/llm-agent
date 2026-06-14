// Shared design tokens + small label/glyph/color maps for the RPG console UI.
// Extracted from RpgConsole.tsx so the view can be split into focused component
// files that all read the same palette. Pure constants — no React, no state.

// Game Boy DMG 4-shade ramp, tinted to the current theme hue (see --gb-* in
// styles.css; shared look with ChessConsole). Follows the active theme instead
// of being locked to green.
export const SHELL = 'var(--gb-shell)';
export const SCREEN_BG = 'var(--gb-screen)';
export const DARK = 'var(--gb-dark)';
export const INK = 'var(--gb-ink)';
export const MID = 'var(--gb-mid)';
export const PAPER = 'var(--gb-light)';

export const KIND_GLYPH: Record<string, string> = {
  village: '⌂', town: '♜', wild: '∴', forest: '♣', dungeon: '☗', ruin: '⌖', cave: '◔', camp: '△',
};

export const SPRITE_PALETTE: Record<string, string> = { K: INK, D: DARK, M: MID, L: PAPER, R: '#7a1f1f' };

export const STATUS_COLOR: Record<string, string> = {
  burn: '#a8431f', bleed: '#7a1f1f', poison: '#3f6b2f', stun: '#5a4f7a',
};

export const STAT_LABEL: Record<string, string> = { might: 'MIG', agility: 'AGI', wits: 'WIT', spirit: 'SPI' };
export const POOL_STAT_LABEL: Record<string, string> = { might: 'MIGHT', agility: 'AGILITY', wits: 'WITS', spirit: 'SPIRIT' };

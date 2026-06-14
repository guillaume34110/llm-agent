// ── Progression (XP curve; client-owned) ─────────────────────────────────────
// XP to clear the CURRENT level (rises with level so the curve doesn't trivialise).
export function xpForLevel(level: number): number {
  return level * 12 + 8;
}

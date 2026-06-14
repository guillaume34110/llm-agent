// Monotonic id minter for client-side game entities (items, characters, …).
// The counter is module-local so ids stay unique within a session; the random
// suffix guards against collisions across reloads. No number here is gameplay —
// it is identity only (client-owned, never authored by the LLM).
let _idSeq = 0;

export function uid(prefix: string): string {
  _idSeq += 1;
  return `${prefix}_${_idSeq}_${Math.random().toString(36).slice(2, 7)}`;
}

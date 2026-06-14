import { generateMap } from '../src/game/rts/map';
let minSep = Infinity; const styles: Record<string, number> = {};
for (let s = 0; s < 200; s++) {
  const m = generateMap(s);
  const d = Math.hypot(m.playerStart.x - m.enemyStart.x, m.playerStart.y - m.enemyStart.y);
  minSep = Math.min(minSep, d);
  styles[m.style] = (styles[m.style] || 0) + 1;
  for (const p of [m.playerStart, m.enemyStart])
    if (p.x < 0 || p.y < 0 || p.x >= m.w || p.y >= m.h) throw new Error('start out of bounds');
  if (m.enemyStart.x !== (m.w-1)-m.playerStart.x || m.enemyStart.y !== (m.h-1)-m.playerStart.y) throw new Error('not symmetric');
}
const a = generateMap(42), b = generateMap(42);
if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('not deterministic');
if (minSep < 40) throw new Error('bases too close: ' + minSep);
console.log('min base separation:', minSep.toFixed(1), 'tiles');
console.log('style spread:', styles);
console.log('MAP OK');

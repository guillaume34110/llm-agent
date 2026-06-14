import React, { useMemo } from 'react';

// Renders a string-grid sprite (see game/rpg/sprites.ts) as crisp pixels.
// Horizontal runs of the same colour are merged into a single <rect> to keep
// the DOM light when several sprites share a scene.

// Tinted to the current theme hue via the --gb-* ramp (styles.css). Fills are
// applied through inline `style` (not the `fill` attribute) so the CSS var() is
// guaranteed to resolve in every webview, including WKWebView.
const DEFAULT_PALETTE: Record<string, string> = {
  K: 'var(--gb-ink)',    // INK
  D: 'var(--gb-dark)',   // DARK
  M: 'var(--gb-mid)',    // MID
  L: 'var(--gb-light)',  // PAPER
  R: '#7a1f1f',          // red accent (danger — stays warm across themes)
};

type Props = {
  grid: string[];
  px?: number;
  palette?: Record<string, string>;
  flip?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
};

export function PixelSprite({ grid, px = 4, palette, flip, className, style, title }: Props) {
  const { rects, w, h } = useMemo(() => {
    const map = palette ? { ...DEFAULT_PALETTE, ...palette } : DEFAULT_PALETTE;
    const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const out: React.ReactElement[] = [];
    grid.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        const fill = map[ch];
        if (!fill) { x++; continue; }
        let run = 1;
        while (x + run < row.length && row[x + run] === ch) run++;
        out.push(<rect key={`${x}-${y}`} x={x} y={y} width={run} height={1} style={{ fill }} />);
        x += run;
      }
    });
    return { rects: out, w: cols, h: grid.length };
  }, [grid, palette]);

  return (
    <svg
      width={w * px}
      height={h * px}
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      style={{
        imageRendering: 'pixelated',
        shapeRendering: 'crispEdges',
        transform: flip ? 'scaleX(-1)' : undefined,
        display: 'block',
        ...style,
      }}
      role="img"
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {rects}
    </svg>
  );
}

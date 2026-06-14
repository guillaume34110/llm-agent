import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function Butterfly(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 24" {...p}>
      <path d="M 16 4 Q 4 4 4 12 Q 4 20 14 18 Q 16 14 16 12" {...stroke} />
      <path d="M 16 4 Q 28 4 28 12 Q 28 20 18 18 Q 16 14 16 12" {...stroke} />
      <path d="M 16 4 Q 4 4 4 12 Q 4 20 14 18 Q 16 14 16 12 Z" {...fillSoft} />
      <path d="M 16 4 Q 28 4 28 12 Q 28 20 18 18 Q 16 14 16 12 Z" {...fillSoft} />
      <path d="M 16 4 L 16 20" {...stroke} strokeWidth={1.4} />
      <path d="M 16 4 L 14 1" {...stroke} strokeWidth={0.6} />
      <path d="M 16 4 L 18 1" {...stroke} strokeWidth={0.6} />
      <circle cx="9" cy="10" r="1" fill="currentColor" opacity={0.5} />
      <circle cx="23" cy="10" r="1" fill="currentColor" opacity={0.5} />
    </svg>
  );
}

export function Bee(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 22" {...p}>
      <ellipse cx="14" cy="12" rx="9" ry="6" {...stroke} />
      <ellipse cx="14" cy="12" rx="9" ry="6" {...fillSoft} />
      <path d="M 10 7 L 10 17" {...stroke} strokeWidth={0.8} />
      <path d="M 18 7 L 18 17" {...stroke} strokeWidth={0.8} />
      <ellipse cx="10" cy="6" rx="4" ry="3" {...stroke} />
      <ellipse cx="18" cy="6" rx="4" ry="3" {...stroke} />
      <circle cx="22" cy="11" r="0.7" fill="currentColor" />
    </svg>
  );
}

export function Ladybug(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <circle cx="12" cy="14" r="9" {...stroke} />
      <circle cx="12" cy="14" r="9" {...fillSoft} />
      <path d="M 12 5 L 12 23" {...stroke} strokeWidth={0.9} />
      <circle cx="7" cy="12" r="1.2" fill="currentColor" opacity={0.7} />
      <circle cx="17" cy="12" r="1.2" fill="currentColor" opacity={0.7} />
      <circle cx="8" cy="17" r="1" fill="currentColor" opacity={0.7} />
      <circle cx="16" cy="17" r="1" fill="currentColor" opacity={0.7} />
      <circle cx="12" cy="7" r="2" fill="currentColor" opacity={0.6} />
    </svg>
  );
}

export function Mushroom(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 28" {...p}>
      <path d="M 4 14 Q 4 4 12 4 Q 20 4 20 14 Z" {...stroke} />
      <path d="M 4 14 Q 4 4 12 4 Q 20 4 20 14 Z" {...fillSoft} />
      <path d="M 9 14 L 9 24 Q 12 26 15 24 L 15 14 Z" {...stroke} />
      <path d="M 9 14 L 9 24 Q 12 26 15 24 L 15 14 Z" {...fillSoft} />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" opacity={0.55} />
      <circle cx="14" cy="11" r="1" fill="currentColor" opacity={0.55} />
      <circle cx="16" cy="7" r="0.9" fill="currentColor" opacity={0.55} />
    </svg>
  );
}

export function Snail(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 22" {...p}>
      <circle cx="11" cy="11" r="8" {...stroke} />
      <circle cx="11" cy="11" r="8" {...fillSoft} />
      <path d="M 11 11 Q 11 5 15 5 Q 17 5 17 9 Q 17 11 13 11" {...stroke} strokeWidth={0.8} />
      <path d="M 18 16 Q 24 14 28 18 L 28 19 L 4 19 Q 6 16 12 16" {...stroke} />
      <path d="M 26 14 L 26 11" {...stroke} />
      <path d="M 28 13 L 28 10" {...stroke} />
      <circle cx="26" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="28" cy="9.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function Web(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" {...p}>
      <path d="M 14 2 L 14 26" {...stroke} strokeWidth={0.7} />
      <path d="M 2 14 L 26 14" {...stroke} strokeWidth={0.7} />
      <path d="M 5 5 L 23 23" {...stroke} strokeWidth={0.7} />
      <path d="M 23 5 L 5 23" {...stroke} strokeWidth={0.7} />
      <path d="M 14 8 Q 18 10 20 14 Q 18 18 14 20 Q 10 18 8 14 Q 10 10 14 8 Z" {...stroke} />
      <path d="M 14 5 Q 22 8 23 14 Q 22 20 14 23 Q 6 20 5 14 Q 6 8 14 5 Z" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export const INSECT_POOL: MascotEntry[] = [
  { id: 'butterfly', Component: Butterfly, weight: 1.5, role: 'flyer' },
  { id: 'bee', Component: Bee, weight: 1.3, role: 'flyer' },
  { id: 'ladybug', Component: Ladybug, weight: 1.4, role: 'walker' },
  { id: 'mushroom', Component: Mushroom, weight: 1.3, role: 'fixed-ground' },
  { id: 'snail', Component: Snail, weight: 1.0, role: 'walker' },
  { id: 'web', Component: Web, weight: 0.7, role: 'climber' },
];

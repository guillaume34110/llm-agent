import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function MouseSit(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 24" {...p}>
      <circle cx="8" cy="8" r="3" {...stroke} />
      <circle cx="14" cy="8" r="3" {...stroke} />
      <circle cx="8" cy="8" r="3" {...fillSoft} />
      <circle cx="14" cy="8" r="3" {...fillSoft} />
      <ellipse cx="11" cy="14" rx="7" ry="6" {...stroke} />
      <ellipse cx="11" cy="14" rx="7" ry="6" {...fillSoft} />
      <circle cx="9" cy="13" r="0.6" fill="currentColor" />
      <circle cx="13" cy="13" r="0.6" fill="currentColor" />
      <ellipse cx="11" cy="15" rx="0.6" ry="0.4" fill="currentColor" opacity={0.8} />
      <path d="M 18 18 Q 24 16 26 22" {...stroke} />
    </svg>
  );
}

export function Cheese(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 24" {...p}>
      <path d="M 4 20 L 14 6 L 28 14 L 28 20 Z" {...stroke} />
      <path d="M 4 20 L 14 6 L 28 14 L 28 20 Z" {...fillSoft} />
      <path d="M 4 20 L 14 6" {...stroke} />
      <circle cx="14" cy="16" r="1.4" fill="currentColor" opacity={0.5} />
      <circle cx="22" cy="16" r="1.1" fill="currentColor" opacity={0.5} />
      <circle cx="18" cy="13" r="0.9" fill="currentColor" opacity={0.5} />
    </svg>
  );
}

export function Acorn(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 28" {...p}>
      <ellipse cx="12" cy="18" rx="6" ry="7" {...stroke} />
      <ellipse cx="12" cy="18" rx="6" ry="7" {...fillSoft} />
      <path d="M 4 10 Q 4 6 12 6 Q 20 6 20 10 Q 20 12 12 12 Q 4 12 4 10 Z" {...stroke} />
      <path d="M 4 10 Q 4 6 12 6 Q 20 6 20 10 Q 20 12 12 12 Q 4 12 4 10 Z" {...fillSoft} />
      <path d="M 12 6 L 12 2" {...stroke} />
      <path d="M 6 9 L 18 9" {...stroke} strokeWidth={0.7} />
      <path d="M 9 11 L 15 11" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export function Carrot(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 32" {...p}>
      <path d="M 8 12 L 6 30 L 18 30 L 16 12 Z" {...stroke} />
      <path d="M 8 12 L 6 30 L 18 30 L 16 12 Z" {...fillSoft} />
      <path d="M 9 16 L 13 18" {...stroke} strokeWidth={0.7} />
      <path d="M 8 22 L 14 22" {...stroke} strokeWidth={0.7} />
      <path d="M 8 12 Q 4 8 6 4 Q 12 8 12 12" {...stroke} />
      <path d="M 12 12 Q 14 4 18 4 Q 18 10 16 12" {...stroke} />
      <path d="M 16 12 Q 22 8 22 4 Q 18 8 16 12" {...stroke} />
    </svg>
  );
}

export function BunnyEars(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 24" {...p}>
      <ellipse cx="10" cy="10" rx="3" ry="8" {...stroke} />
      <ellipse cx="18" cy="10" rx="3" ry="8" {...stroke} />
      <ellipse cx="10" cy="10" rx="3" ry="8" {...fillSoft} />
      <ellipse cx="18" cy="10" rx="3" ry="8" {...fillSoft} />
      <ellipse cx="10" cy="12" rx="1.4" ry="4" fill="currentColor" opacity={0.4} />
      <ellipse cx="18" cy="12" rx="1.4" ry="4" fill="currentColor" opacity={0.4} />
    </svg>
  );
}

export function Burrow(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 20" {...p}>
      <path d="M 2 18 Q 8 8 18 8 Q 28 8 34 18" {...stroke} />
      <ellipse cx="18" cy="14" rx="6" ry="5" fill="currentColor" opacity={0.55} />
      <circle cx="6" cy="16" r="0.7" fill="currentColor" opacity={0.4} />
      <circle cx="30" cy="16" r="0.7" fill="currentColor" opacity={0.4} />
    </svg>
  );
}

export const RODENT_POOL: MascotEntry[] = [
  { id: 'mouse-sit', Component: MouseSit, weight: 1.0, role: 'walker' },
  { id: 'cheese', Component: Cheese, weight: 1.2, role: 'fixed-ground' },
  { id: 'acorn', Component: Acorn, weight: 1.4, role: 'fixed-ground' },
  { id: 'carrot', Component: Carrot, weight: 1.2, role: 'fixed-ground' },
  { id: 'bunny-ears', Component: BunnyEars, weight: 1.1, role: 'hopper' },
  { id: 'burrow', Component: Burrow, weight: 0.7, role: 'fixed-ground' },
];

import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function HorseHead(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" {...p}>
      <path d="M 8 28 Q 6 18 10 12 Q 12 4 18 6 Q 24 10 22 18 Q 24 22 22 28" {...stroke} />
      <path d="M 8 28 Q 6 18 10 12 Q 12 4 18 6 Q 24 10 22 18 Q 24 22 22 28" {...fillSoft} />
      <path d="M 12 4 L 14 8" {...stroke} />
      <path d="M 17 5 L 17 9" {...stroke} />
      <circle cx="18" cy="14" r="0.9" fill="currentColor" />
      <ellipse cx="20" cy="20" rx="1" ry="0.7" fill="currentColor" opacity={0.7} />
    </svg>
  );
}

export function Horseshoe(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" {...p}>
      <path d="M 6 6 Q 4 18 14 24 Q 24 18 22 6 L 18 6 Q 20 16 14 20 Q 8 16 10 6 Z" {...stroke} />
      <path d="M 6 6 Q 4 18 14 24 Q 24 18 22 6 L 18 6 Q 20 16 14 20 Q 8 16 10 6 Z" {...fillSoft} />
      <circle cx="8" cy="9" r="0.7" fill="currentColor" />
      <circle cx="20" cy="9" r="0.7" fill="currentColor" />
      <circle cx="14" cy="22" r="0.7" fill="currentColor" />
    </svg>
  );
}

export function Hoof(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 24" {...p}>
      <path d="M 4 4 Q 4 18 10 22 Q 16 18 16 4 Z" {...stroke} />
      <path d="M 4 4 Q 4 18 10 22 Q 16 18 16 4 Z" {...fillSoft} />
      <path d="M 10 4 L 10 22" {...stroke} strokeWidth={0.8} />
    </svg>
  );
}

export function Mane(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 16" {...p}>
      <path d="M 2 14 Q 4 4 8 6 Q 10 2 14 6 Q 16 2 20 6 Q 24 2 26 6 Q 28 4 30 14" {...stroke} />
      <path d="M 2 14 Q 4 4 8 6 Q 10 2 14 6 Q 16 2 20 6 Q 24 2 26 6 Q 28 4 30 14 Z" {...fillSoft} />
    </svg>
  );
}

export function FlowerCrown(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 16" {...p}>
      <path d="M 2 14 Q 16 6 30 14" {...stroke} />
      <circle cx="8" cy="10" r="2" {...stroke} />
      <circle cx="16" cy="7" r="2.4" {...stroke} />
      <circle cx="24" cy="10" r="2" {...stroke} />
      <circle cx="8" cy="10" r="2" {...fillSoft} />
      <circle cx="16" cy="7" r="2.4" {...fillSoft} />
      <circle cx="24" cy="10" r="2" {...fillSoft} />
      <circle cx="8" cy="10" r="0.6" fill="currentColor" />
      <circle cx="16" cy="7" r="0.7" fill="currentColor" />
      <circle cx="24" cy="10" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function Apple(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 28" {...p}>
      <path d="M 12 6 Q 6 6 5 14 Q 5 24 12 24 Q 19 24 19 14 Q 18 6 12 6 Z" {...stroke} />
      <path d="M 12 6 Q 6 6 5 14 Q 5 24 12 24 Q 19 24 19 14 Q 18 6 12 6 Z" {...fillSoft} />
      <path d="M 12 6 Q 13 3 15 2" {...stroke} />
      <ellipse cx="14" cy="3" rx="2" ry="1" transform="rotate(20 14 3)" {...stroke} />
    </svg>
  );
}

export const EQUID_POOL: MascotEntry[] = [
  { id: 'horse-head', Component: HorseHead, weight: 1.0, role: 'walker' },
  { id: 'horseshoe', Component: Horseshoe, weight: 1.4, role: 'fixed-ground' },
  { id: 'hoof', Component: Hoof, weight: 1.2, role: 'fixed-ground' },
  { id: 'mane', Component: Mane, weight: 0.8, role: 'fixed-ground' },
  { id: 'flower-crown', Component: FlowerCrown, weight: 1.1, role: 'fixed-ground' },
  { id: 'apple', Component: Apple, weight: 1.2, role: 'fixed-ground' },
];

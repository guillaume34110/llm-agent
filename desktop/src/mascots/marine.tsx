import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function Wave(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 12" {...p}>
      <path d="M 2 8 Q 6 2 10 8 Q 14 12 18 8 Q 22 2 26 8 Q 30 12 34 8" {...stroke} />
      <path d="M 2 8 Q 6 2 10 8 Q 14 12 18 8 Q 22 2 26 8 Q 30 12 34 8 L 34 12 L 2 12 Z" {...fillSoft} />
    </svg>
  );
}

export function Bubble(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" {...p}>
      <circle cx="10" cy="10" r="7" {...stroke} />
      <circle cx="10" cy="10" r="7" {...fillSoft} />
      <ellipse cx="7" cy="7" rx="1.6" ry="2" fill="currentColor" opacity={0.4} transform="rotate(-30 7 7)" />
    </svg>
  );
}

export function FishSmall(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 18" {...p}>
      <path d="M 4 9 Q 8 2 18 4 Q 26 6 28 9 Q 26 12 18 14 Q 8 16 4 9 Z" {...stroke} />
      <path d="M 4 9 Q 8 2 18 4 Q 26 6 28 9 Q 26 12 18 14 Q 8 16 4 9 Z" {...fillSoft} />
      <path d="M 28 9 L 30 5 L 30 13 Z" {...stroke} />
      <path d="M 28 9 L 30 5 L 30 13 Z" {...fillSoft} />
      <circle cx="9" cy="8" r="0.9" fill="currentColor" />
      <path d="M 14 8 L 20 8" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export function Octopus(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 28" {...p}>
      <path d="M 16 4 Q 6 4 6 14 Q 6 18 8 18 L 24 18 Q 26 18 26 14 Q 26 4 16 4 Z" {...stroke} />
      <path d="M 16 4 Q 6 4 6 14 Q 6 18 8 18 L 24 18 Q 26 18 26 14 Q 26 4 16 4 Z" {...fillSoft} />
      <path d="M 8 18 Q 6 24 4 22" {...stroke} />
      <path d="M 12 18 Q 12 24 10 26" {...stroke} />
      <path d="M 16 18 Q 16 24 16 26" {...stroke} />
      <path d="M 20 18 Q 20 24 22 26" {...stroke} />
      <path d="M 24 18 Q 26 24 28 22" {...stroke} />
      <circle cx="13" cy="11" r="0.9" fill="currentColor" />
      <circle cx="19" cy="11" r="0.9" fill="currentColor" />
      <path d="M 14 14 Q 16 16 18 14" {...stroke} />
    </svg>
  );
}

export function Whale(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 20" {...p}>
      <path d="M 4 14 Q 4 6 14 6 Q 26 6 28 12 L 34 8 L 32 14 L 34 18 L 28 16 Q 24 18 14 18 Q 4 18 4 14 Z" {...stroke} />
      <path d="M 4 14 Q 4 6 14 6 Q 26 6 28 12 L 34 8 L 32 14 L 34 18 L 28 16 Q 24 18 14 18 Q 4 18 4 14 Z" {...fillSoft} />
      <circle cx="8" cy="11" r="0.8" fill="currentColor" />
      <path d="M 12 4 Q 10 0 12 -2" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export function Seaweed(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 32" {...p}>
      <path d="M 8 32 Q 4 26 8 22 Q 12 18 8 14 Q 4 10 8 6 Q 10 4 8 2" {...stroke} />
      <path d="M 8 32 Q 12 26 8 22" {...stroke} strokeWidth={0.8} />
      <path d="M 8 22 Q 4 18 8 14" {...stroke} strokeWidth={0.8} />
    </svg>
  );
}

export const MARINE_POOL: MascotEntry[] = [
  { id: 'wave', Component: Wave, weight: 1.6, role: 'fixed-ground' },
  { id: 'bubble', Component: Bubble, weight: 1.4, role: 'sparkle' },
  { id: 'fish-small', Component: FishSmall, weight: 1.3, role: 'swimmer' },
  { id: 'octopus', Component: Octopus, weight: 0.9, role: 'swimmer' },
  { id: 'whale', Component: Whale, weight: 0.8, role: 'swimmer' },
  { id: 'seaweed', Component: Seaweed, weight: 1.0, role: 'fixed-ground' },
];

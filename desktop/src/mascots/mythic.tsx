import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function Star(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M 12 2 L 14.4 9.2 L 22 9.2 L 15.8 13.6 L 18.2 21 L 12 16.4 L 5.8 21 L 8.2 13.6 L 2 9.2 L 9.6 9.2 Z" {...stroke} />
      <path d="M 12 2 L 14.4 9.2 L 22 9.2 L 15.8 13.6 L 18.2 21 L 12 16.4 L 5.8 21 L 8.2 13.6 L 2 9.2 L 9.6 9.2 Z" {...fillSoft} />
    </svg>
  );
}

export function Moon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M 18 6 Q 8 6 8 14 Q 8 22 18 22 Q 10 18 10 14 Q 10 8 18 6 Z" {...stroke} />
      <path d="M 18 6 Q 8 6 8 14 Q 8 22 18 22 Q 10 18 10 14 Q 10 8 18 6 Z" {...fillSoft} />
      <circle cx="6" cy="6" r="0.8" fill="currentColor" opacity={0.7} />
      <circle cx="22" cy="10" r="0.6" fill="currentColor" opacity={0.7} />
    </svg>
  );
}

export function Crystal(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 28" {...p}>
      <path d="M 10 2 L 4 12 L 10 26 L 16 12 Z" {...stroke} />
      <path d="M 10 2 L 4 12 L 10 26 L 16 12 Z" {...fillSoft} />
      <path d="M 4 12 L 16 12" {...stroke} />
      <path d="M 10 2 L 10 26" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export function Sparkle(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" {...p}>
      <path d="M 10 2 L 11 9 L 18 10 L 11 11 L 10 18 L 9 11 L 2 10 L 9 9 Z" fill="currentColor" opacity={0.7} />
    </svg>
  );
}

export function DragonScale(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" {...p}>
      <path d="M 4 18 Q 4 10 14 10 Q 24 10 24 18 Q 14 14 4 18 Z" {...stroke} />
      <path d="M 4 18 Q 4 10 14 10 Q 24 10 24 18 Q 14 14 4 18 Z" {...fillSoft} />
      <path d="M 8 22 Q 8 16 14 16 Q 20 16 20 22 Q 14 19 8 22 Z" {...stroke} />
      <path d="M 8 22 Q 8 16 14 16 Q 20 16 20 22 Q 14 19 8 22 Z" {...fillSoft} />
    </svg>
  );
}

export function MagicWand(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M 4 20 L 18 6" {...stroke} strokeWidth={1.8} />
      <path d="M 18 4 L 19 6 L 21 7 L 19 8 L 18 10 L 17 8 L 15 7 L 17 6 Z" fill="currentColor" opacity={0.8} />
      <circle cx="22" cy="3" r="0.8" fill="currentColor" />
      <circle cx="14" cy="3" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function Wing(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 24" {...p}>
      <path d="M 4 20 Q 6 8 16 4 Q 26 8 28 20 Q 24 14 16 14 Q 8 14 4 20 Z" {...stroke} />
      <path d="M 4 20 Q 6 8 16 4 Q 26 8 28 20 Q 24 14 16 14 Q 8 14 4 20 Z" {...fillSoft} />
      <path d="M 10 16 Q 16 10 22 16" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export const MYTHIC_POOL: MascotEntry[] = [
  { id: 'star', Component: Star, weight: 1.4, role: 'sparkle' },
  { id: 'moon', Component: Moon, weight: 1.2, role: 'cloud' },
  { id: 'crystal', Component: Crystal, weight: 1.1, role: 'fixed-ground' },
  { id: 'sparkle', Component: Sparkle, weight: 1.8, role: 'sparkle' },
  { id: 'dragon-scale', Component: DragonScale, weight: 0.9, role: 'fixed-ground' },
  { id: 'magic-wand', Component: MagicWand, weight: 0.9, role: 'fixed-ground' },
  { id: 'wing', Component: Wing, weight: 1.0, role: 'flyer' },
];

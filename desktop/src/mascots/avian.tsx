import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function BirdSit(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 28" {...p}>
      <circle cx="12" cy="10" r="5" {...stroke} />
      <circle cx="12" cy="10" r="5" {...fillSoft} />
      <path d="M 16 10 L 22 8 L 16 12 Z" {...stroke} fill="currentColor" opacity={0.7} />
      <path d="M 8 14 Q 6 22 14 22 Q 24 22 24 14 Q 22 10 16 10" {...stroke} />
      <path d="M 8 14 Q 6 22 14 22 Q 24 22 24 14 Q 22 10 16 10 Z" {...fillSoft} />
      <circle cx="11" cy="9" r="0.8" fill="currentColor" />
      <path d="M 14 22 L 14 25" {...stroke} />
      <path d="M 18 22 L 18 25" {...stroke} />
    </svg>
  );
}

export function Feather(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 32" {...p}>
      <path d="M 8 30 L 8 4 Q 4 8 4 18 Q 4 24 8 26" {...stroke} />
      <path d="M 8 4 Q 12 8 12 18 Q 12 24 8 26 Z" {...stroke} />
      <path d="M 8 4 Q 12 8 12 18 Q 12 24 8 26 Z" {...fillSoft} />
      <path d="M 8 4 Q 4 8 4 18 Q 4 24 8 26 Z" {...fillSoft} />
      <path d="M 6 12 L 8 12" {...stroke} strokeWidth={0.6} />
      <path d="M 6 18 L 8 18" {...stroke} strokeWidth={0.6} />
      <path d="M 8 12 L 10 12" {...stroke} strokeWidth={0.6} />
      <path d="M 8 18 L 10 18" {...stroke} strokeWidth={0.6} />
    </svg>
  );
}

export function Egg(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 26" {...p}>
      <path d="M 10 2 Q 4 6 4 16 Q 4 24 10 24 Q 16 24 16 16 Q 16 6 10 2 Z" {...stroke} />
      <path d="M 10 2 Q 4 6 4 16 Q 4 24 10 24 Q 16 24 16 16 Q 16 6 10 2 Z" {...fillSoft} />
      <circle cx="8" cy="12" r="0.8" fill="currentColor" opacity={0.5} />
      <circle cx="12" cy="16" r="0.7" fill="currentColor" opacity={0.5} />
      <circle cx="9" cy="18" r="0.6" fill="currentColor" opacity={0.5} />
    </svg>
  );
}

export function Nest(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 22" {...p}>
      <path d="M 4 16 Q 4 8 16 8 Q 28 8 28 16 Q 28 20 16 20 Q 4 20 4 16 Z" {...stroke} />
      <path d="M 4 16 Q 4 8 16 8 Q 28 8 28 16 Q 28 20 16 20 Q 4 20 4 16 Z" {...fillSoft} />
      <path d="M 6 12 Q 14 14 22 11" {...stroke} strokeWidth={0.7} />
      <path d="M 8 16 Q 16 18 24 15" {...stroke} strokeWidth={0.7} />
      <ellipse cx="13" cy="10" rx="2.2" ry="2.6" {...stroke} />
      <ellipse cx="18" cy="10" rx="2.2" ry="2.6" {...stroke} />
    </svg>
  );
}

export function Wing(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 20" {...p}>
      <path d="M 4 16 Q 14 4 28 6 Q 22 12 28 14 Q 18 14 14 18 Q 8 18 4 16 Z" {...stroke} />
      <path d="M 4 16 Q 14 4 28 6 Q 22 12 28 14 Q 18 14 14 18 Q 8 18 4 16 Z" {...fillSoft} />
      <path d="M 10 13 Q 18 10 24 10" {...stroke} strokeWidth={0.7} />
      <path d="M 8 16 Q 16 14 22 13" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export function Tweet(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 24" {...p}>
      <path d="M 4 6 Q 4 14 12 14 Q 14 18 12 22 Q 18 20 18 14 Q 24 14 24 6 Q 24 2 14 2 Q 4 2 4 6 Z" {...stroke} />
      <path d="M 4 6 Q 4 14 12 14 Q 14 18 12 22 Q 18 20 18 14 Q 24 14 24 6 Q 24 2 14 2 Q 4 2 4 6 Z" {...fillSoft} />
      <path d="M 10 8 Q 14 6 18 8" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export const AVIAN_POOL: MascotEntry[] = [
  { id: 'bird-sit', Component: BirdSit, weight: 1.1, role: 'fixed-ground' },
  { id: 'feather', Component: Feather, weight: 1.6, role: 'flyer' },
  { id: 'egg', Component: Egg, weight: 1.2, role: 'fixed-ground' },
  { id: 'nest', Component: Nest, weight: 0.9, role: 'fixed-ground' },
  { id: 'wing', Component: Wing, weight: 1.0, role: 'flyer' },
  { id: 'tweet', Component: Tweet, weight: 0.8, role: 'sparkle' },
];

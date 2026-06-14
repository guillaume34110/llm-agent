import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function CatSit(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" {...p}>
      <path d="M 9 9 L 11 4 L 14 9" {...stroke} />
      <path d="M 18 9 L 21 4 L 23 9" {...stroke} />
      <ellipse cx="16" cy="13" rx="6.5" ry="5.5" {...stroke} />
      <ellipse cx="16" cy="13" rx="6.5" ry="5.5" {...fillSoft} />
      <ellipse cx="16" cy="23" rx="7.5" ry="6" {...stroke} />
      <ellipse cx="16" cy="23" rx="7.5" ry="6" {...fillSoft} />
      <path d="M 23 23 Q 30 22 27 13" {...stroke} />
      <circle cx="13.5" cy="13" r="0.8" fill="currentColor" />
      <circle cx="18.5" cy="13" r="0.8" fill="currentColor" />
      <path d="M 16 15 L 15 16 L 17 16 Z" fill="currentColor" opacity={0.7} />
    </svg>
  );
}

export function CatCurl(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 24" {...p}>
      <path d="M 4 16 Q 4 6 16 6 Q 28 6 32 12 Q 33 20 24 21 Q 14 21 14 16 Q 14 12 18 12 Q 22 12 22 16" {...stroke} />
      <path d="M 4 16 Q 4 6 16 6 Q 28 6 32 12 Q 33 20 24 21 Q 14 21 14 16 Q 14 12 18 12 Q 22 12 22 16" {...fillSoft} />
      <path d="M 4 16 L 3 12 L 7 13" {...stroke} />
      <path d="M 32 12 L 33 8 L 29 10" {...stroke} />
      <path d="M 8 11 L 7 9" {...stroke} strokeWidth={0.8} />
      <path d="M 11 10 L 10 8" {...stroke} strokeWidth={0.8} />
    </svg>
  );
}

export function PawPrint(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <ellipse cx="12" cy="16" rx="5" ry="4" fill="currentColor" opacity={0.75} />
      <ellipse cx="5" cy="10" rx="2.2" ry="2.8" fill="currentColor" opacity={0.75} />
      <ellipse cx="9.5" cy="6" rx="2" ry="2.6" fill="currentColor" opacity={0.75} />
      <ellipse cx="14.5" cy="6" rx="2" ry="2.6" fill="currentColor" opacity={0.75} />
      <ellipse cx="19" cy="10" rx="2.2" ry="2.8" fill="currentColor" opacity={0.75} />
    </svg>
  );
}

export function WhiskerTuft(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 18" {...p}>
      <path d="M 3 4 Q 14 6 29 3" {...stroke} />
      <path d="M 3 9 Q 14 11 29 9" {...stroke} />
      <path d="M 3 14 Q 14 16 29 13" {...stroke} />
      <circle cx="16" cy="9" r="0.9" fill="currentColor" opacity={0.7} />
    </svg>
  );
}

export function YarnBall(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" {...p}>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <circle cx="12" cy="12" r="9" {...fillSoft} />
      <path d="M 3 12 Q 12 6 21 12" {...stroke} strokeWidth={0.9} />
      <path d="M 3 12 Q 12 18 21 12" {...stroke} strokeWidth={0.9} />
      <path d="M 12 3 Q 18 12 12 21" {...stroke} strokeWidth={0.9} />
      <path d="M 12 3 Q 6 12 12 21" {...stroke} strokeWidth={0.9} />
      <path d="M 20 14 Q 25 18 22 24 Q 19 25 21 27" {...stroke} />
    </svg>
  );
}

export function CatTail(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 28" {...p}>
      <path d="M 6 26 Q 4 16 12 12 Q 22 8 18 2" {...stroke} strokeWidth={1.6} />
      <circle cx="18" cy="2" r="1" fill="currentColor" />
    </svg>
  );
}

export function CatEars(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 18" {...p}>
      <path d="M 4 16 L 9 3 L 15 14" {...stroke} />
      <path d="M 4 16 L 9 3 L 15 14 Z" {...fillSoft} />
      <path d="M 17 14 L 23 3 L 28 16" {...stroke} />
      <path d="M 17 14 L 23 3 L 28 16 Z" {...fillSoft} />
      <path d="M 9 6 L 9 11" {...stroke} strokeWidth={0.8} />
      <path d="M 23 6 L 23 11" {...stroke} strokeWidth={0.8} />
    </svg>
  );
}

export const FELINE_POOL: MascotEntry[] = [
  { id: 'cat-sit', Component: CatSit, weight: 1.2, role: 'fixed-ground' },
  { id: 'cat-curl', Component: CatCurl, weight: 1.0, role: 'fixed-ground' },
  { id: 'paw-print', Component: PawPrint, weight: 1.8, role: 'fixed-ground' },
  { id: 'whisker-tuft', Component: WhiskerTuft, weight: 1.4, role: 'sparkle' },
  { id: 'yarn-ball', Component: YarnBall, weight: 0.9, role: 'walker' },
  { id: 'cat-tail', Component: CatTail, weight: 1.0, role: 'fixed-ground' },
  { id: 'cat-ears', Component: CatEars, weight: 1.1, role: 'fixed-ground' },
];

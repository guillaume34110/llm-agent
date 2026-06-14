import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function DogSit(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" {...p}>
      <path d="M 8 8 Q 7 13 10 14" {...stroke} />
      <path d="M 24 8 Q 25 13 22 14" {...stroke} />
      <ellipse cx="16" cy="14" rx="7" ry="6" {...stroke} />
      <ellipse cx="16" cy="14" rx="7" ry="6" {...fillSoft} />
      <ellipse cx="16" cy="24" rx="8" ry="6" {...stroke} />
      <ellipse cx="16" cy="24" rx="8" ry="6" {...fillSoft} />
      <circle cx="13.5" cy="13" r="0.8" fill="currentColor" />
      <circle cx="18.5" cy="13" r="0.8" fill="currentColor" />
      <ellipse cx="16" cy="16" rx="1.2" ry="0.9" fill="currentColor" opacity={0.8} />
    </svg>
  );
}

export function DogPaw(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <ellipse cx="12" cy="15" rx="5.5" ry="4.5" fill="currentColor" opacity={0.7} />
      <circle cx="5" cy="9" r="2.4" fill="currentColor" opacity={0.7} />
      <circle cx="9" cy="5" r="2.2" fill="currentColor" opacity={0.7} />
      <circle cx="15" cy="5" r="2.2" fill="currentColor" opacity={0.7} />
      <circle cx="19" cy="9" r="2.4" fill="currentColor" opacity={0.7} />
    </svg>
  );
}

export function FoxFace(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 28" {...p}>
      <path d="M 5 6 L 10 14 L 16 12 L 22 14 L 27 6 L 23 18 Q 16 25 9 18 Z" {...stroke} />
      <path d="M 5 6 L 10 14 L 16 12 L 22 14 L 27 6 L 23 18 Q 16 25 9 18 Z" {...fillSoft} />
      <circle cx="12" cy="15" r="0.9" fill="currentColor" />
      <circle cx="20" cy="15" r="0.9" fill="currentColor" />
      <path d="M 15 18 L 16 20 L 17 18" {...stroke} />
    </svg>
  );
}

export function Bone(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 16" {...p}>
      <path d="M 5 8 Q 2 5 5 3 Q 8 3 8 5 Q 11 4 16 8 Q 21 4 24 5 Q 24 3 27 3 Q 30 5 27 8 Q 30 11 27 13 Q 24 13 24 11 Q 21 12 16 8 Q 11 12 8 11 Q 8 13 5 13 Q 2 11 5 8 Z" {...stroke} />
      <path d="M 5 8 Q 2 5 5 3 Q 8 3 8 5 Q 11 4 16 8 Q 21 4 24 5 Q 24 3 27 3 Q 30 5 27 8 Q 30 11 27 13 Q 24 13 24 11 Q 21 12 16 8 Q 11 12 8 11 Q 8 13 5 13 Q 2 11 5 8 Z" {...fillSoft} />
    </svg>
  );
}

export function FoxTail(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 24" {...p}>
      <path d="M 4 22 Q 2 14 8 10 Q 18 6 24 2 Q 22 8 18 10 Q 26 12 22 18 Q 14 22 4 22 Z" {...stroke} />
      <path d="M 4 22 Q 2 14 8 10 Q 18 6 24 2 Q 22 8 18 10 Q 26 12 22 18 Q 14 22 4 22 Z" {...fillSoft} />
      <path d="M 22 2 Q 23 5 21 7" {...stroke} strokeWidth={0.8} />
    </svg>
  );
}

export function Bandana(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 20" {...p}>
      <path d="M 4 4 L 28 4 L 16 18 Z" {...stroke} />
      <path d="M 4 4 L 28 4 L 16 18 Z" {...fillSoft} />
      <circle cx="11" cy="8" r="0.8" fill="currentColor" opacity={0.7} />
      <circle cx="16" cy="10" r="0.8" fill="currentColor" opacity={0.7} />
      <circle cx="21" cy="8" r="0.8" fill="currentColor" opacity={0.7} />
    </svg>
  );
}

export const CANINE_POOL: MascotEntry[] = [
  { id: 'dog-sit', Component: DogSit, weight: 1.1, role: 'walker' },
  { id: 'dog-paw', Component: DogPaw, weight: 1.8, role: 'fixed-ground' },
  { id: 'fox-face', Component: FoxFace, weight: 1.0, role: 'walker' },
  { id: 'bone', Component: Bone, weight: 1.3, role: 'fixed-ground' },
  { id: 'fox-tail', Component: FoxTail, weight: 0.9, role: 'fixed-ground' },
  { id: 'bandana', Component: Bandana, weight: 0.8, role: 'flyer' },
];

import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function MonkeyFace(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" {...p}>
      <circle cx="16" cy="16" r="10" {...stroke} />
      <circle cx="16" cy="16" r="10" {...fillSoft} />
      <ellipse cx="16" cy="20" rx="6" ry="5" {...stroke} />
      <circle cx="7" cy="13" r="2.5" {...stroke} />
      <circle cx="25" cy="13" r="2.5" {...stroke} />
      <circle cx="13" cy="16" r="0.8" fill="currentColor" />
      <circle cx="19" cy="16" r="0.8" fill="currentColor" />
      <path d="M 14 21 Q 16 23 18 21" {...stroke} />
    </svg>
  );
}

export function Banana(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 24" {...p}>
      <path d="M 6 4 Q 4 16 14 20 Q 26 22 28 14 Q 22 18 16 16 Q 10 12 10 4 Z" {...stroke} />
      <path d="M 6 4 Q 4 16 14 20 Q 26 22 28 14 Q 22 18 16 16 Q 10 12 10 4 Z" {...fillSoft} />
      <path d="M 7 4 Q 8 2 10 4" {...stroke} />
    </svg>
  );
}

export function Vine(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 36" {...p}>
      <path d="M 10 2 Q 4 8 10 14 Q 16 20 10 26 Q 4 32 10 36" {...stroke} />
      <ellipse cx="6" cy="10" rx="2.5" ry="1.5" transform="rotate(-30 6 10)" {...stroke} />
      <ellipse cx="14" cy="20" rx="2.5" ry="1.5" transform="rotate(30 14 20)" {...stroke} />
      <ellipse cx="6" cy="30" rx="2.5" ry="1.5" transform="rotate(-30 6 30)" {...stroke} />
      <ellipse cx="6" cy="10" rx="2.5" ry="1.5" transform="rotate(-30 6 10)" {...fillSoft} />
      <ellipse cx="14" cy="20" rx="2.5" ry="1.5" transform="rotate(30 14 20)" {...fillSoft} />
    </svg>
  );
}

export function Coconut(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <circle cx="12" cy="13" r="9" {...stroke} />
      <circle cx="12" cy="13" r="9" {...fillSoft} />
      <circle cx="9" cy="11" r="0.8" fill="currentColor" opacity={0.6} />
      <circle cx="14" cy="10" r="0.8" fill="currentColor" opacity={0.6} />
      <circle cx="12" cy="15" r="0.8" fill="currentColor" opacity={0.6} />
    </svg>
  );
}

export function MonkeyTail(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" {...p}>
      <path d="M 4 26 Q 2 18 10 14 Q 22 10 24 4 Q 22 10 18 12" {...stroke} strokeWidth={1.6} />
    </svg>
  );
}

export function BananaBunch(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 24" {...p}>
      <path d="M 6 6 Q 4 14 10 18 Q 18 20 22 12 Q 14 16 10 12 Q 8 8 8 6 Z" {...stroke} />
      <path d="M 10 4 Q 8 12 14 16 Q 22 18 26 10" {...stroke} />
      <path d="M 6 6 Q 4 14 10 18 Q 18 20 22 12 Q 14 16 10 12 Q 8 8 8 6 Z" {...fillSoft} />
    </svg>
  );
}

export const PRIMATE_POOL: MascotEntry[] = [
  { id: 'monkey-face', Component: MonkeyFace, weight: 1.1, role: 'fixed-ground' },
  { id: 'banana', Component: Banana, weight: 1.4, role: 'fixed-ground' },
  { id: 'vine', Component: Vine, weight: 1.5, role: 'climber' },
  { id: 'coconut', Component: Coconut, weight: 0.9, role: 'fixed-ground' },
  { id: 'monkey-tail', Component: MonkeyTail, weight: 0.8, role: 'climber' },
  { id: 'banana-bunch', Component: BananaBunch, weight: 0.7, role: 'climber' },
];

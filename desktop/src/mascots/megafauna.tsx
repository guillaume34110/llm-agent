import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function ElephantHead(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 32" {...p}>
      <ellipse cx="18" cy="16" rx="10" ry="8" {...stroke} />
      <ellipse cx="18" cy="16" rx="10" ry="8" {...fillSoft} />
      <path d="M 18 22 Q 20 28 26 28 Q 28 26 26 24" {...stroke} />
      <path d="M 6 16 Q 2 14 4 22 Q 7 22 8 18" {...stroke} />
      <path d="M 30 16 Q 34 14 32 22 Q 29 22 28 18" {...stroke} />
      <circle cx="14" cy="16" r="0.9" fill="currentColor" />
      <circle cx="22" cy="16" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function Tusk(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M 4 4 Q 8 10 12 22 Q 16 16 20 4" {...stroke} />
      <path d="M 4 4 Q 8 10 12 22 Q 16 16 20 4 Z" {...fillSoft} />
    </svg>
  );
}

export function BigEar(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 32" {...p}>
      <path d="M 6 16 Q 4 4 14 4 Q 24 6 22 18 Q 20 28 12 28 Q 6 24 6 16 Z" {...stroke} />
      <path d="M 6 16 Q 4 4 14 4 Q 24 6 22 18 Q 20 28 12 28 Q 6 24 6 16 Z" {...fillSoft} />
      <path d="M 10 16 Q 12 12 16 14" {...stroke} strokeWidth={0.8} />
    </svg>
  );
}

export function Trunk(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 32" {...p}>
      <path d="M 6 2 Q 4 12 10 18 Q 16 24 8 30" {...stroke} strokeWidth={1.8} />
      <path d="M 6 8 L 11 8" {...stroke} strokeWidth={0.6} />
      <path d="M 6 14 L 13 14" {...stroke} strokeWidth={0.6} />
      <path d="M 8 22 L 15 22" {...stroke} strokeWidth={0.6} />
    </svg>
  );
}

export function Boulder(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 20" {...p}>
      <path d="M 4 18 Q 2 8 10 6 Q 14 2 22 6 Q 30 8 28 18 Z" {...stroke} />
      <path d="M 4 18 Q 2 8 10 6 Q 14 2 22 6 Q 30 8 28 18 Z" {...fillSoft} />
      <path d="M 10 12 L 14 14" {...stroke} strokeWidth={0.7} />
      <path d="M 18 10 L 22 12" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export const MEGAFAUNA_POOL: MascotEntry[] = [
  { id: 'elephant-head', Component: ElephantHead, weight: 1.0, role: 'walker' },
  { id: 'tusk', Component: Tusk, weight: 1.2, role: 'fixed-ground' },
  { id: 'big-ear', Component: BigEar, weight: 1.1, role: 'fixed-ground' },
  { id: 'trunk', Component: Trunk, weight: 1.0, role: 'fixed-ground' },
  { id: 'boulder', Component: Boulder, weight: 1.0, role: 'fixed-ground' },
];

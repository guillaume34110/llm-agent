import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function ShellSpiral(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" {...p}>
      <path d="M 14 4 Q 4 4 4 14 Q 4 24 14 24 Q 22 24 22 16 Q 22 10 16 10 Q 12 10 12 14 Q 12 18 16 18" {...stroke} />
      <path d="M 14 4 Q 4 4 4 14 Q 4 24 14 24 Q 22 24 22 16 Q 22 10 16 10 Q 12 10 12 14 Q 12 18 16 18" {...fillSoft} />
    </svg>
  );
}

export function ShellFan(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 24" {...p}>
      <path d="M 4 20 Q 4 4 14 4 Q 24 4 24 20 Z" {...stroke} />
      <path d="M 4 20 Q 4 4 14 4 Q 24 4 24 20 Z" {...fillSoft} />
      <path d="M 14 4 L 4 20" {...stroke} strokeWidth={0.6} />
      <path d="M 14 4 L 9 20" {...stroke} strokeWidth={0.6} />
      <path d="M 14 4 L 14 20" {...stroke} strokeWidth={0.6} />
      <path d="M 14 4 L 19 20" {...stroke} strokeWidth={0.6} />
      <path d="M 14 4 L 24 20" {...stroke} strokeWidth={0.6} />
    </svg>
  );
}

export function Pearl(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 20" {...p}>
      <path d="M 2 14 Q 2 4 12 4 Q 22 4 22 14 Q 22 18 12 18 Q 2 18 2 14 Z" {...stroke} />
      <path d="M 2 14 Q 2 4 12 4 Q 22 4 22 14 Q 22 18 12 18 Q 2 18 2 14 Z" {...fillSoft} />
      <circle cx="12" cy="12" r="3.5" {...stroke} />
      <circle cx="11" cy="11" r="1.2" fill="currentColor" opacity={0.4} />
    </svg>
  );
}

export function Coral(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 28" {...p}>
      <path d="M 12 26 L 12 20" {...stroke} strokeWidth={1.6} />
      <path d="M 12 20 Q 6 18 6 12 Q 6 6 12 6 Q 18 6 18 12 Q 18 18 12 20" {...stroke} />
      <path d="M 12 6 Q 14 4 12 2" {...stroke} />
      <path d="M 8 8 Q 4 6 4 4" {...stroke} />
      <path d="M 16 8 Q 20 6 20 4" {...stroke} />
      <path d="M 12 20 Q 6 18 6 12 Q 6 6 12 6 Q 18 6 18 12 Q 18 18 12 20 Z" {...fillSoft} />
    </svg>
  );
}

export function Crab(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 22" {...p}>
      <ellipse cx="16" cy="12" rx="9" ry="6" {...stroke} />
      <ellipse cx="16" cy="12" rx="9" ry="6" {...fillSoft} />
      <circle cx="13" cy="11" r="0.9" fill="currentColor" />
      <circle cx="19" cy="11" r="0.9" fill="currentColor" />
      <path d="M 7 12 Q 2 10 2 6" {...stroke} />
      <path d="M 25 12 Q 30 10 30 6" {...stroke} />
      <path d="M 8 16 L 6 20" {...stroke} />
      <path d="M 12 18 L 12 21" {...stroke} />
      <path d="M 20 18 L 20 21" {...stroke} />
      <path d="M 24 16 L 26 20" {...stroke} />
    </svg>
  );
}

export function Starfish(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" {...p}>
      <path d="M 14 2 L 17 11 L 26 11 L 19 16 L 22 25 L 14 20 L 6 25 L 9 16 L 2 11 L 11 11 Z" {...stroke} />
      <path d="M 14 2 L 17 11 L 26 11 L 19 16 L 22 25 L 14 20 L 6 25 L 9 16 L 2 11 L 11 11 Z" {...fillSoft} />
      <circle cx="14" cy="15" r="0.7" fill="currentColor" opacity={0.5} />
      <circle cx="11" cy="13" r="0.5" fill="currentColor" opacity={0.5} />
      <circle cx="17" cy="13" r="0.5" fill="currentColor" opacity={0.5} />
    </svg>
  );
}

export const SHELL_POOL: MascotEntry[] = [
  { id: 'shell-spiral', Component: ShellSpiral, weight: 1.2, role: 'fixed-ground' },
  { id: 'shell-fan', Component: ShellFan, weight: 1.3, role: 'fixed-ground' },
  { id: 'pearl', Component: Pearl, weight: 1.0, role: 'sparkle' },
  { id: 'coral', Component: Coral, weight: 1.1, role: 'fixed-ground' },
  { id: 'crab', Component: Crab, weight: 0.9, role: 'walker' },
  { id: 'starfish', Component: Starfish, weight: 1.0, role: 'fixed-ground' },
];

import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function FrogSit(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 26" {...p}>
      <circle cx="9" cy="7" r="3.5" {...stroke} />
      <circle cx="23" cy="7" r="3.5" {...stroke} />
      <circle cx="9" cy="7" r="3.5" {...fillSoft} />
      <circle cx="23" cy="7" r="3.5" {...fillSoft} />
      <circle cx="9" cy="7" r="1" fill="currentColor" />
      <circle cx="23" cy="7" r="1" fill="currentColor" />
      <ellipse cx="16" cy="14" rx="11" ry="7" {...stroke} />
      <ellipse cx="16" cy="14" rx="11" ry="7" {...fillSoft} />
      <path d="M 12 16 Q 16 18 20 16" {...stroke} />
      <path d="M 4 22 Q 2 18 6 18 Q 8 22 4 22" {...stroke} />
      <path d="M 28 22 Q 30 18 26 18 Q 24 22 28 22" {...stroke} />
    </svg>
  );
}

export function LilyPad(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 22" {...p}>
      <path d="M 16 14 L 16 4 A 10 10 0 1 1 14 4 Z" {...stroke} />
      <path d="M 16 14 L 16 4 A 10 10 0 1 1 14 4 Z" {...fillSoft} />
      <path d="M 12 16 Q 14 12 18 14" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export function Scale(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 20" {...p}>
      <path d="M 4 16 Q 8 8 12 16" {...stroke} />
      <path d="M 12 16 Q 16 8 20 16" {...stroke} />
      <path d="M 20 16 Q 24 8 28 16" {...stroke} />
      <path d="M 4 16 Q 8 8 12 16 L 12 16 Z" {...fillSoft} />
      <path d="M 12 16 Q 16 8 20 16 Z" {...fillSoft} />
      <path d="M 20 16 Q 24 8 28 16 Z" {...fillSoft} />
    </svg>
  );
}

export function TurtleShell(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 24" {...p}>
      <ellipse cx="16" cy="14" rx="12" ry="8" {...stroke} />
      <ellipse cx="16" cy="14" rx="12" ry="8" {...fillSoft} />
      <path d="M 10 8 L 8 20" {...stroke} strokeWidth={0.7} />
      <path d="M 16 6 L 16 22" {...stroke} strokeWidth={0.7} />
      <path d="M 22 8 L 24 20" {...stroke} strokeWidth={0.7} />
      <path d="M 4 14 L 28 14" {...stroke} strokeWidth={0.7} />
      <circle cx="12" cy="11" r="1" fill="currentColor" opacity={0.4} />
      <circle cx="20" cy="11" r="1" fill="currentColor" opacity={0.4} />
      <circle cx="16" cy="17" r="1" fill="currentColor" opacity={0.4} />
    </svg>
  );
}

export function SnakeCurl(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 24" {...p}>
      <path d="M 4 20 Q 4 10 14 10 Q 22 10 22 16 Q 22 20 16 20 Q 12 20 12 16 Q 12 14 16 14 Q 18 14 18 16" {...stroke} strokeWidth={1.6} />
      <circle cx="4" cy="20" r="2" {...stroke} />
      <circle cx="4" cy="20" r="2" {...fillSoft} />
      <path d="M 2 20 Q 1 19 0 20" {...stroke} strokeWidth={0.6} />
    </svg>
  );
}

export function Lizard(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 22" {...p}>
      <path d="M 4 14 Q 10 6 18 8 Q 26 6 30 12 Q 34 14 32 18 Q 28 12 22 14 Q 16 18 10 14 Q 6 18 4 14 Z" {...stroke} />
      <path d="M 4 14 Q 10 6 18 8 Q 26 6 30 12 Q 34 14 32 18 Q 28 12 22 14 Q 16 18 10 14 Q 6 18 4 14 Z" {...fillSoft} />
      <circle cx="29" cy="10" r="0.8" fill="currentColor" />
      <path d="M 14 12 L 12 16" {...stroke} strokeWidth={0.7} />
      <path d="M 20 13 L 18 17" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export const REPTILE_POOL: MascotEntry[] = [
  { id: 'frog-sit', Component: FrogSit, weight: 1.0, role: 'hopper' },
  { id: 'lily-pad', Component: LilyPad, weight: 1.4, role: 'fixed-ground' },
  { id: 'scale', Component: Scale, weight: 1.3, role: 'sparkle' },
  { id: 'turtle-shell', Component: TurtleShell, weight: 1.1, role: 'walker' },
  { id: 'snake-curl', Component: SnakeCurl, weight: 0.9, role: 'walker' },
  { id: 'lizard', Component: Lizard, weight: 0.9, role: 'walker' },
];

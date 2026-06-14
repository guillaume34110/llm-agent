import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function BearFace(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 30" {...p}>
      <circle cx="8" cy="8" r="3.5" {...stroke} />
      <circle cx="24" cy="8" r="3.5" {...stroke} />
      <circle cx="8" cy="8" r="3.5" {...fillSoft} />
      <circle cx="24" cy="8" r="3.5" {...fillSoft} />
      <circle cx="16" cy="16" r="10" {...stroke} />
      <circle cx="16" cy="16" r="10" {...fillSoft} />
      <ellipse cx="16" cy="20" rx="5" ry="4" {...stroke} />
      <circle cx="12" cy="15" r="0.9" fill="currentColor" />
      <circle cx="20" cy="15" r="0.9" fill="currentColor" />
      <ellipse cx="16" cy="20" rx="1.2" ry="0.8" fill="currentColor" opacity={0.8} />
    </svg>
  );
}

export function BearPaw(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 26 26" {...p}>
      <ellipse cx="13" cy="17" rx="7" ry="6" fill="currentColor" opacity={0.7} />
      <circle cx="5" cy="10" r="2.6" fill="currentColor" opacity={0.7} />
      <circle cx="10" cy="6" r="2.4" fill="currentColor" opacity={0.7} />
      <circle cx="16" cy="6" r="2.4" fill="currentColor" opacity={0.7} />
      <circle cx="21" cy="10" r="2.6" fill="currentColor" opacity={0.7} />
    </svg>
  );
}

export function HoneyJar(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 28" {...p}>
      <path d="M 6 10 L 6 24 Q 6 26 8 26 L 16 26 Q 18 26 18 24 L 18 10 Z" {...stroke} />
      <path d="M 6 10 L 6 24 Q 6 26 8 26 L 16 26 Q 18 26 18 24 L 18 10 Z" {...fillSoft} />
      <path d="M 4 10 L 20 10 L 20 12 L 4 12 Z" {...stroke} />
      <path d="M 4 10 L 20 10 L 20 12 L 4 12 Z" {...fillSoft} />
      <path d="M 12 18 Q 8 18 8 14" {...stroke} strokeWidth={0.8} />
      <path d="M 8 4 L 16 4 L 16 10" {...stroke} />
    </svg>
  );
}

export function Berry(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 26" {...p}>
      <circle cx="12" cy="16" r="8" {...stroke} />
      <circle cx="12" cy="16" r="8" {...fillSoft} />
      <circle cx="9" cy="14" r="1.2" fill="currentColor" opacity={0.5} />
      <circle cx="14" cy="14" r="1.2" fill="currentColor" opacity={0.5} />
      <circle cx="11" cy="18" r="1.2" fill="currentColor" opacity={0.5} />
      <circle cx="15" cy="19" r="1" fill="currentColor" opacity={0.5} />
      <path d="M 12 8 L 12 4" {...stroke} />
      <path d="M 8 6 L 12 8 L 16 6" {...stroke} />
    </svg>
  );
}

export function CubSleep(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 22" {...p}>
      <ellipse cx="16" cy="14" rx="12" ry="6" {...stroke} />
      <ellipse cx="16" cy="14" rx="12" ry="6" {...fillSoft} />
      <circle cx="6" cy="10" r="3.5" {...stroke} />
      <circle cx="6" cy="10" r="3.5" {...fillSoft} />
      <path d="M 4 9 Q 4 6 6 6 Q 8 6 8 9" {...stroke} strokeWidth={0.8} />
      <path d="M 5 11 Q 6 12 7 11" {...stroke} />
      <path d="M 22 10 Q 24 6 28 8" {...stroke} strokeWidth={0.7} />
      <path d="M 24 6 Q 26 4 28 6" {...stroke} strokeWidth={0.7} />
    </svg>
  );
}

export function BearEars(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 18" {...p}>
      <circle cx="8" cy="9" r="5" {...stroke} />
      <circle cx="20" cy="9" r="5" {...stroke} />
      <circle cx="8" cy="9" r="5" {...fillSoft} />
      <circle cx="20" cy="9" r="5" {...fillSoft} />
      <circle cx="8" cy="9" r="2.4" fill="currentColor" opacity={0.4} />
      <circle cx="20" cy="9" r="2.4" fill="currentColor" opacity={0.4} />
    </svg>
  );
}

export const URSINE_POOL: MascotEntry[] = [
  { id: 'bear-face', Component: BearFace, weight: 1.0, role: 'walker' },
  { id: 'bear-paw', Component: BearPaw, weight: 1.4, role: 'fixed-ground' },
  { id: 'honey-jar', Component: HoneyJar, weight: 1.2, role: 'fixed-ground' },
  { id: 'berry', Component: Berry, weight: 1.3, role: 'fixed-ground' },
  { id: 'cub-sleep', Component: CubSleep, weight: 0.7, role: 'fixed-ground' },
  { id: 'bear-ears', Component: BearEars, weight: 1.0, role: 'fixed-ground' },
];

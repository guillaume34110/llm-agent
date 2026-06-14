import type { SVGProps } from 'react';
import type { MascotEntry } from './types';

const stroke = { stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
const fillSoft = { fill: 'currentColor', opacity: 0.18 };

export function VineCurl(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" {...p}>
      <path d="M 4 28 Q 12 22 10 14 Q 8 7 18 4" {...stroke} />
      <path d="M 11 18 Q 6 16 4 19 Q 7 22 11 18 Z" {...fillSoft} />
      <path d="M 14 9 Q 19 7 21 10 Q 18 13 14 9 Z" {...fillSoft} />
    </svg>
  );
}

export function LeafSingle(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M 12 3 Q 5 11 12 22 Q 19 11 12 3 Z" {...stroke} />
      <path d="M 12 3 Q 5 11 12 22 Q 19 11 12 3 Z" {...fillSoft} />
      <path d="M 12 5 L 12 21" {...stroke} />
    </svg>
  );
}

export function MushroomSmall(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M 3 13 Q 3 5 12 4 Q 21 5 21 13 Z" {...stroke} />
      <path d="M 3 13 Q 3 5 12 4 Q 21 5 21 13 Z" {...fillSoft} />
      <path d="M 9 13 L 9 19 Q 9 22 12 22 Q 15 22 15 19 L 15 13" {...stroke} />
      <circle cx="8" cy="9" r="1.1" {...fillSoft} />
      <circle cx="14" cy="10" r="1.1" {...fillSoft} />
      <circle cx="11" cy="7" r="0.9" {...fillSoft} />
    </svg>
  );
}

export function Dewdrop(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 24" {...p}>
      <path d="M 8 2 Q 1 12 8 22 Q 15 12 8 2 Z" {...stroke} />
      <path d="M 8 2 Q 1 12 8 22 Q 15 12 8 2 Z" {...fillSoft} />
      <path d="M 5 8 Q 4 12 5 14" {...stroke} strokeWidth={0.9} />
    </svg>
  );
}

export function Daisy(p: SVGProps<SVGSVGElement>) {
  const petals = [0, 72, 144, 216, 288];
  return (
    <svg viewBox="0 0 24 24" {...p}>
      {petals.map(a => (
        <ellipse key={a} cx="12" cy="5.5" rx="2.3" ry="4.2" transform={`rotate(${a} 12 12)`} {...stroke} />
      ))}
      {petals.map(a => (
        <ellipse key={`f${a}`} cx="12" cy="5.5" rx="2.3" ry="4.2" transform={`rotate(${a} 12 12)`} {...fillSoft} />
      ))}
      <circle cx="12" cy="12" r="2.2" {...stroke} fill="currentColor" />
    </svg>
  );
}

export function Sparkle(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" {...p}>
      <path d="M 8 1 Q 9 7 15 8 Q 9 9 8 15 Q 7 9 1 8 Q 7 7 8 1 Z" fill="currentColor" opacity={0.9} />
    </svg>
  );
}

export function CloudWispy(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 18" {...p}>
      <path d="M 5 13 Q 2 9 7 7 Q 8 3 13 5 Q 16 1 21 5 Q 26 4 27 9 Q 31 10 28 14 Q 22 16 5 13 Z" {...stroke} />
      <path d="M 5 13 Q 2 9 7 7 Q 8 3 13 5 Q 16 1 21 5 Q 26 4 27 9 Q 31 10 28 14 Q 22 16 5 13 Z" {...fillSoft} />
    </svg>
  );
}

export function MoonCrescent(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M 17 3 A 10 10 0 1 0 17 21 A 7.5 7.5 0 1 1 17 3 Z" {...stroke} />
      <path d="M 17 3 A 10 10 0 1 0 17 21 A 7.5 7.5 0 1 1 17 3 Z" {...fillSoft} />
      <circle cx="8" cy="10" r="0.6" fill="currentColor" opacity={0.6} />
      <circle cx="9" cy="14" r="0.5" fill="currentColor" opacity={0.5} />
    </svg>
  );
}

export const BOTANICAL_POOL: MascotEntry[] = [
  { id: 'vine-curl', Component: VineCurl, weight: 1.4, role: 'climber' },
  { id: 'leaf-single', Component: LeafSingle, weight: 1.5, role: 'flyer' },
  { id: 'mushroom-small', Component: MushroomSmall, weight: 1.0, role: 'fixed-ground' },
  { id: 'dewdrop', Component: Dewdrop, weight: 1.2, role: 'sparkle' },
  { id: 'daisy', Component: Daisy, weight: 1.0, role: 'fixed-ground' },
  { id: 'sparkle', Component: Sparkle, weight: 1.6, role: 'sparkle' },
  { id: 'cloud-wispy', Component: CloudWispy, weight: 0.8, role: 'cloud' },
  { id: 'moon-crescent', Component: MoonCrescent, weight: 0.6, role: 'cloud' },
];

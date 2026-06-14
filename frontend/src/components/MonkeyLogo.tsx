import React from 'react';

export default function MonkeyLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="7"  cy="22" rx="5.5" ry="6.5" fill="oklch(48% 0.08 82)" />
      <ellipse cx="7"  cy="22" rx="3"   ry="4"   fill="oklch(62% 0.11 82)" />
      <ellipse cx="33" cy="22" rx="5.5" ry="6.5" fill="oklch(48% 0.08 82)" />
      <ellipse cx="33" cy="22" rx="3"   ry="4"   fill="oklch(62% 0.11 82)" />
      <ellipse cx="20" cy="20" rx="13"  ry="13.5" fill="oklch(52% 0.09 82)" />
      <ellipse cx="20" cy="24" rx="8"   ry="7"   fill="oklch(68% 0.1 82)" />
      <ellipse cx="15.5" cy="17.5" rx="3" ry="3.2" fill="white" />
      <ellipse cx="24.5" cy="17.5" rx="3" ry="3.2" fill="white" />
      <circle cx="16"   cy="18"   r="1.8" fill="oklch(20% 0.02 148)" />
      <circle cx="25"   cy="18"   r="1.8" fill="oklch(20% 0.02 148)" />
      <circle cx="16.6" cy="17.3" r="0.7" fill="white" />
      <circle cx="25.6" cy="17.3" r="0.7" fill="white" />
      <ellipse cx="18" cy="23" rx="1.2" ry="0.8" fill="oklch(45% 0.08 82)" />
      <ellipse cx="22" cy="23" rx="1.2" ry="0.8" fill="oklch(45% 0.08 82)" />
      <path d="M16 26 Q20 29.5 24 26" stroke="oklch(45% 0.08 82)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

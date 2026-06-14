import React from 'react';

export default function MonkeyLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Left ear */}
      <ellipse cx="10" cy="32" rx="8.5" ry="10" fill="#C4996A" />
      <ellipse cx="10" cy="32" rx="5.5" ry="6.5" fill="#E8CFA0" />
      {/* Right ear */}
      <ellipse cx="54" cy="32" rx="8.5" ry="10" fill="#C4996A" />
      <ellipse cx="54" cy="32" rx="5.5" ry="6.5" fill="#E8CFA0" />
      {/* Head */}
      <ellipse cx="32" cy="30" rx="21" ry="22" fill="#D4AA72" />
      {/* Muzzle patch */}
      <ellipse cx="32" cy="40" rx="13" ry="11" fill="#F0DFB4" />
      {/* Eye whites */}
      <ellipse cx="24.5" cy="27" rx="5" ry="5.5" fill="white" />
      <ellipse cx="39.5" cy="27" rx="5" ry="5.5" fill="white" />
      {/* Pupils */}
      <circle cx="25" cy="27.5" r="3.6" fill="#2E1206" />
      <circle cx="40" cy="27.5" r="3.6" fill="#2E1206" />
      {/* Eye shines */}
      <circle cx="26.3" cy="25.8" r="1.4" fill="white" />
      <circle cx="41.3" cy="25.8" r="1.4" fill="white" />
      {/* Nostrils */}
      <ellipse cx="29" cy="38.5" rx="2" ry="1.5" fill="#B07840" />
      <ellipse cx="35" cy="38.5" rx="2" ry="1.5" fill="#B07840" />
      {/* Smile */}
      <path d="M24 43.5 Q32 50 40 43.5" stroke="#B07840" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Vanilla bean accent — small dot trio on forehead */}
      <circle cx="32" cy="13" r="1.6" fill="#F0DFB4" opacity="0.7" />
      <circle cx="27.5" cy="14.5" r="1.1" fill="#F0DFB4" opacity="0.5" />
      <circle cx="36.5" cy="14.5" r="1.1" fill="#F0DFB4" opacity="0.5" />
    </svg>
  );
}

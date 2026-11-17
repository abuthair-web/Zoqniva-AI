import React from 'react';

interface BrandLogoProps {
  collapsed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

export function BrandLogo({ collapsed = false, size = 'md', showTagline = false }: BrandLogoProps) {
  const iconDim = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';

  return (
    <div className="flex items-center gap-3 select-none">
      {/* Modular Z-inspired SVG emblem: Electric Blue dominant with Gold & Crimson precision accents */}
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${iconDim} shrink-0`}
        aria-label="Zoqniva AI Symbol"
      >
        <rect width="40" height="40" rx="10" fill="#2563EB" />
        {/* Top bar of Z */}
        <path
          d="M11 12.5H28.5L22.5 18.5H11V12.5Z"
          fill="#FFFFFF"
        />
        {/* Diagonal precision ribbon */}
        <path
          d="M28.5 12.5L17.5 27.5H11.5L22.5 12.5H28.5Z"
          fill="#FFFFFF"
        />
        {/* Bottom bar of Z */}
        <path
          d="M11.5 27.5H29V21.5H17.5L11.5 27.5Z"
          fill="#EFF6FF"
          fillOpacity="0.92"
        />
        {/* Luxury Gold AI spark node */}
        <circle cx="29" cy="12.5" r="2.6" fill="#F4B942" />
        {/* Crimson Red signal accent */}
        <rect x="11" y="21.5" width="4" height="2.4" rx="1.2" fill="#E11D48" />
      </svg>

      {!collapsed && (
        <div className="min-w-0">
          <div className="flex items-baseline gap-1 whitespace-nowrap">
            <span className="font-display text-lg font-bold tracking-tight text-[#0F172A]">
              Zoqniva
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-[#2563EB]">
              AI
            </span>
          </div>
          {showTagline && (
            <p className="text-[11px] font-medium text-slate-500 whitespace-nowrap">
              by Noor Labs
            </p>
          )}
        </div>
      )}
    </div>
  );
}

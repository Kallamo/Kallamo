import React from 'react';

/**
 * Shared label/pill. Tonal, uppercase, tiny — for source types, statuses and
 * keyword chips. Use `tone` for color; `dot` for a leading status dot.
 */
const TONES = {
  accent: 'bg-accent/15 text-accent border-accent/30',
  blue: 'bg-[#3b82f6]/20 text-[#3b82f6] border-[#3b82f6]/30',
  amber: 'bg-[#FBCB2D]/20 text-[#FBCB2D] border-[#FBCB2D]/30',
  emerald: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  red: 'bg-red-500/15 text-red-400 border-red-500/30',
  gray: 'bg-gray-700/30 text-gray-400 border-gray-700/50',
};

export default function Badge({
  tone = 'gray',
  dot = false,
  children,
  className = '',
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border
        text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${TONES[tone] || TONES.gray} ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

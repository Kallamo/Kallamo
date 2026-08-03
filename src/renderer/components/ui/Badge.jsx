import React from 'react';

/**
 * Shared label/pill. Tonal, uppercase, tiny, for source types, statuses and
 * keyword chips. Use `tone` for color; `dot` for a leading status dot.
 */
const TONES = {
  accent: 'bg-accent/15 text-accent border-accent/30',
  blue: 'bg-status-info/15 text-status-info border-status-info/30',
  amber: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  emerald: 'bg-status-success/15 text-status-success border-status-success/30',
  red: 'bg-status-danger/15 text-status-danger border-status-danger/30',
  gray: 'bg-white/[0.04] text-text-muted border-border-default',
};

export default function Badge({
  tone = 'gray',
  dot = false,
  children,
  className = '',
  title,
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border
        text-xs font-semibold tracking-wide whitespace-nowrap ${TONES[tone] || TONES.gray} ${className}`}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

import React from 'react';
import Tooltip from './Tooltip';

const TONES = {
  default: 'text-text-muted hover:bg-surface-hover/55 hover:text-text-primary',
  accent: 'text-accent hover:bg-accent/10',
  danger: 'text-text-muted hover:bg-status-danger/10 hover:text-status-danger',
};

const SIZES = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

// Icon-only, so its label is both the accessible name and the app tooltip (never `title`).
export default function IconButton({
  icon: Icon,
  label,
  tone = 'default',
  size = 'md',
  className = '',
  tooltipSide = 'top',
  ...rest
}) {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        className={`inline-flex shrink-0 items-center justify-center rounded-control transition-colors
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
          disabled:pointer-events-none disabled:opacity-50 ${SIZES[size] || SIZES.md}
          ${TONES[tone] || TONES.default} ${className}`}
        {...rest}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

import React from 'react';

const TONES = {
  default: 'text-text-muted hover:bg-white/[0.06] hover:text-text-primary',
  accent: 'text-accent hover:bg-accent/10',
  danger: 'text-text-muted hover:bg-status-danger/10 hover:text-status-danger',
};

const SIZES = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

export default function IconButton({
  icon: Icon,
  label,
  tone = 'default',
  size = 'md',
  className = '',
  ...rest
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
        disabled:pointer-events-none disabled:opacity-50 ${SIZES[size] || SIZES.md}
        ${TONES[tone] || TONES.default} ${className}`}
      {...rest}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

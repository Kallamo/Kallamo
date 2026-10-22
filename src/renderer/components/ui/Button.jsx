import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * primary for the call to action, danger to confirm a destructive one, ghost for secondary.
 * subtle is for inline text actions only: a primary action never goes borderless.
 */
const VARIANTS = {
  primary: 'bg-accent/90 text-on-accent hover:bg-accent shadow-[0_0.375rem_1.125rem_-0.5rem] shadow-accent/50',
  danger: 'bg-danger-solid text-on-danger hover:bg-danger-solid-hover shadow-sm',
  ghost: 'bg-surface-panel/70 border border-border-default text-text-secondary hover:bg-surface-hover hover:text-text-primary',
  subtle: 'bg-transparent text-text-muted hover:bg-surface-hover/45 hover:text-text-primary',
};

const SIZES = {
  sm: 'min-h-8 px-3 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2 text-xs',
  lg: 'min-h-11 px-5 py-2.5 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon = null,
  fullWidth = false,
  className = '',
  children,
  ...rest
}) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={[
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-semibold',
        'tracking-wide transition-[color,background-color,border-color,filter,transform] cursor-pointer select-none',
        'active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100',
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size] || SIZES.md,
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <span className="inline-flex animate-spin"><Loader2 className="w-3.5 h-3.5" /></span>
      ) : (
        Icon && <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
      )}
      {children && <span className="inline-flex items-center gap-1.5">{children}</span>}
    </button>
  );
}

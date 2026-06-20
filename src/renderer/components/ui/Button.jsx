import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Shared button primitive for Kallamo.
 *
 * Variants:
 *  - primary  → accent fill (default call-to-action)
 *  - danger   → red fill (destructive confirm)
 *  - ghost    → bordered, low-emphasis (Cancel / secondary)
 *  - subtle   → borderless, lowest emphasis (inline text actions only)
 *
 * Sizes: sm | md (default). Every interactive button keeps a clear shape and
 * a comfortable hit area — never a bare borderless primary action.
 */
const VARIANTS = {
  primary: 'bg-accent text-[#011419] hover:brightness-110 shadow-sm',
  danger: 'bg-red-600 text-white hover:bg-red-500 shadow-sm',
  ghost: 'bg-[#0a161d] border border-gray-800 text-gray-300 hover:bg-[#1a2d32] hover:text-white',
  subtle: 'bg-transparent text-gray-400 hover:text-white',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-[11px]',
  md: 'px-4 py-2 text-xs',
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
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-bold',
        'uppercase tracking-wider transition-all cursor-pointer select-none',
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
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        Icon && <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
      )}
      {children && <span>{children}</span>}
    </button>
  );
}

import React from 'react';

export default function SegmentedControl({ value, onChange, options, label, className = '', disabled = false }) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex max-w-full flex-wrap gap-1 rounded-control border border-border-default bg-surface-input p-1 ${className}`}>
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50
              ${selected ? 'bg-accent text-on-accent' : 'text-text-muted hover:bg-surface-hover/55 hover:text-text-primary'}`}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

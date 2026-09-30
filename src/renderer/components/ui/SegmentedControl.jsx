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
            data-tooltip={option.tooltip}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50
              ${selected ? 'bg-surface-hover text-text-primary shadow-sm ring-1 ring-inset ring-border-strong' : 'text-text-muted hover:bg-surface-hover/55 hover:text-text-primary'}`}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {option.label}
            {option.count != null && <span className={`font-medium tabular-nums ${option.count === 0 ? 'text-text-disabled' : 'text-text-subtle'}`}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

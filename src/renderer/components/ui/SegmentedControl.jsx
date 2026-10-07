import React from 'react';

// `bare` drops the frame so the control can sit inside a bar that already has one.
export default function SegmentedControl({ value, onChange, options, label, className = '', disabled = false, bare = false }) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex max-w-full gap-1 p-1 ${bare ? 'shrink-0 flex-nowrap' : 'flex-wrap rounded-control border border-border-default bg-surface-input'} ${className}`}>
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
            className={`inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50
              ${selected ? 'bg-accent/[0.13] text-accent shadow-sm ring-1 ring-inset ring-accent/45' : 'text-text-muted hover:bg-surface-hover/55 hover:text-text-primary'}`}
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

import React from 'react';

/**
 * Shared tab navigation. `items`: [{ id, label, icon, count }]. Renders horizontal by default,
 * a vertical sidebar list with `orientation="vertical"`, or tabs over a rule with `variant="underline"`.
 */
export default function Tabs({
  items = [],
  activeId,
  onChange,
  orientation = 'horizontal',
  variant = 'pill',
  label,
  className = '',
}) {
  const vertical = orientation === 'vertical';

  if (variant === 'underline') {
    return (
      <nav role="tablist" aria-label={label} className={`flex items-end gap-5 border-b border-border-subtle ${className}`}>
        {items.map((item) => {
          const active = item.id === activeId;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange?.(item.id)}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-1 pb-2.5 pt-1 text-[0.8125rem] font-semibold transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-t-md ${
                active ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'
              }`}
            >
              {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{item.label}</span>
              {item.count != null && <span className={`tabular-nums ${active ? 'text-text-muted' : 'text-text-subtle'}`}>{item.count}</span>}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className={`flex ${vertical ? 'flex-col space-y-1' : 'items-center gap-1'} ${className}`}>
      {items.map((item) => {
        const active = item.id === activeId;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onChange?.(item.id)}
            className={`flex items-center gap-2 text-left text-xs font-semibold rounded-md transition-all cursor-pointer
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              vertical ? 'w-full px-3 py-2.5' : 'px-3 py-2'
            } ${
              active
                ? 'bg-surface-hover text-text-primary shadow-sm' + (vertical ? ' border-l-2 border-accent' : '')
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-canvas'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

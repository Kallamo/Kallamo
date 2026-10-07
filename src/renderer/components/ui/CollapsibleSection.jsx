import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A list section whose header stays visible when collapsed, so its totals never leave
 * the page. Open state is owned by the caller so it can be remembered.
 */
export default function CollapsibleSection({ icon: Icon, title, description, total, count, toneClass = 'text-text-primary', open = true, onToggle, className = '', children }) {
  const bodyId = useId();
  return (
    <section className={`overflow-hidden rounded-card border border-border-subtle glass-panel ${className}`}>
      <button
        type="button"
        onClick={() => onToggle?.(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left cursor-pointer hover:bg-tint/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        {Icon && <Icon className={`h-4 w-4 shrink-0 ${toneClass}`} aria-hidden="true" />}
        <span className={`text-sm font-semibold ${toneClass}`}>{title}</span>
        {description && <span className="hidden truncate text-sm text-text-subtle sm:inline">{description}</span>}
        <span className="flex-1" />
        {total && <span className="shrink-0 text-sm text-text-secondary tabular-nums">{total}</span>}
        {count && <span className="min-w-[3.5rem] shrink-0 text-right text-xs text-text-subtle">{count}</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 text-text-subtle transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
      </button>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  );
}

import React, { useState } from 'react';

// The whole inner edge of a side panel; spread `handle` from usePanelWidth. Double-click
// returns that panel to its default width.
export default function PanelResizeHandle({ label, edge, value, min, max, dragging, className = '', ...events }) {
  const [focused, setFocused] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onFocus={event => setFocused(event.currentTarget.matches(':focus-visible'))}
      onBlur={() => setFocused(false)}
      {...events}
      className={`absolute top-0 bottom-0 z-30 w-2 cursor-col-resize touch-none transition-colors hover:bg-accent/25 focus-visible:bg-accent/40 focus-visible:outline-none ${dragging ? 'bg-accent/25' : ''} ${edge === 'left' ? '-left-1' : '-right-1'} ${className}`}
    >
      {(dragging || focused) && (
        <span aria-hidden="true" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border-default bg-surface-raised px-2 py-1 text-xs font-semibold tabular-nums text-text-secondary shadow-lg ${edge === 'left' ? 'left-3' : 'right-3'}`}>
          {value} px
        </span>
      )}
    </div>
  );
}

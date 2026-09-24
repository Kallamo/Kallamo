import React from 'react';
import { Trash2 } from 'lucide-react';
import Button from './Button';

/** Floating bar for acting on selected rows. Sits over the list it belongs to. */
export default function SelectionBar({ count, onSelectAll, onClear, onDelete, className = '' }) {
  if (!count) return null;
  return (
    <div className={`absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-card border border-border-default bg-surface-panel/95 py-2 pl-4 pr-2 shadow-overlay backdrop-blur-md animate-in slide-in-from-bottom duration-200 ${className}`}>
      <span className="text-sm font-semibold text-text-primary tabular-nums">{count} selected</span>
      <span className="h-4 w-px bg-border-default" aria-hidden="true" />
      <button type="button" onClick={onSelectAll} className="rounded px-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer">Select all</button>
      <button type="button" onClick={onClear} className="rounded px-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer">Clear</button>
      <Button variant="danger" size="sm" icon={Trash2} onClick={onDelete}>Delete</Button>
    </div>
  );
}

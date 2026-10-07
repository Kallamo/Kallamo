import React from 'react';
import { Tag, X } from 'lucide-react';

/**
 * One tag. `entity` tags are world entities (blue, with the entity's type icon);
 * `keyword` tags are free text and stay neutral, because accent yellow marks state.
 */
export default function TagChip({ label, variant = 'keyword', icon: Icon, count, onRemove, removeLabel, disabled = false, size = 'md' }) {
  const EntityIcon = Icon || Tag;
  const tone = variant === 'entity'
    ? 'bg-status-info/12 border-status-info/30 text-status-info'
    : 'bg-tint/5 border-border-default text-text-secondary';
  const height = size === 'sm' ? 'h-5 px-1.5 text-[0.6875rem]' : 'h-6 px-2 text-xs';
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-md border font-medium ${height} ${tone}`}>
      {variant === 'entity' && <EntityIcon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      <span className="truncate">{label}</span>
      {count && <span className="opacity-60 tabular-nums">{count}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeLabel || `Remove ${label}`}
          className="-mr-0.5 rounded opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

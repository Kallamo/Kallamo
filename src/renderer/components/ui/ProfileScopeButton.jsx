import React, { useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Users } from 'lucide-react';
import Popover from './Popover';

/**
 * The default (every profile) stays quiet; a restriction gets a brighter button in the
 * profiles' colours, so a limit reads from across a list.
 */
export default function ProfileScopeButton({ profiles = [], selectedIds = [], onToggle, disabled = false, fullWidth = false }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selected = profiles.filter(profile => selectedIds.includes(profile.id));
  const restricted = selected.length > 0;
  const label = !restricted
    ? 'All profiles'
    : selected.length <= 2 ? selected.map(profile => profile.name).join(', ') : `${selected.length} profiles`;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={(event) => { event.stopPropagation(); setOpen(value => !value); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Available to: ${label}`}
        className={`inline-flex h-7 max-w-[12rem] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors cursor-pointer
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 disabled:pointer-events-none
          ${fullWidth ? 'w-full max-w-none justify-between' : ''}
          ${restricted
            ? 'border-border-strong bg-tint/[0.04] text-text-primary hover:bg-surface-hover'
            : 'border-border-subtle text-text-muted hover:bg-surface-hover hover:text-text-secondary'}
          ${open ? 'bg-surface-hover' : ''}`}
      >
        {restricted ? (
          <span className="flex shrink-0" aria-hidden="true">
            {selected.slice(0, 3).map((profile, index) => (
              <span key={profile.id} className={`h-2 w-2 rounded-full ring-2 ring-surface-panel ${index ? '-ml-0.5' : ''}`} style={{ backgroundColor: profile.color }} />
            ))}
          </span>
        ) : <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
        {restricted && <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />}
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} align="right" scroll={false} className="w-60 !p-1.5">
        <div role="dialog" aria-label="Available to" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <span className="block px-2.5 pb-1 pt-1.5 text-xs font-semibold text-text-muted">Available to</span>
          {profiles.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-text-subtle">No active AI profiles in this chat.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto custom-scrollbar">
              {profiles.map(profile => {
                const isSelected = selectedIds.includes(profile.id);
                if (profile.needsSetup) {
                  return (
                    <div key={profile.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 opacity-60" title="This AI profile needs an API connection and a model before it can be used.">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
                      <span className="flex-1 truncate text-sm text-text-muted">{profile.name}</span>
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-warning" aria-hidden="true" />
                    </div>
                  );
                }
                return (
                  <label key={profile.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-surface-hover">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: profile.color }} />
                    <span className="flex-1 truncate text-sm text-text-primary">{profile.name}</span>
                    <input type="checkbox" checked={isSelected} onChange={() => onToggle?.(profile.id)} className="peer sr-only" />
                    <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 ${isSelected ? 'border-accent bg-accent text-on-accent' : 'border-border-strong'}`}>
                      {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="mx-1 my-1.5 h-px bg-border-subtle" />
          <p className="px-2.5 pb-1.5 text-xs leading-snug text-text-subtle">With none checked, every profile can use it.</p>
        </div>
      </Popover>
    </>
  );
}

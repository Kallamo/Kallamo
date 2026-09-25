import React, { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import Popover from './Popover';

/**
 * Action menu anchored to a trigger. Items are real buttons with role="menuitem";
 * arrow keys move between them and Escape or a click outside closes the menu.
 *
 * Usage:
 *   const anchorRef = useRef(null);
 *   <IconButton ref={anchorRef} aria-haspopup="menu" aria-expanded={open} ... />
 *   <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Row actions">
 *     <MenuItem icon={Pencil} label="Edit" onSelect={edit} />
 *     <MenuSeparator />
 *     <MenuItem icon={Trash2} label="Delete" danger onSelect={remove} />
 *   </Menu>
 */
export function Menu({ anchorRef, open, onClose, label, align = 'right', className = 'w-64', children }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const items = listRef.current;
      (items?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
        || items?.querySelector('[role^="menuitem"]:not([disabled])'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const onKeyDown = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(listRef.current?.querySelectorAll('[role^="menuitem"]:not([disabled])') || [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length].focus();
  };

  const close = () => {
    onClose?.();
    anchorRef?.current?.focus?.();
  };

  return (
    <Popover anchorRef={anchorRef} open={open} onClose={close} matchAnchorWidth={false} align={align} scroll={false} className={`!p-1.5 ${className}`}>
      <div ref={listRef} role="menu" aria-label={label} onKeyDown={onKeyDown} className="flex flex-col">
        {typeof children === 'function' ? children(close) : children}
      </div>
    </Popover>
  );
}

/** `checked` turns the item into one choice of a group (menuitemradio) with a check mark. */
export function MenuItem({ icon: Icon, iconClassName = 'text-text-muted', label, description, trailing, danger = false, disabled = false, checked, onSelect }) {
  const isChoice = checked !== undefined;
  return (
    <button
      type="button"
      role={isChoice ? 'menuitemradio' : 'menuitem'}
      aria-checked={isChoice ? checked : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer
        focus-visible:outline-none focus-visible:bg-surface-hover hover:bg-surface-hover disabled:opacity-50 disabled:pointer-events-none
        ${danger ? 'text-status-danger' : 'text-text-primary'}`}
    >
      {Icon && <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${danger ? 'text-status-danger' : iconClassName}`} aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-text-muted">{description}</span>}
      </span>
      {trailing}
      {isChoice && <Check className={`mt-0.5 h-4 w-4 shrink-0 ${checked ? 'text-text-primary' : 'invisible'}`} aria-hidden="true" />}
    </button>
  );
}

export function MenuLabel({ children }) {
  return <p className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-text-subtle">{children}</p>;
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1.5 h-px bg-border-subtle" />;
}

export function MenuNote({ children }) {
  return <p className="px-2.5 pb-1.5 pt-1 text-xs leading-snug text-text-subtle">{children}</p>;
}

export default Menu;

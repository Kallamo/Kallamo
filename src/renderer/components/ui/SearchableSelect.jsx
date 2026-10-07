import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import Popover from './Popover';

/**
 * Search-first selector for any option set that can grow. Options may include
 * aliases, keywords, a group, an icon and a short description. An option with
 * `disabled` stays visible, with `disabledLabel` in place of its group.
 * `searchInTrigger` turns the field itself into the search box while open,
 * instead of a second search field inside the list.
 */
export default function SearchableSelect({
  value = '',
  values = [],
  onChange,
  options = [],
  placeholder = 'Choose an option',
  searchPlaceholder = 'Type to filter…',
  emptyMessage = 'No matching options.',
  multiple = false,
  disabled = false,
  clearable = true,
  autoOpen = false,
  ariaLabel,
  searchInTrigger = false,
  onClose,
  className = '',
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIds = multiple ? (values ?? []) : value ? [value] : [];
  const optionMap = useMemo(() => new Map(options.map(option => [option.id, option])), [options]);
  const selected = selectedIds.map(id => optionMap.get(id)).filter(Boolean);
  const SelectedIcon = !multiple ? selected[0]?.icon : null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter(option => [
      option.label,
      option.group,
      option.description,
      ...(option.aliases ?? []),
      ...(option.keywords ?? []),
    ].some(text => String(text ?? '').toLocaleLowerCase().includes(needle)));
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(current => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const close = () => {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(0);
    onClose?.();
  };

  const select = (id) => {
    if (optionMap.get(id)?.disabled) return;
    if (!multiple) {
      onChange(id);
      close();
      return;
    }
    onChange(selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id]);
  };

  const moveActive = (amount) => {
    if (!filtered.length) return;
    setActiveIndex(current => (current + amount + filtered.length) % filtered.length);
  };

  const handleMenuKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (event.key === 'Enter' && filtered[activeIndex] && !filtered[activeIndex].disabled) {
      event.preventDefault();
      select(filtered[activeIndex].id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        {searchInTrigger && isOpen ? (
          <div className="flex min-h-10 w-full items-center gap-2 rounded-control border border-accent/70 bg-surface-input px-3 ring-3 ring-accent/15">
            <Search className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={handleMenuKeyDown}
              placeholder={searchPlaceholder}
              role="combobox"
              aria-label={ariaLabel || 'Filter options'}
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={filtered[activeIndex] ? `${listboxId}-${filtered[activeIndex].id}` : undefined}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-subtle"
            />
          </div>
        ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen(current => !current)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex(event.key === 'ArrowDown' ? 0 : Math.max(0, filtered.length - 1));
            }
          }}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-controls={isOpen ? listboxId : undefined}
          aria-expanded={isOpen}
          className={`flex min-h-10 w-full items-center gap-2 rounded-control border border-border-default bg-surface-input px-3 text-left text-sm text-text-secondary transition-colors
            hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50
            ${clearable && selected.length > 0 && !multiple ? 'pr-16' : 'pr-9'}`}
        >
          {SelectedIcon ? <SelectedIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" /> : null}
          {!multiple && !SelectedIcon && selected[0]?.dotClassName ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected[0].dotClassName}`} /> : null}
          <span className={`min-w-0 flex-1 truncate ${selected.length ? '' : 'text-text-subtle'}`}>
            {multiple
              ? selected.length ? `${selected.length} selected` : placeholder
              : selected[0]?.label ?? placeholder}
          </span>
        </button>
        )}
        {clearable && selected.length > 0 && !multiple && !(searchInTrigger && isOpen) ? (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => onChange('')}
            className="absolute right-8 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover/55 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {searchInTrigger && isOpen ? null : <ChevronDown className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
      </div>

      {multiple && selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => select(option.id)}
              className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border-default bg-surface-hover/40 px-2.5 py-1 text-xs text-text-secondary hover:border-status-danger/30 hover:text-status-danger"
            >
              {option.label}<X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}

      <Popover anchorRef={rootRef} open={isOpen} onClose={close} maxHeight={320} scroll={false} className="border-border-default bg-surface-panel-muted p-0 shadow-shade/50">
        {!searchInTrigger && <div className="relative border-b border-border-subtle bg-surface-panel-muted">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={handleMenuKeyDown}
            placeholder={searchPlaceholder}
            aria-label="Filter options"
            aria-controls={listboxId}
            aria-activedescendant={filtered[activeIndex] ? `${listboxId}-${filtered[activeIndex].id}` : undefined}
            className="h-11 w-full bg-transparent pl-10 pr-3 text-sm text-text-secondary outline-none placeholder:text-text-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
          />
        </div>}
        <div id={listboxId} role="listbox" aria-multiselectable={multiple || undefined} className="max-h-64 overflow-y-auto overscroll-contain p-1.5 custom-scrollbar">
          {filtered.map((option, index) => {
            const isSelected = selectedIds.includes(option.id);
            const isActive = index === activeIndex;
            const Icon = option.icon;
            return (
              <button
                id={`${listboxId}-${option.id}`}
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(option.id)}
                className={`flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors [content-visibility:auto] [contain-intrinsic-size:0_44px]
                  ${option.disabled ? 'cursor-default opacity-50 ' : ''}${isSelected ? 'bg-accent/12 text-accent' : isActive ? 'bg-surface-hover/55 text-text-primary' : 'text-text-secondary hover:bg-surface-hover/55 hover:text-text-primary'}`}
              >
                {Icon ? <Icon className={`h-4 w-4 shrink-0 ${option.iconClassName || ''}`} aria-hidden="true" /> : null}
                {!Icon && option.dotClassName ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${option.dotClassName}`} /> : null}
                {option.color ? <span className="h-6 w-1 rounded-full" style={{ backgroundColor: option.color }} /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{option.label}</span>
                  {option.description ? <span className="mt-0.5 block truncate text-xs text-text-subtle">{option.description}</span> : null}
                </span>
                {option.disabled && option.disabledLabel
                  ? <span className="text-xs text-text-subtle">{option.disabledLabel}</span>
                  : option.group ? <span className="text-xs text-text-subtle">{option.group}</span> : null}
                {isSelected ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })}
          {!filtered.length ? <p className="px-3 py-5 text-center text-sm italic text-text-subtle">{emptyMessage}</p> : null}
        </div>
      </Popover>
    </div>
  );
}

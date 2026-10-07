import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import Popover from './Popover';

export default function SelectMenu({
  value,
  onChange,
  options = [],
  ariaLabel,
  className = '',
  unboxed = false,
}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);

  const choose = nextValue => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className={`flex min-h-9 w-full items-center justify-between gap-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 ${unboxed === 'strong'
          ? 'rounded-md px-3 text-text-primary hover:bg-surface-hover/45'
          : unboxed
          ? 'rounded-md px-1.5 text-text-muted hover:bg-surface-hover/45 hover:text-text-primary'
          : 'rounded-control border border-border-default bg-surface-input px-3 text-text-secondary hover:border-border-strong'
        }`}
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <Popover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        maxHeight={280}
        fitWidth={432}
        className="border-border-default bg-surface-panel-muted p-1.5 shadow-shade/60"
        role="listbox"
      >
        {options.map(option => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => choose(option.value)}
              className={`flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm transition-colors ${isSelected
                ? 'bg-accent/12 text-accent'
                : 'text-text-secondary hover:bg-surface-hover/55 hover:text-text-primary'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isSelected && <Check className="h-4 w-4 shrink-0" />}
            </button>
          );
        })}
      </Popover>
    </div>
  );
}

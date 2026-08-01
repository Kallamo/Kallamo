import { useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import Popover from './Popover';

/**
 * @param {{
 *   value?: string;
 *   values?: string[];
 *   onChange: (value: any) => void;
 *   options: Array<{ id: string; label: string; aliases?: string[]; group?: string; color?: string; description?: string }>;
 *   placeholder: string;
 *   multiple?: boolean;
 *   disabled?: boolean;
 * }} props
 */
export default function SearchableSelect({ value = '', values = [], onChange, options, placeholder, multiple = false, disabled = false }) {
  const rootRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedIds = multiple ? values ?? [] : value ? [value] : [];
  const selected = options.filter(option => selectedIds.includes(option.id));
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter(option => [option.label, option.group, ...(option.aliases ?? [])]
      .some(text => String(text ?? '').toLocaleLowerCase().includes(needle)));
  }, [options, query]);

  const select = id => {
    if (!multiple) {
      onChange(id);
      setIsOpen(false);
      setQuery('');
      return;
    }
    onChange(selectedIds.includes(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id]);
  };

  return <div ref={rootRef} className="relative">
    <button type="button" disabled={disabled} onClick={() => setIsOpen(current => !current)} aria-haspopup="listbox" aria-expanded={isOpen} className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-white/10 bg-[#06151b] px-3 text-left text-sm text-gray-200 transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50">
      <span className={`min-w-0 flex-1 truncate ${selected.length ? '' : 'text-gray-600'}`}>
        {multiple ? selected.length ? `${selected.length} selected` : placeholder : selected[0]?.label ?? placeholder}
      </span>
      {selected.length > 0 && !multiple && <span role="button" tabIndex={0} aria-label="Clear selection" onClick={event => { event.stopPropagation(); onChange(''); }} onKeyDown={event => event.key === 'Enter' && onChange('')} className="rounded p-1 text-gray-600 hover:text-gray-300"><X className="h-3.5 w-3.5" /></span>}
      <ChevronDown className={`h-4 w-4 shrink-0 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
    </button>

    {multiple && selected.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{selected.map(option => <button key={option.id} type="button" onClick={() => select(option.id)} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-gray-300 hover:border-red-400/30 hover:text-red-300">{option.label}<X className="h-3 w-3" /></button>)}</div>}

    <Popover anchorRef={rootRef} open={isOpen} onClose={() => setIsOpen(false)} maxHeight={288} className="border-white/15 bg-[#071820] p-0 shadow-black/50">
      <div className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#071820]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Escape' && setIsOpen(false)} placeholder="Type to filter..." aria-label="Filter options" className="h-11 w-full bg-transparent pl-10 pr-3 text-sm text-gray-200 outline-none placeholder:text-gray-600 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40" /></div>
      <div role="listbox" aria-multiselectable={multiple || undefined} className="max-h-60 overflow-y-auto p-1.5 custom-scrollbar">
        {filtered.map(option => {
          const isSelected = selectedIds.includes(option.id);
          return <button key={option.id} type="button" role="option" aria-selected={isSelected} onClick={() => select(option.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${isSelected ? 'bg-accent/12 text-accent' : 'text-gray-300 hover:bg-white/[0.06] hover:text-white'}`}>
            {option.color && <span className="h-6 w-1 rounded-full" style={{ backgroundColor: option.color }} />}
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{option.label}</span>{option.description && <span className="mt-0.5 block truncate text-xs text-gray-600">{option.description}</span>}</span>
            {option.group && <span className="text-[0.65rem] font-bold uppercase tracking-wider text-gray-600">{option.group}</span>}
            {isSelected && <Check className="h-4 w-4 shrink-0" />}
          </button>;
        })}
        {!filtered.length && <p className="px-3 py-5 text-center text-sm italic text-gray-600">No matching options.</p>}
      </div>
    </Popover>
  </div>;
}

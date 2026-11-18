import { useEffect, useRef } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import Tooltip from '../../../components/ui/Tooltip';

const iconButton = active => `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? 'bg-tint/[0.13] text-text-primary' : 'text-text-muted hover:bg-tint/5 hover:text-text-primary'}`;

export default function ChatFind({ query, onQueryChange, caseSensitive, onCaseSensitiveChange, current, total, busy, onStep, onClose, focusSignal }) {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const onKeyDown = event => {
    if (event.key === 'Enter') { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  };

  return (
    <div role="search" aria-label="Find in chat" className="glass-panel glass-dense flex w-[22rem] max-w-full items-center gap-1 rounded-card border border-border-default p-1.5 shadow-overlay animate-in fade-in slide-in-from-top-1 duration-150">
      <label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-default bg-surface-input px-2 focus-within:border-accent/70">
        <span className="sr-only">Find in chat</span>
        <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
        <input
          ref={inputRef}
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Find in chat"
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-subtle focus:outline-none"
        />
        {query && (
          <span aria-live="polite" className="shrink-0 text-xs tabular-nums text-text-subtle">
            {busy ? 'Loading…' : total ? `${current + 1} of ${total}` : 'No matches'}
          </span>
        )}
      </label>
      <Tooltip content="Match case"><button type="button" aria-label="Match case" aria-pressed={caseSensitive} onClick={() => onCaseSensitiveChange(!caseSensitive)} className={iconButton(caseSensitive)}><CaseSensitive aria-hidden="true" className="h-4 w-4" /></button></Tooltip>
      <Tooltip content="Previous (Shift Enter)"><button type="button" aria-label="Previous match" onClick={() => onStep(-1)} disabled={!total} className={iconButton(false)}><ChevronUp aria-hidden="true" className="h-4 w-4" /></button></Tooltip>
      <Tooltip content="Next (Enter)"><button type="button" aria-label="Next match" onClick={() => onStep(1)} disabled={!total} className={iconButton(false)}><ChevronDown aria-hidden="true" className="h-4 w-4" /></button></Tooltip>
      <Tooltip content="Close (Esc)"><button type="button" aria-label="Close search" onClick={onClose} className={iconButton(false)}><X aria-hidden="true" className="h-4 w-4" /></button></Tooltip>
    </div>
  );
}

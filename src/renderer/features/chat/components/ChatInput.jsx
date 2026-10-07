import { useEffect, useRef, useState } from 'react';
import { SendHorizontal, Square } from 'lucide-react';

const sessionDrafts = new Map();

// The composer: the draft on top, the tools row below. `leading` and `trailing`
// hold the workspace's own controls (attach, context, reply target).
export default function ChatInput({
  canSend,
  hasTargets,
  isGenerating,
  onCancel,
  onSend,
  pendingFileCount,
  placeholder,
  workspaceId,
  leading,
  trailing
}) {
  const [inputValue, setInputValue] = useState(() => sessionDrafts.get(workspaceId) || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
  }, [inputValue]);

  useEffect(() => {
    setInputValue(sessionDrafts.get(workspaceId) || '');
  }, [workspaceId]);

  const updateInputValue = (value) => {
    setInputValue(value);
    if (value) sessionDrafts.set(workspaceId, value);
    else sessionDrafts.delete(workspaceId);
  };

  const submit = () => {
    if (onSend(inputValue)) updateInputValue('');
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !isGenerating) {
      event.preventDefault();
      submit();
    }
  };

  const isDisabled = (!isGenerating && !inputValue.trim() && pendingFileCount === 0) || !hasTargets || (!isGenerating && !canSend);

  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={inputRef}
        value={inputValue}
        onChange={(event) => updateInputValue(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        aria-label="Message"
        placeholder={placeholder}
        className="w-full resize-none border-0 bg-transparent px-1 py-1.5 font-sans text-sm leading-relaxed text-text-primary placeholder:text-text-subtle focus:outline-none custom-scrollbar"
      />
      <div className="-ml-1.5 flex items-center gap-1">
        {leading}
        <span className="flex-1" />
        {trailing}
        <span data-tooltip={(!isGenerating && !canSend) ? 'This AI Profile needs setup: create an API profile in Settings, then link it in the Library.' : undefined} className="ml-1 shrink-0">
          <button
            type="button"
            aria-label={isGenerating ? 'Stop generating' : 'Send message'}
            onClick={isGenerating ? onCancel : submit}
            disabled={isDisabled}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[filter,background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50 cursor-pointer ${isGenerating
              ? 'border border-border-strong bg-tint/[0.08] text-text-primary hover:bg-danger-solid hover:border-danger-solid hover:text-on-danger'
              : 'bg-accent text-on-accent shadow-sm hover:brightness-110'}`}
          >
            {isGenerating ? <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" /> : <SendHorizontal aria-hidden="true" className="h-4 w-4" />}
          </button>
        </span>
      </div>
    </div>
  );
}

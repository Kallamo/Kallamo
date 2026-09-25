import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import Button from '../../../components/ui/Button';

const Key = ({ children }) => (
  <kbd className="rounded border border-border-default px-1.5 font-mono text-[0.6875rem] text-text-secondary">{children}</kbd>
);

// Owns its draft so keystrokes don't re-render the whole message list.
export default memo(function MessageEditor({
  initialValue,
  sizeClass,
  saveLabel,
  hint,
  onCancel,
  onSave,
  requireChange = false
}) {
  const [text, setText] = useState(initialValue);
  const textareaRef = useRef(null);
  const canSave = !requireChange || text !== initialValue;

  // Grows with the text up to 60% of the window, then scrolls, so a long reply is never cut.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight + 2, window.innerHeight * 0.6)}px`;
  }, [text]);

  const handleKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canSave) {
      event.preventDefault();
      onSave(text);
    }
  };

  return (
    <div className="flex w-full flex-col gap-2.5 text-left">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        aria-label="Message text"
        className={`w-full resize-none rounded-card border border-accent/70 bg-surface-input px-4 py-3.5 ${sizeClass} leading-relaxed text-text-primary placeholder-text-disabled ring-3 ring-accent/15 focus:outline-none custom-scrollbar`}
      />
      <div className="flex flex-wrap items-center gap-2 select-none">
        <div className="min-w-0 flex-1">
          <p className="chat-hint inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-secondary">
          {hint && <><Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /><span>{hint}</span></>}
          <span className="inline-flex items-center gap-1">{hint && <span aria-hidden="true">·</span>}<Key>Esc</Key> cancel · <Key>Ctrl</Key><Key>Enter</Key> save</span>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!canSave} onClick={() => onSave(text)}>{saveLabel}</Button>
      </div>
    </div>
  );
});

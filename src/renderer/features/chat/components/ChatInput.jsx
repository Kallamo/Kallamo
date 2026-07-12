import { useEffect, useRef, useState } from 'react';
import { RotateCw, Send, Square } from 'lucide-react';

export default function ChatInput({
  canSend,
  hasTargets,
  isGenerating,
  onCancel,
  onSend,
  pendingFileCount,
  placeholder
}) {
  const [inputValue, setInputValue] = useState('');
  const [isHoveringSend, setIsHoveringSend] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 108)}px`;
  }, [inputValue]);

  const submit = () => {
    if (onSend(inputValue)) setInputValue('');
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !isGenerating) {
      event.preventDefault();
      submit();
    }
  };

  const isDisabled = (!isGenerating && !inputValue.trim() && pendingFileCount === 0) || !hasTargets || (!isGenerating && !canSend);

  return (
    <>
      <textarea
        ref={inputRef}
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        aria-label="Message"
        placeholder={placeholder}
        style={{ maxHeight: '120px', overflowY: 'auto' }}
        className="order-2 flex-1 bg-transparent border-0 text-white text-xs px-3 py-2.5 focus:outline-none resize-none font-sans custom-scrollbar leading-relaxed"
      />
      <span data-tooltip={(!isGenerating && !canSend) ? 'This AI Profile needs setup: create an API profile in Settings, then link it in the Library.' : undefined} className="order-4 shrink-0">
        <button
          type="button"
          aria-label={isGenerating ? 'Cancel generation' : 'Send message'}
          onClick={isGenerating ? onCancel : submit}
          disabled={isDisabled}
          onMouseEnter={() => setIsHoveringSend(true)}
          onMouseLeave={() => setIsHoveringSend(false)}
          className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center shadow-md transition-all active:scale-95 cursor-pointer border ${isGenerating
            ? isHoveringSend
              ? 'bg-red-600 hover:bg-red-500 border-red-500/20 text-white hover:brightness-110'
              : 'bg-accent/20 border-accent/40 text-accent cursor-wait'
            : 'bg-accent border-accent text-[#011419] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none'
            }`}
        >
          {isGenerating ? (
            isHoveringSend ? <Square className="w-4 h-4 fill-current text-white" /> : <RotateCw className="w-4 h-4 animate-spin text-accent" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </span>
    </>
  );
}

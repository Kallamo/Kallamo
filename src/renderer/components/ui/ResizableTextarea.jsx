import React, { useEffect, useRef, useState } from 'react';

const PREFIX = 'kallamo.textarea.';

function readHeight(storageKey) {
  if (!storageKey) return null;
  try {
    const value = Number(localStorage.getItem(PREFIX + storageKey));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * A textarea the person can drag taller or shorter. With `storageKey`, the height they
 * choose is kept for every field that shares the key, so it opens at that size next time.
 */
const ResizableTextarea = React.forwardRef(function ResizableTextarea({ storageKey, defaultHeight = '5rem', className = '', style, ...rest }, ref) {
  const innerRef = useRef(null);
  const [height] = useState(() => readHeight(storageKey));

  useEffect(() => {
    const element = innerRef.current;
    if (!element || !storageKey || typeof ResizeObserver === 'undefined') return undefined;
    let timer;
    let last = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      const next = element.offsetHeight;
      // Width changes and hidden fields (height 0) are not a choice of height.
      if (!next || next === last) return;
      last = next;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try { localStorage.setItem(PREFIX + storageKey, String(Math.round(next))); } catch { /* the size just is not remembered */ }
      }, 300);
    });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [storageKey]);

  const setRefs = element => {
    innerRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  return (
    <textarea
      ref={setRefs}
      className={`field-input custom-scrollbar min-h-16 max-h-[40rem] resize-y px-3 py-2.5 text-sm leading-relaxed ${className}`}
      style={{ height: height ? `${height}px` : defaultHeight, ...style }}
      {...rest}
    />
  );
});

export default ResizableTextarea;

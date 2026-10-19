import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 250;
const GAP = 8;
const EDGE = 8;

function place(side, anchor, tip) {
  const positions = {
    top: { top: anchor.top - tip.height - GAP, left: anchor.left + anchor.width / 2 - tip.width / 2 },
    bottom: { top: anchor.bottom + GAP, left: anchor.left + anchor.width / 2 - tip.width / 2 },
    left: { top: anchor.top + anchor.height / 2 - tip.height / 2, left: anchor.left - tip.width - GAP },
    right: { top: anchor.top + anchor.height / 2 - tip.height / 2, left: anchor.right + GAP }
  };
  const fits = ({ top, left }) => top >= EDGE && left >= EDGE
    && top + tip.height <= window.innerHeight - EDGE && left + tip.width <= window.innerWidth - EDGE;
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side];
  const chosen = fits(positions[side]) ? positions[side] : positions[opposite];
  return {
    top: Math.min(Math.max(EDGE, chosen.top), window.innerHeight - tip.height - EDGE),
    left: Math.min(Math.max(EDGE, chosen.left), window.innerWidth - tip.width - EDGE)
  };
}

/** Use instead of the native `title`. Wraps one element without adding a node. */
export default function Tooltip({ content, side = 'top', children, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const anchorRef = useRef(null);
  const tipRef = useRef(null);
  const timerRef = useRef(null);
  const id = useId();

  const show = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setOpen(false);
    setPosition(null);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    setPosition(place(side, anchorRef.current.getBoundingClientRect(), tipRef.current.getBoundingClientRect()));
  }, [open, side, content]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => { if (event.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hide]);

  if (!isValidElement(children)) return children;
  if (disabled || !content) return children;

  const childProps = children.props;
  const childRef = childProps.ref;
  const setRef = node => {
    anchorRef.current = node;
    if (typeof childRef === 'function') childRef(node);
    else if (childRef) childRef.current = node;
  };
  const chain = (handler, own) => event => {
    handler?.(event);
    own(event);
  };

  return (
    <>
      {cloneElement(children, {
        ref: setRef,
        'aria-describedby': open ? id : childProps['aria-describedby'],
        onMouseEnter: chain(childProps.onMouseEnter, show),
        onMouseLeave: chain(childProps.onMouseLeave, hide),
        onFocus: chain(childProps.onFocus, show),
        onBlur: chain(childProps.onBlur, hide),
        onPointerDown: chain(childProps.onPointerDown, hide)
      })}
      {open && createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          data-floating-layer="tooltip"
          style={{ position: 'fixed', top: position?.top ?? -9999, left: position?.left ?? -9999, zIndex: 100000 }}
          className={`pointer-events-none max-w-[16rem] rounded-card border border-border-default bg-surface-panel-muted px-3 py-2 text-xs leading-snug text-text-secondary shadow-overlay transition-opacity duration-150 ${position ? 'opacity-100' : 'opacity-0'}`}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}

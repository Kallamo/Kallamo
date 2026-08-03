import React, { useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Anchored floating panel rendered into document.body via a portal, so it can
 * never be clipped or stacked behind by a parent's overflow / z-index. Position
 * is computed from the anchor's bounding rect with fixed coordinates, flips
 * above when there isn't room below, and re-measures on scroll / resize.
 *
 * Dismissal mirrors the app's useDismiss: a document mousedown outside both the
 * anchor and the panel closes it, as does Escape. No covering backdrop, so the
 * anchor input stays usable and adjacent triggers switch in a single click.
 *
 * Usage:
 *   const anchorRef = useRef(null);
 *   <div ref={anchorRef}><TextInput ... /></div>
 *   <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
 *     ...menu items...
 *   </Popover>
 */
export default function Popover({
  anchorRef,
  open,
  onClose,
  matchAnchorWidth = true,
  gap = 6,
  maxHeight = 240,
  align = 'left',
  scroll = true,
  className = '',
  role = undefined,
  children,
}) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [style, setStyle] = useState(null);
  onCloseRef.current = onClose;

  const reposition = useCallback(() => {
    const el = anchorRef?.current;
    if (!el || !el.isConnected) {
      onCloseRef.current?.();
      return;
    }
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < maxHeight + gap && spaceAbove > spaceBelow;

    const next = {
      position: 'fixed',
      zIndex: 9999,
      maxWidth: 'calc(100vw - 16px)',
    };
    if (scroll) next.maxHeight = Math.max(120, Math.min(maxHeight, (flipUp ? spaceAbove : spaceBelow) - gap));
    if (align === 'right') next.right = Math.max(8, window.innerWidth - rect.right);
    else next.left = Math.max(8, Math.min(rect.left, window.innerWidth - (matchAnchorWidth ? rect.width : 240) - 8));
    if (matchAnchorWidth) next.width = Math.min(rect.width, window.innerWidth - 16);
    if (flipUp) next.bottom = window.innerHeight - rect.top + gap;
    else next.top = rect.bottom + gap;

    setStyle(next);
  }, [anchorRef, gap, maxHeight, matchAnchorWidth, align, scroll]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();

    const onDown = (e) => {
      const anchor = anchorRef?.current;
      const panel = panelRef.current;
      if (anchor && anchor.contains(e.target)) return;
      if (panel && panel.contains(e.target)) return;
      onCloseRef.current?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };

    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, reposition, anchorRef]);

  if (!open || !style) return null;

  return createPortal(
    <div
      ref={panelRef}
      role={role}
      data-floating-layer="popover"
      style={style}
      className={`${scroll ? 'overflow-y-auto overscroll-contain custom-scrollbar' : ''} bg-surface-panel border border-border-default rounded-xl shadow-2xl p-1 animate-in fade-in duration-150 ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}

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
  children,
}) {
  const panelRef = useRef(null);
  const [style, setStyle] = useState(null);

  const reposition = useCallback(() => {
    const el = anchorRef?.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < maxHeight + gap && spaceAbove > spaceBelow;

    const next = {
      position: 'fixed',
      zIndex: 9999,
    };
    if (scroll) next.maxHeight = Math.max(120, Math.min(maxHeight, (flipUp ? spaceAbove : spaceBelow) - gap));
    if (align === 'right') next.right = window.innerWidth - rect.right;
    else next.left = rect.left;
    if (matchAnchorWidth) next.width = rect.width;
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
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };

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
  }, [open, reposition, anchorRef, onClose]);

  if (!open || !style) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className={`${scroll ? 'overflow-y-auto custom-scrollbar' : ''} bg-[#0a161d] border border-gray-800 rounded-xl shadow-2xl p-1 animate-in fade-in duration-150 ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}

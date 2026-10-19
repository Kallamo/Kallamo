import React, { useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portaled so no parent overflow can clip it. No backdrop: the anchor stays usable and an
 * adjacent trigger switches in a single click.
 */
export default function Popover({
  anchorRef,
  open,
  onClose,
  matchAnchorWidth = true,
  // At least as wide as the anchor, growing to fit its content up to this many pixels.
  fitWidth = 0,
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
  const seenAnchorRef = useRef(false);
  const [style, setStyle] = useState(null);
  onCloseRef.current = onClose;

  const reposition = useCallback(() => {
    const el = anchorRef?.current;
    // A panel that mounts open runs this before the parent's ref is attached; wait for the next frame.
    if (!el && !seenAnchorRef.current) return;
    if (!el || !el.isConnected) {
      onCloseRef.current?.();
      return;
    }
    seenAnchorRef.current = true;
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
    // The first pass runs before the panel exists; the follow-up frame clamps with its real width.
    const panelWidth = matchAnchorWidth && !fitWidth ? rect.width : (panelRef.current?.offsetWidth || rect.width);
    const maxOffset = Math.max(8, window.innerWidth - panelWidth - 8);
    if (align === 'right') next.right = Math.min(maxOffset, Math.max(8, window.innerWidth - rect.right));
    else next.left = Math.min(maxOffset, Math.max(8, rect.left));
    if (fitWidth) {
      next.width = 'max-content';
      next.minWidth = Math.min(rect.width, window.innerWidth - 16);
      next.maxWidth = Math.max(Math.min(rect.width, window.innerWidth - 16), Math.min(fitWidth, window.innerWidth - 16));
    } else if (matchAnchorWidth) next.width = Math.min(rect.width, window.innerWidth - 16);
    if (flipUp) next.bottom = window.innerHeight - rect.top + gap;
    else next.top = rect.bottom + gap;

    setStyle(next);
  }, [anchorRef, gap, maxHeight, matchAnchorWidth, fitWidth, align, scroll]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const frame = window.requestAnimationFrame(reposition);

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
      window.cancelAnimationFrame(frame);
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
      className={`${scroll ? 'overflow-y-auto overscroll-contain custom-scrollbar' : ''} bg-surface-panel border border-border-default rounded-card shadow-2xl p-1 animate-in fade-in duration-150 ${className}`}
    >
      {children}
    </div>,
    document.body
  );
}

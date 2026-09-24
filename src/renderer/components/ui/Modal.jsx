import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

/**
 * Shared modal shell for Kallamo.
 *
 * Owns the overlay, centering, blur (respects interface.blur setting),
 * enter animation, Esc-to-close, click-outside-to-close, and background
 * scroll lock. Children provide the content; pass `title` for a standard
 * header with close button, or omit it for a fully custom body.
 *
 * Never hand-roll overlay markup elsewhere, build on this.
 */
const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  wide: 'max-w-4xl',
  '2xl': 'max-w-5xl',
};

export default function Modal({
  onClose,
  size = 'sm',
  title = null,
  icon: Icon = null,
  closeOnOverlay = true,
  closeOnEsc = true,
  showClose = true,
  className = '',
  children,
}) {
  const { settings } = useApp();
  const isBlurEnabled = settings?.interface?.blur ?? true;
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const generatedTitleId = useId();

  useEffect(() => {
    if (!closeOnEsc) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOnEsc, onClose]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const target = dialog?.querySelector('[autofocus], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])');
      (target || dialog)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = prev;
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  const keepFocusInside = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') || [])];
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose?.();
      }}
      className={`fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto overscroll-contain titlebar-nodrag select-none p-4 ${
        isBlurEnabled ? 'bg-surface-overlay backdrop-blur-sm' : 'bg-surface-canvas'
      }`}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? generatedTitleId : undefined}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
        className={`w-full ${SIZES[size] || SIZES.sm} bg-surface-canvas border border-border-default rounded-card shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 ${className}`}
      >
        {title && (
          <div className="relative z-10 shrink-0 flex items-center justify-between gap-3 min-h-14 px-5 bg-surface-panel/60 border-b border-border-subtle">
            <div className="flex items-center gap-2.5 min-w-0">
              {Icon && <Icon className="w-4 h-4 text-accent shrink-0" />}
              <h2 id={generatedTitleId} className="text-base font-semibold text-text-primary truncate">{title}</h2>
            </div>
            {showClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="titlebar-nodrag relative z-10 min-h-8 min-w-8 inline-flex items-center justify-center text-text-muted hover:text-status-danger transition-colors cursor-pointer rounded-md hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}

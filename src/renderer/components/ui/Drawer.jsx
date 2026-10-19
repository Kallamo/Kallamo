import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * For editors and viewers beside the content; decisions use ConfirmDialog, centered forms Modal.
 * Portaled so no parent clips it; `position="absolute"` only for a region inside a panel.
 */
export default function Drawer({
  onClose,
  side = 'right',
  width = 'w-[500px]',
  position = 'fixed',
  title = null,
  icon: Icon = null,
  subtitle = null,
  overlay = false,
  closeOnEsc = true,
  className = '',
  bodyClassName = '',
  children,
}) {
  const fixed = position === 'fixed';

  useEffect(() => {
    if (!closeOnEsc) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOnEsc, onClose]);

  useEffect(() => {
    if (!fixed) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fixed]);

  const slide = side === 'right' ? 'slide-in-from-right' : 'slide-in-from-left';
  const edge = side === 'right' ? 'right-0 border-l' : 'left-0 border-r';

  const content = (
    <>
      {overlay && (
        <div
          onMouseDown={onClose}
          className={`${fixed ? 'fixed' : 'absolute'} inset-0 z-40 bg-surface-canvas/60 animate-in fade-in duration-200`}
        />
      )}
      <div
        role={fixed ? 'dialog' : 'region'}
        aria-modal={fixed && overlay ? true : undefined}
        aria-label={title || 'Side panel'}
        className={`${fixed ? 'fixed' : 'absolute'} inset-y-0 ${edge} ${width} max-w-full z-40
          bg-surface-canvas border-border-default shadow-2xl flex flex-col p-6
          animate-in ${slide} duration-200 ${className}`}
      >
        {(title || subtitle) && (
          <div className="flex justify-between items-start gap-3 mb-4 shrink-0 pb-2 border-b border-border-subtle">
            <div className="min-w-0">
              {title && (
                <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                  {Icon && <Icon className="w-4 h-4 text-accent shrink-0" />}
                  <span className="truncate">{title}</span>
                </h3>
              )}
              {subtitle && (
                <span className="text-xs font-mono text-text-subtle truncate block mt-0.5" title={subtitle}>
                  {subtitle}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close panel"
              className="inline-flex h-8 w-8 items-center justify-center rounded-control text-text-muted hover:bg-status-danger/10 hover:text-status-danger transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar ${bodyClassName}`}>
          {children}
        </div>
      </div>
    </>
  );

  return fixed ? createPortal(content, document.body) : content;
}

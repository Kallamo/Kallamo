import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Shared side panel (slide-out drawer). Use for contextual editors and viewers
 * that sit beside content, NOT for decisions (use ConfirmDialog) or centered
 * forms (use Modal).
 *
 * Defaults to `position="absolute"` so it can live inside a relative container
 * (e.g. a Modal body). Pass `position="fixed"` for a full-height app-level
 * drawer; in that mode it locks background scroll and can show an `overlay`.
 *
 * Props:
 *  - side:       'right' | 'left'   (default right)
 *  - width:      Tailwind width class (default 'w-[500px]')
 *  - title:      heading text  ·  icon: optional lucide icon  ·  subtitle: mono sub-line
 *  - overlay:    render a click-to-close backdrop (default false)
 *  - closeOnEsc: default true
 */
export default function Drawer({
  onClose,
  side = 'right',
  width = 'w-[500px]',
  position = 'absolute',
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

  return (
    <>
      {overlay && (
        <div
          onMouseDown={onClose}
          className={`${fixed ? 'fixed' : 'absolute'} inset-0 z-40 bg-black/40 animate-in fade-in duration-200`}
        />
      )}
      <div
        className={`${fixed ? 'fixed' : 'absolute'} inset-y-0 ${edge} ${width} max-w-full z-40
          bg-[#011419] border-gray-800 shadow-2xl flex flex-col p-6
          animate-in ${slide} duration-200 ${className}`}
      >
        {(title || subtitle) && (
          <div className="flex justify-between items-start gap-3 mb-4 shrink-0 pb-2 border-b border-gray-800">
            <div className="min-w-0">
              {title && (
                <h3 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center gap-1.5">
                  {Icon && <Icon className="w-4 h-4 text-blue-400 shrink-0" />}
                  <span className="truncate">{title}</span>
                </h3>
              )}
              {subtitle && (
                <span className="text-[10px] font-mono text-gray-500 truncate block mt-0.5" title={subtitle}>
                  {subtitle}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer shrink-0"
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
}

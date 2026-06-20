import React, { useEffect } from 'react';
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
 * Never hand-roll overlay markup elsewhere — build on this.
 */
const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
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

  useEffect(() => {
    if (!closeOnEsc) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeOnEsc, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose?.();
      }}
      className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-4 ${
        isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'
      }`}
    >
      <div
        className={`w-full ${SIZES[size] || SIZES.sm} bg-[#011419] border border-gray-800/60 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 ${className}`}
      >
        {title && (
          <div className="shrink-0 flex items-center justify-between gap-3 h-14 px-5 bg-[#0a161d]/40 border-b border-gray-800/50">
            <div className="flex items-center gap-2.5 min-w-0">
              {Icon && <Icon className="w-4 h-4 text-accent shrink-0" />}
              <h2 className="text-sm font-bold text-white uppercase tracking-wider truncate">{title}</h2>
            </div>
            {showClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

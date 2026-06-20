import React from 'react';

/**
 * Shared content section container — the standard nested card used across
 * Settings and panels. Optional title/description header and a right-aligned
 * `action` slot; children render the body.
 */
export default function SectionCard({
  title = null,
  description = null,
  icon: Icon = null,
  action = null,
  children,
  className = '',
  bodyClassName = '',
}) {
  const hasHeader = title || description || action;

  return (
    <div className={`bg-[#0a161d] border border-gray-800/80 rounded-xl p-5 ${className}`}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            {title && (
              <div className="flex items-center gap-2">
                {Icon && <Icon className="w-4 h-4 text-accent shrink-0" />}
                <h3 className="text-sm font-bold text-gray-200">{title}</h3>
              </div>
            )}
            {description && (
              <p className="text-xs text-gray-500 leading-relaxed mt-1 max-w-xl">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}

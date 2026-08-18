import React from 'react';

/**
 * Shared empty / zero-data state: dashed container, muted icon, title, subtitle
 * and an optional call-to-action (pass a <Button> via `action`).
 */
export default function EmptyState({
  icon: Icon = null,
  title,
  subtitle = null,
  action = null,
  compact = false,
  className = '',
}) {
  return (
    <div
      className={`w-full flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-9'} px-6
        border border-dashed border-border-default rounded-card bg-surface-canvas/20 ${className}`}
    >
      {Icon && <Icon className={`${compact ? 'w-5 h-5' : 'w-7 h-7'} text-text-subtle mb-3`} />}
      <span className="text-sm font-semibold text-text-secondary">{title}</span>
      {subtitle && (
        <span className="caption mt-1 max-w-md">{subtitle}</span>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

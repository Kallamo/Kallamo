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
  className = '',
}) {
  return (
    <div
      className={`w-full flex flex-col items-center justify-center text-center py-16 px-6
        border border-dashed border-gray-800/80 rounded-xl bg-[#011419]/20 ${className}`}
    >
      {Icon && <Icon className="w-10 h-10 text-gray-600 opacity-40 mb-3" />}
      <span className="text-xs font-semibold text-gray-400">{title}</span>
      {subtitle && (
        <span className="caption mt-1 max-w-md">{subtitle}</span>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

import React from 'react';

/**
 * Shared tab navigation. `items`: [{ id, label, icon }]. Renders horizontal by
 * default, or a vertical sidebar list with `orientation="vertical"`.
 */
export default function Tabs({
  items = [],
  activeId,
  onChange,
  orientation = 'horizontal',
  className = '',
}) {
  const vertical = orientation === 'vertical';

  return (
    <nav className={`flex ${vertical ? 'flex-col space-y-1' : 'items-center gap-1'} ${className}`}>
      {items.map((item) => {
        const active = item.id === activeId;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onChange?.(item.id)}
            className={`flex items-center gap-2 text-left text-xs font-semibold rounded-md transition-all cursor-pointer
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              vertical ? 'w-full px-3 py-2.5' : 'px-3 py-2'
            } ${
              active
                ? 'bg-[#1a2d32] text-white shadow-sm' + (vertical ? ' border-l-2 border-accent' : '')
                : 'text-gray-400 hover:text-gray-200 hover:bg-[#071318]'
            }`}
          >
            {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

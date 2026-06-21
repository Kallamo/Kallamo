import React from 'react';

/**
 * Shared on/off switch. Use standalone, or pass `label` + `description` to
 * render the full settings-row pattern (text left, switch right).
 */
export default function Toggle({
  checked = false,
  onChange,
  label = null,
  description = null,
  disabled = false,
  className = '',
}) {
  const handle = () => { if (!disabled) onChange?.(!checked); };

  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={handle}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors duration-200 cursor-pointer
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
        disabled:opacity-50 disabled:pointer-events-none ${checked ? 'bg-accent' : 'bg-gray-700'} ${className}`}
    >
      <span
        className={`absolute top-[2px] left-[2px] h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );

  if (!label && !description) return control;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        {label && <span className="block text-sm font-bold text-gray-200">{label}</span>}
        {description && (
          <p className="caption mt-1">{description}</p>
        )}
      </div>
      <div className="mt-0.5">{control}</div>
    </div>
  );
}

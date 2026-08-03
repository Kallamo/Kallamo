import React, { useId } from 'react';
import { Check } from 'lucide-react';

/**
 * Shared checkbox. Accent-filled with a soft glow when checked, smooth
 * transition and a tactile press. Pass `label` for an inline clickable row.
 */
export default function Checkbox({
  checked = false,
  onChange,
  label = null,
  disabled = false,
  size = 'md',
  className = '',
  ariaLabel,
}) {
  const inputId = useId();
  const box = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const tick = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  const control = <>
    <input
      id={inputId}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      onChange={(event) => onChange?.(event.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden="true"
      className={`${box} rounded-md border flex items-center justify-center shrink-0 transition-[color,background-color,border-color,box-shadow,transform] duration-150
        peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 peer-active:scale-95 ${
        checked
          ? 'bg-accent border-accent text-on-accent shadow-sm'
          : 'border-border-default bg-surface-input group-hover:border-accent/50'
      } ${className}`}
    >
      {checked && <Check className={`${tick} stroke-[3.5]`} />}
    </span>
  </>;

  if (!label) return <label className={`group inline-flex ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>{control}</label>;

  return (
    <label
      htmlFor={inputId}
      className={`group flex items-center gap-2.5 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      {control}
      <span className="text-sm text-text-secondary">{label}</span>
    </label>
  );
}

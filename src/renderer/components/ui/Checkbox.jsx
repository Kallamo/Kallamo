import React from 'react';
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
}) {
  const box = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const tick = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  const handle = () => { if (!disabled) onChange?.(!checked); };

  const control = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={handle}
      className={`${box} rounded-md border flex items-center justify-center shrink-0 transition-all duration-200
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
        active:scale-95 disabled:opacity-50 disabled:pointer-events-none ${
        checked
          ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(251,203,45,0.4)]'
          : 'border-gray-700 bg-[#00080B]/90 hover:border-accent/50 cursor-pointer'
      } ${className}`}
    >
      {checked && <Check className={`${tick} stroke-[3.5]`} />}
    </button>
  );

  if (!label) return control;

  return (
    <label
      className={`flex items-center gap-2.5 select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      onClick={handle}
    >
      {control}
      <span className="text-xs text-gray-300">{label}</span>
    </label>
  );
}

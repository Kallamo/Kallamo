import React from 'react';

/**
 * Shared text input. Handles label, optional leading icon, hint and error
 * states, plus disabled / read-only styling — so call sites stop re-styling
 * raw <input> elements. Spread the rest (value, onChange, placeholder, type…).
 */
export default function TextInput({
  label = null,
  icon: Icon = null,
  hint = null,
  error = null,
  className = '',
  containerClassName = '',
  ...rest
}) {
  const invalid = !!error;

  return (
    <div className={`flex flex-col ${containerClassName}`}>
      {label && (
        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        )}
        <input
          className={`w-full bg-[#00080B] border text-gray-200 text-xs rounded-md py-2 transition-colors
            placeholder-gray-500 focus:outline-none read-only:bg-gray-900/30 read-only:text-gray-500
            disabled:opacity-60 ${Icon ? 'pl-9 pr-3' : 'px-3'} ${
            invalid
              ? 'border-red-500/60 focus:border-red-500'
              : 'border-gray-800 focus:border-accent'
          } ${className}`}
          {...rest}
        />
      </div>
      {(error || hint) && (
        <span className={`mt-1 ${invalid ? 'text-xs text-red-400 font-semibold' : 'caption'}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

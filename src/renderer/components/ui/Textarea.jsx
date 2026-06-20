import React from 'react';

/**
 * Shared multiline input. Same label/hint/error contract as TextInput.
 * Pass `monospace` for code/prompt content and `showCount` (with maxLength)
 * to surface a live character counter.
 */
const Textarea = React.forwardRef(function Textarea({
  label = null,
  hint = null,
  error = null,
  monospace = false,
  showCount = false,
  maxLength,
  value = '',
  className = '',
  containerClassName = '',
  ...rest
}, ref) {
  const invalid = !!error;

  return (
    <div className={`flex flex-col ${containerClassName}`}>
      {label && (
        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        value={value}
        maxLength={maxLength}
        className={`w-full bg-[#00080B] border text-gray-200 text-xs rounded-md p-3 transition-colors
          placeholder-gray-500 focus:outline-none resize-none custom-scrollbar leading-relaxed
          disabled:opacity-60 ${monospace ? 'font-mono' : ''} ${
          invalid ? 'border-red-500/60 focus:border-red-500' : 'border-gray-800 focus:border-accent'
        } ${className}`}
        {...rest}
      />
      <div className="flex items-center justify-between mt-1">
        <span className={`text-[10px] ${invalid ? 'text-red-400 font-semibold' : 'text-gray-500'}`}>
          {error || hint || ''}
        </span>
        {showCount && maxLength != null && (
          <span className="text-[10px] text-gray-600 font-mono">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
});

export default Textarea;

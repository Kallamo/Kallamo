import React, { useId } from 'react';

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
  const generatedId = useId();
  const textareaId = rest.id || generatedId;
  const messageId = `${textareaId}-message`;

  return (
    <div className={`flex flex-col ${containerClassName}`}>
      {label && (
        <label htmlFor={textareaId} className="mb-1.5 block text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        aria-invalid={invalid || undefined}
        aria-describedby={(error || hint) ? messageId : rest['aria-describedby']}
        value={value}
        maxLength={maxLength}
        className={`w-full rounded-control border bg-surface-input p-3 text-sm text-text-secondary transition-colors
          placeholder:text-text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 resize-none custom-scrollbar leading-relaxed
          disabled:opacity-60 ${monospace ? 'font-mono' : ''} ${
          invalid ? 'border-status-danger/60 focus:border-status-danger' : 'border-border-default focus:border-accent'
        } ${className}`}
        {...rest}
      />
      <div className="flex items-center justify-between mt-1">
        <span id={messageId} className={`${invalid ? 'text-xs font-semibold text-status-danger' : 'caption'}`}>
          {error || hint || ''}
        </span>
        {showCount && maxLength != null && (
          <span className="text-xs text-text-subtle font-mono">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
});

export default Textarea;

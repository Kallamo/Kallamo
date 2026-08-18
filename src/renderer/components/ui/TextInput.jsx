import React, { useId } from 'react';

/**
 * Shared text input. Handles label, optional leading icon, hint and error
 * states, plus disabled / read-only styling, so call sites stop re-styling
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
  const generatedId = useId();
  const inputId = rest.id || generatedId;
  const messageId = `${inputId}-message`;

  return (
    <div className={`flex flex-col ${containerClassName}`}>
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-subtle pointer-events-none" />
        )}
        <input
          id={inputId}
          aria-invalid={invalid || undefined}
          aria-describedby={(error || hint) ? messageId : rest['aria-describedby']}
          className={`min-h-10 w-full rounded-control border bg-surface-input py-2 text-sm text-text-secondary transition-colors
            placeholder:text-text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30
            read-only:bg-surface-panel/60 read-only:text-text-disabled
            disabled:opacity-60 ${Icon ? 'pl-9 pr-3' : 'px-3'} ${
            invalid
              ? 'border-status-danger/60 focus:border-status-danger'
              : 'border-border-default focus:border-accent'
          } ${className}`}
          {...rest}
        />
      </div>
      {(error || hint) && (
        <span id={messageId} className={`mt-1 ${invalid ? 'text-xs font-semibold text-status-danger' : 'caption'}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

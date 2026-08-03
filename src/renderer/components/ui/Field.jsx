import React, { useId } from 'react';

export default function Field({ label, hint = null, error = null, optional = false, children, className = '' }) {
  const hintId = useId();
  const child = React.isValidElement(children)
    ? React.cloneElement(children, {
      'aria-describedby': (hint || error) ? hintId : children.props['aria-describedby'],
      'aria-invalid': error ? true : children.props['aria-invalid'],
    })
    : children;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</span>
        {optional ? <span className="text-xs text-text-subtle">Optional</span> : null}
      </div>
      {child}
      {(hint || error) ? (
        <span id={hintId} className={error ? 'text-xs font-medium text-status-danger' : 'caption'}>
          {error || hint}
        </span>
      ) : null}
    </div>
  );
}

import React from 'react';

export default function SectionCard({
  title = null,
  description = null,
  icon: Icon = null,
  action = null,
  children,
  className = '',
  bodyClassName = '',
}) {
  const hasHeader = title || description || action;

  return (
    <section className={`bg-surface-panel border border-border-subtle rounded-card p-5 ${className}`}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            {title && (
              <div className="flex items-center gap-2">
                {Icon && <Icon className="w-4 h-4 text-accent shrink-0" />}
                <h3 className="text-sm font-bold text-text-secondary">{title}</h3>
              </div>
            )}
            {description && (
              <p className="caption mt-1 max-w-xl">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

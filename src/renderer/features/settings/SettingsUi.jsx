import React from 'react';
import { ArrowLeft } from 'lucide-react';

export function SettingsHeader({ title, description, actions = null, back = null }) {
  return (
    <header className="mb-1">
      {back && (
        <button
          type="button"
          onClick={back.onClick}
          className="mb-2.5 inline-flex items-center gap-1.5 rounded-md text-[0.8125rem] font-semibold text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {back.label}
        </button>
      )}
      <div className="flex items-end gap-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.625rem] font-extrabold tracking-[-0.02em] text-text-primary">{title}</h1>
          {description && <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
      </div>
    </header>
  );
}

export function SettingsGroup({ title, aside = null, id, children, className = '', ...rest }) {
  return (
    <section id={id} className={`scroll-mt-6 ${className}`} {...rest}>
      {(title || aside) && (
        <div className="mb-2.5 mt-7 flex items-baseline justify-between gap-4">
          <h2 className="text-[0.8125rem] font-semibold text-text-secondary">{title}</h2>
          {aside && <span className="caption text-right">{aside}</span>}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-tint/[0.08] surface-card">{children}</div>
    </section>
  );
}

// A small icon in its area's colour, at the head of a settings card.
export function IconTile({ icon: Icon, color }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
      style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 26%, transparent)` }}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

// How something runs and what it runs on, read as one line: the choice first, then its model.
export function RunsOnBar({ mode, children }) {
  return (
    <div className="flex min-h-[2.875rem] items-stretch overflow-hidden rounded-xl border border-tint/[0.08] bg-surface-inset">
      {mode}
      <div className="flex min-w-0 flex-1 items-center border-l border-tint/[0.08]">{children}</div>
    </div>
  );
}

// One option: what it is on the left, its control on the right.
export function SettingsRow({ label, description, children, align = 'center', className = '', disabled = false, ...rest }) {
  return (
    <div className={`flex gap-6 border-t border-tint/[0.055] px-[1.125rem] py-3.5 first:border-t-0 ${align === 'start' ? 'items-start' : 'items-center'} ${disabled ? 'opacity-50' : ''} ${className}`} {...rest}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-text-primary">{label}</div>
        {description && <div className="mt-0.5 text-[0.8125rem] leading-relaxed text-text-muted">{description}</div>}
      </div>
      {children != null && <div className="flex shrink-0 items-center gap-2.5">{children}</div>}
    </div>
  );
}

// Options that only matter because of the row above sit indented under it.
export function SettingsSub({ children, disabled = false }) {
  return (
    <div className={`mx-[1.125rem] mb-3.5 border-l-2 border-tint/[0.08] pl-4 [&>div]:border-t-0 [&>div]:px-0 [&>div]:py-2 ${disabled ? 'opacity-50' : ''}`}>
      {children}
    </div>
  );
}

export function SettingsRadio({ checked, onSelect, label, description, disabled = false, children = null }) {
  return (
    <label className={`flex gap-3 py-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
      <input type="radio" className="peer sr-only" checked={checked} disabled={disabled} onChange={() => !disabled && onSelect?.()} />
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 ${checked ? 'border-accent' : 'border-tint/30'}`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-primary">{label}</span>
        {description && <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-text-muted">{description}</span>}
        {children}
      </span>
    </label>
  );
}

// Width is left to each call site.
export const fieldClass = 'min-h-9 rounded-control border border-border-default bg-surface-input px-3 text-sm text-text-secondary placeholder:text-text-subtle focus:border-accent focus:outline-none';

import { Children, useId } from 'react';
import Toggle from '../../components/ui/Toggle';
import NumberInput from '../../components/ui/NumberInput';

// One Configuration section: a muted icon, a sentence-case title and what it is for.
// `embedded` drops the frame and the title, for a section shown under a tab that already names it.
export function ConfigSection({ id, sectionRef, icon: Icon, title, description, action, status, children, className = '', embedded = false }) {
  const headingId = useId();
  const hasBody = Children.toArray(children).length > 0;
  if (embedded) {
    return (
      <section ref={sectionRef} data-section={id} aria-label={title} className={className}>
        {(description || action) && (
          <div className="mb-4 flex items-start gap-3">
            <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-text-muted">{description}</p>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        )}
        {children}
      </section>
    );
  }
  return (
    <section ref={sectionRef} data-section={id} aria-labelledby={headingId} className={`ws-card scroll-mt-6 rounded-surface border border-border-subtle bg-surface-panel/50 p-6 ${className}`}>
      <header className={`flex items-start gap-3 ${hasBody ? 'mb-5' : ''}`}>
        {Icon && <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-text-muted" />}
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-base font-semibold leading-snug text-text-primary">{title}</h2>
          {description && <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-text-muted">{description}</p>}
        </div>
        {status}
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export const REASON_LIMIT = 80;

// Why a number was changed by hand: one short line, so it reads whole in History and tooltips.
export function ReasonInput({ value, onChange, label, className = '' }) {
  const left = REASON_LIMIT - String(value || '').length;
  return (
    <label className={`flex items-center gap-2 rounded-control border border-border-default bg-surface-input pl-3 pr-2.5 focus-within:border-accent/70 ${className}`}>
      <input
        aria-label={label}
        className="h-8 min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-subtle focus:outline-none"
        maxLength={REASON_LIMIT}
        value={value || ''}
        onChange={event => onChange(event.target.value)}
        placeholder="Why? Optional, shows in History"
      />
      <span className={`shrink-0 text-xs tabular-nums ${left <= 10 ? 'text-status-warning' : 'text-text-subtle'}`}>{left}</span>
    </label>
  );
}

export function FieldLabel({ children, htmlFor, className = '' }) {
  return <label htmlFor={htmlFor} className={`block text-[0.8125rem] font-semibold text-text-secondary ${className}`}>{children}</label>;
}

export function Help({ children, className = '' }) {
  return <p className={`text-xs leading-relaxed text-text-subtle ${className}`}>{children}</p>;
}

// A number with its unit inside the field, saved when the field is left.
export function UnitNumberField({ label, unit, help, value, onChange, onCommit, min, max, step, integer = true, className = '', inputClassName = '' }) {
  const inputId = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <FieldLabel htmlFor={inputId}>{label}</FieldLabel>}
      <div className="field-input flex h-10 items-center gap-2 px-3 focus-within:border-accent/65 focus-within:shadow-[0_0_0_0.1875rem_color-mix(in_srgb,var(--app-accent)_16%,transparent)]">
        <NumberInput
          id={inputId}
          value={value}
          min={min}
          max={max}
          step={step}
          integer={integer}
          onChange={onChange}
          onBlur={() => onCommit?.()}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
          className={`min-w-0 flex-1 bg-transparent text-sm tabular-nums text-text-primary outline-none ${inputClassName}`}
        />
        {unit && <span className="shrink-0 text-xs text-text-subtle">{unit}</span>}
      </div>
      {help && <Help>{help}</Help>}
    </div>
  );
}

// Rows that share one bordered surface, separated by hairlines.
export function SettingsList({ children, className = '' }) {
  return <div className={`divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset ${className}`}>{children}</div>;
}

export function SwitchRow({ label, description, checked, onChange, disabled = false }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] font-semibold text-text-secondary">{label}</span>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-text-subtle">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} ariaLabel={label} />
    </div>
  );
}

// A choice drawn as a card with its effect written on it: one radio of a group.
export function ChoiceCard({ selected, onSelect, title, description, icon: Icon, name }) {
  return (
    <label className={`relative flex cursor-pointer flex-col gap-1 rounded-card border p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40 ${selected ? 'border-accent/45 bg-accent/[0.06]' : 'border-border-subtle bg-surface-inset hover:border-border-default'}`}>
      <input type="radio" name={name} checked={selected} onChange={onSelect} className="sr-only" />
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-accent' : 'border-border-strong'}`}>
          {selected && <span className="h-2 w-2 rounded-full bg-accent" />}
        </span>
        {Icon && <Icon aria-hidden="true" className="h-4 w-4 text-text-muted" />}
        <span className="text-[0.8125rem] font-semibold text-text-primary">{title}</span>
      </span>
      {description && <span className="pl-6 text-xs leading-relaxed text-text-muted">{description}</span>}
    </label>
  );
}

// A thin progress track; the colour is the caller's (a resource colour, or the accent meter).
export function Track({ percent, color, className = 'h-1.5', label, min = 0, max = 100, value }) {
  const width = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className={`overflow-hidden rounded-full bg-surface-hover/80 ${className}`} role={label ? 'progressbar' : undefined} aria-label={label} aria-valuemin={label ? min : undefined} aria-valuemax={label ? max : undefined} aria-valuenow={label ? value : undefined}>
      <div className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${width}%`, backgroundColor: color }} />
    </div>
  );
}

export function formatNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-US') : String(value ?? '');
}

export function formatSigned(value) {
  const number = Number(value) || 0;
  const rounded = Math.round(number * 100) / 100;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${formatNumber(Math.abs(rounded))}`;
}

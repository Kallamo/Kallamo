import React from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, FileType } from 'lucide-react';
import Button from './ui/Button';
import Toggle from './ui/Toggle';
import SegmentedControl from './ui/SegmentedControl';
import NumberInput from './ui/NumberInput';

const FORMATS = [
  { value: 'pdf', label: 'PDF', icon: FileText, description: 'Fixed pages, ready to print or share.' },
  { value: 'docx', label: 'Word', icon: FileType, description: 'A .docx you can keep editing.' },
];

export const formatLabel = (format) => (format === 'docx' ? 'Word' : 'PDF');

export function FormatChoice({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Format" className="grid grid-cols-2 gap-2">
      {FORMATS.map(f => {
        const on = value === f.value;
        return (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(f.value)}
            className={`flex flex-col gap-1.5 rounded-card border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? 'border-accent/60 bg-accent/[0.07]' : 'border-border-subtle bg-white/[0.025] hover:border-border-default'}`}
          >
            <span className="flex items-center gap-2 text-sm font-bold text-text-primary"><f.icon className="h-4 w-4" aria-hidden="true" />{f.label}</span>
            <span className="text-xs leading-snug text-text-muted">{f.description}</span>
          </button>
        );
      })}
    </div>
  );
}

export function OptionGroup({ title, trailing, children, last = false }) {
  return (
    <section className={`flex flex-col gap-3 ${last ? '' : 'border-b border-border-subtle pb-5'}`}>
      {(title || trailing) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-bold text-text-primary">{title}</h3>}
          {trailing}
        </div>
      )}
      {children}
    </section>
  );
}

export function ToggleRow({ label, checked, onChange, disabled = false, bold = false }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className={`text-sm ${bold ? 'font-bold text-text-primary' : 'text-text-secondary'}`}>{label}</span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function PageNumberOptions({ enabled, onEnabled, position, onPosition, format, start, onStart }) {
  return (
    <>
      <ToggleRow label="Page numbers" checked={enabled} onChange={onEnabled} bold />
      {enabled && (
        <>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-text-subtle">Position</span>
            <SegmentedControl label="Page number position" value={position} onChange={onPosition} className="w-full [&>button]:flex-1 [&>button]:justify-center"
              options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
          </div>
          {format === 'docx' ? (
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-subtle">Start at page</span>
              <NumberInput
                min={1}
                value={start}
                onChange={onStart}
                className="h-9 w-24 rounded-control border border-border-default bg-surface-input px-2.5 text-sm tabular-nums text-text-primary focus:border-accent/70 focus:outline-none"
              />
            </label>
          ) : <p className="text-xs text-text-subtle">Word also lets you choose the first page number.</p>}
        </>
      )}
    </>
  );
}

export function PageNav({ index, total, onChange }) {
  if (total <= 1) return null;
  const nav = 'inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-white/[0.07] disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  return (
    <div className="mt-4 flex items-center gap-3">
      <button type="button" aria-label="Previous page" disabled={index === 0} onClick={() => onChange(index - 1)} className={nav}><ChevronLeft className="h-4 w-4" /></button>
      <span className="text-xs font-semibold tabular-nums text-text-secondary">Page {index + 1} of {total}</span>
      <button type="button" aria-label="Next page" disabled={index === total - 1} onClick={() => onChange(index + 1)} className={nav}><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

export function ExportFooter({ format, exporting, disabled, onCancel, onExport }) {
  return (
    <div className="flex gap-2 border-t border-border-subtle px-5 py-3.5">
      <Button variant="ghost" onClick={onCancel} className="flex-1">Cancel</Button>
      <Button variant="primary" icon={Download} onClick={onExport} disabled={disabled || exporting} loading={exporting} className="flex-1">
        {exporting ? 'Exporting…' : `Export ${formatLabel(format)}`}
      </Button>
    </div>
  );
}

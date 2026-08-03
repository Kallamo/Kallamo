import { useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import ColorPicker from './ColorPicker';
import Popover from './Popover';

const SWATCHES = ['#dc2626', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

export default function ColorField({ value, onChange, ariaLabel = 'Choose color', className = '' }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);

  const pickFromScreen = async () => {
    if (!window.EyeDropper) return;
    try {
      const result = await new window.EyeDropper().open();
      if (result?.sRGBHex) onChange(result.sRGBHex);
    } catch (_) { }
  };

  return (
    <div ref={anchorRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg border bg-surface-input px-2.5 text-left text-sm text-text-secondary transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open ? 'border-accent/60' : 'border-border-default'}`}
      >
        <span className="h-6 w-8 shrink-0 rounded-md border border-white/15 shadow-inner" style={{ backgroundColor: value }} />
        <span className="font-mono text-xs uppercase text-text-muted">{value}</span>
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} scroll={false} className="w-64 border-border-default bg-surface-panel-muted p-3 shadow-black/60">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-text-primary">Custom color</span>
          {window.EyeDropper && (
            <button type="button" onClick={pickFromScreen} className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-text-muted hover:bg-white/[0.06] hover:text-text-primary">
              <Pipette className="h-3.5 w-3.5" />Pick from screen
            </button>
          )}
        </div>
        <ColorPicker value={value} onChange={onChange} />
        <div className="mt-3 grid grid-cols-8 gap-1.5 border-t border-border-subtle pt-3">
          {SWATCHES.map(color => (
            <button
              key={color}
              type="button"
              aria-label={`Use ${color}`}
              onClick={() => onChange(color)}
              className={`h-5 rounded-md border transition-transform hover:scale-110 ${color.toLowerCase() === value?.toLowerCase() ? 'border-accent ring-1 ring-accent/50' : 'border-white/15'}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </Popover>
    </div>
  );
}

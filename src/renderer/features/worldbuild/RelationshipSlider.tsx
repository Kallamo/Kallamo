import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

export function clampFeeling(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-100, Math.min(100, Math.round(number))) : 0;
}

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;

// A feeling from -100 to +100, filled from the neutral middle toward the value.
export default function RelationshipSlider({ value, onChange, label, ends = true }: {
  value: number; onChange(value: number): void; label: string; ends?: boolean;
}) {
  const current = clampFeeling(value);
  const [draft, setDraft] = useState(signed(current));
  useEffect(() => setDraft(signed(current)), [current]);
  const commit = () => {
    if (/^[+-]?\d{1,3}$/.test(draft)) onChange(clampFeeling(draft));
    else setDraft(signed(current));
  };
  const fill = {
    '--rel-lo': `${current < 0 ? 50 + current / 2 : 50}%`,
    '--rel-hi': `${current > 0 ? 50 + current / 2 : 50}%`,
    '--rel-fill': current >= 0 ? 'var(--theme-status-success)' : 'var(--theme-status-danger)',
  } as CSSProperties;
  return (
    <div className="flex items-center gap-3">
      {ends && <span className="shrink-0 text-xs text-text-subtle">Hostile</span>}
      <input type="range" min="-100" max="100" step="1" value={current} aria-label={label}
        onChange={event => onChange(clampFeeling(event.target.value))} className="relationship-range min-w-0 flex-1" style={fill} />
      {ends && <span className="shrink-0 text-xs text-text-subtle">Close</span>}
      <input type="text" inputMode="numeric" value={draft} aria-label={`${label}, as a number`}
        onChange={event => { if (/^[+-]?\d{0,3}$/.test(event.target.value)) setDraft(event.target.value); }}
        onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        className="wb-input h-10 w-16 shrink-0 rounded-control border border-border-default bg-surface-input px-2 text-center text-sm tabular-nums text-text-primary focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20" />
    </div>
  );
}

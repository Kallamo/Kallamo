import React from 'react';
import { Loader2 } from 'lucide-react';

const TONES = {
  idle: 'bg-surface-hover',
  pending: 'bg-status-warning',
  ok: 'bg-status-success',
  error: 'bg-status-danger',
};

/** Small state marker. `running` swaps the dot for a spinner of the same footprint. */
export default function StatusDot({ tone = 'idle', className = '' }) {
  if (tone === 'running') {
    return <Loader2 className={`h-3 w-3 shrink-0 animate-spin text-accent ${className}`} aria-hidden="true" />;
  }
  return <span className={`h-[0.4375rem] w-[0.4375rem] shrink-0 rounded-full ${TONES[tone] || TONES.idle} ${className}`} aria-hidden="true" />;
}

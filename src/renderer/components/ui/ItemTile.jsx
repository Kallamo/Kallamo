import React from 'react';

// Tailwind only ships classes it can read in full, so every tone spells its classes out.
const TONES = {
  always: 'bg-mode-always/12 text-mode-always',
  searchable: 'bg-mode-searchable/12 text-mode-searchable',
  history: 'bg-mode-history/12 text-mode-history',
  neutral: 'bg-tint/5 text-text-muted',
};

/** Square icon holder that carries an item's mode colour. */
export default function ItemTile({ icon: Icon, tone = 'neutral', size = 'md', className = '' }) {
  const box = size === 'lg' ? 'h-9 w-9 rounded-control' : 'h-8 w-8 rounded-lg';
  return (
    <span className={`flex shrink-0 items-center justify-center ${box} ${TONES[tone] || TONES.neutral} ${className}`} aria-hidden="true">
      {Icon && <Icon className="h-4 w-4" />}
    </span>
  );
}

export const MODE_TEXT = {
  always: 'text-mode-always',
  searchable: 'text-mode-searchable',
  history: 'text-mode-history',
};

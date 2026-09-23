import React, { forwardRef } from 'react';

// Kallamo's own glyphs for product concepts. Same props as a lucide icon, so they drop into any `icon={...}` slot.
// `animated` runs the glyph's motion (see .kg-animated in index.css); it is off by default.
const makeGlyph = (name, body) => {
  const Glyph = forwardRef(({ size = 24, strokeWidth = 2, className = '', animated = false, title, ...rest }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`kg kg-${name}${animated ? ' kg-animated' : ''} ${className}`}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      {body}
    </svg>
  ));
  Glyph.displayName = `Glyph(${name})`;
  return Glyph;
};

const Dot = ({ cx, cy, r, className }) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" className={className} />;

const spark = (cx, cy, r, className) => {
  const k = +(r * 0.14).toFixed(2);
  return (
    <path
      className={className}
      fill="currentColor"
      stroke="none"
      d={`M${cx} ${cy - r}C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy}C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r}C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy}C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r}Z`}
    />
  );
};

const LockBody = () => <path d="M6.5 11H17.5C18.9 11 20 12.1 20 13.5V18.5C20 19.9 18.9 21 17.5 21H6.5C5.1 21 4 19.9 4 18.5V13.5C4 12.1 5.1 11 6.5 11Z" />;
const Shackle = () => <path d="M7.5 11V7.5C7.5 5 9.5 3 12 3C14.5 3 16.5 5 16.5 7.5V11" />;
const NoteSheet = () => (
  <>
    <path d="M6.5 3H14.2C14.7 3 15.2 3.2 15.6 3.6L19.4 7.4C19.8 7.8 20 8.3 20 8.8V18.5C20 19.9 18.9 21 17.5 21H6.5C5.1 21 4 19.9 4 18.5V5.5C4 4.1 5.1 3 6.5 3Z" />
    <path d="M14 3V7C14 7.6 14.4 8 15 8H20" />
  </>
);

export const AiGlyph = makeGlyph('ai', (
  <>
    <path className="kg-main" d="M10 3.5C10.7 9 12.6 11.6 17.5 12.8C12.6 14 10.7 16.6 10 22C9.3 16.6 7.4 14 2.5 12.8C7.4 11.6 9.3 9 10 3.5Z" />
    <path className="kg-core" fill="currentColor" stroke="none" d="M10 10.8C10.2 12 10.8 12.6 12 12.8C10.8 13 10.2 13.6 10 14.8C9.8 13.6 9.2 13 8 12.8C9.2 12.6 9.8 12 10 10.8Z" />
    <path className="kg-spark" fill="currentColor" stroke="none" d="M18.5 1.8C18.8 4.1 19.7 5 22 5.3C19.7 5.6 18.8 6.5 18.5 8.8C18.2 6.5 17.3 5.6 15 5.3C17.3 5 18.2 4.1 18.5 1.8Z" />
    <Dot cx={19.8} cy={18.2} r={1.4} className="kg-spark kg-spark-late" />
  </>
));

export const WorkspaceGlyph = makeGlyph('workspace', (
  <path d="M12 4C17 4 20.6 6.9 20.6 10.6C20.6 14.3 17 17.2 12 17.2C11 17.2 10 17.1 9.1 16.8C7.8 18.3 6 19.3 4 19.6C5 18.4 5.6 17.2 5.7 15.8C4.2 14.5 3.4 12.6 3.4 10.6C3.4 6.9 7 4 12 4Z" />
));

export const WritingGlyph = makeGlyph('writing', (
  <>
    <path d="M20.5 3.5C13.2 3.5 7.4 8.6 6.6 15.6L6.4 17.6L8.4 17.4C15.4 16.6 20.5 10.8 20.5 3.5Z" />
    <path d="M3.5 20.5L13.5 10.5" />
  </>
));

export const WorldbuildGlyph = makeGlyph('worldbuild', (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3C9.4 5.6 8.2 8.6 8.2 12C8.2 15.4 9.4 18.4 12 21" />
    <path d="M12 3C14.6 5.6 15.8 8.6 15.8 12C15.8 15.4 14.6 18.4 12 21" />
    <path d="M3.4 12.8C8.8 11.4 15.2 11.4 20.6 12.8" />
  </>
));

export const MemoryGlyph = makeGlyph('memory', (
  <>
    <path d="M8.5 3H15.5" />
    <path d="M6 6.5H18" />
    <path d="M6.5 10H17.5C18.9 10 20 11.1 20 12.5V18.5C20 19.9 18.9 21 17.5 21H6.5C5.1 21 4 19.9 4 18.5V12.5C4 11.1 5.1 10 6.5 10Z" />
    <path d="M14 10V15L15.75 13.8L17.5 15V10" />
  </>
));

export const KnowledgeGlyph = makeGlyph('knowledge', (
  <>
    <path d="M2.5 12.8C5.5 7.4 8.8 5 12.2 5C15.6 5 18.9 7.3 21.5 11.5" />
    <path d="M5.6 16.2C7.9 18.3 10 19.1 12.3 19.1C14.6 19.1 16.7 18.3 18.8 16.6" />
    <circle cx="12.2" cy="12.2" r="3.4" />
    <Dot cx={12.2} cy={12.2} r={1.2} />
  </>
));

export const ConnectionsGlyph = makeGlyph('connections', (
  <>
    <circle cx="5.8" cy="17.8" r="2.8" />
    <circle cx="18.2" cy="6.2" r="2.8" />
    <path d="M8.3 16.4C11 14.8 11.3 12.3 12.7 10.6C13.6 9.5 14.6 8.6 15.7 8" />
    <Dot cx={18.2} cy={17.8} r={1.6} />
  </>
));

export const OccurrencesGlyph = makeGlyph('occurrences', (
  <>
    <path d="M3 19C8.4 18.4 15.6 18.4 21 19" />
    <path d="M6 18.6V13" />
    <path d="M12 18.4V8.5" />
    <path d="M18 18.6V14.8" />
    <Dot cx={6} cy={11} r={1.8} />
    <Dot cx={12} cy={6} r={1.8} />
    <Dot cx={18} cy={12.4} r={1.8} />
  </>
));

export const PolicyOpenGlyph = makeGlyph('policy-open', (
  <>
    <LockBody />
    <path d="M7.5 11V7.5C7.5 5 9.5 3 12 3C13.9 3 15.5 4.2 16.2 5.8" />
    <path d="M12 14.5V17.5" />
  </>
));

export const PolicyReviewGlyph = makeGlyph('policy-review', (
  <>
    <LockBody />
    <Shackle />
    <Dot cx={8.4} cy={16} r={1.2} />
    <Dot cx={12} cy={16} r={1.2} />
    <Dot cx={15.6} cy={16} r={1.2} />
  </>
));

export const PolicyLockedGlyph = makeGlyph('policy-locked', (
  <>
    <LockBody />
    <Shackle />
    <circle cx="12" cy="15" r="1.3" />
    <path d="M12 16.3V18" />
  </>
));

export const SuggestionPendingGlyph = makeGlyph('suggestion-pending', (
  <>
    <path d="M3.5 5.5H16" />
    <path d="M3.5 10.5H12" />
    <path d="M3.5 15.5H9.5" strokeDasharray="2.2 2.8" />
    {spark(17.5, 16.5, 4.5, 'kg-spark')}
  </>
));

export const NoteGlyph = makeGlyph('note', (
  <>
    <NoteSheet />
    <path d="M8 13H16" />
    <path d="M8 17H12.5" />
  </>
));

export const AiNoteGlyph = makeGlyph('note-ai', (
  <>
    <NoteSheet />
    <path d="M8 13H11" />
    {spark(13.5, 16.2, 3.2, 'kg-spark')}
  </>
));

export const IndexNeverGlyph = makeGlyph('index-never', (
  <circle cx="12" cy="12" r="9" strokeDasharray="2.4 3.2" />
));

export const IndexingGlyph = makeGlyph('index-indexing', (
  <>
    <path className="kg-orbit" d="M12 3C17 3 21 7 21 12C21 17 17 21 12 21C8.7 21 5.8 19.2 4.2 16.5" />
    <Dot cx={12} cy={12} r={2} className="kg-core" />
  </>
));

export const IndexedGlyph = makeGlyph('index-indexed', (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.3C9.2 13.3 10 14.2 10.7 15.4C12.3 12.2 14.1 10 16.3 8.4" />
  </>
));

export const IndexOutdatedGlyph = makeGlyph('index-outdated', (
  <>
    <path d="M20 9C18.8 5.5 15.6 3 12 3C8.2 3 5 5.4 3.8 8.8" />
    <path d="M20.2 4.5V9H15.7" />
    <path d="M4 15C5.2 18.5 8.4 21 12 21C15.8 21 19 18.6 20.2 15.2" />
    <path d="M3.8 19.5V15H8.3" />
  </>
));

export const IndexErrorGlyph = makeGlyph('index-error', (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12.5" />
    <Dot cx={12} cy={16.2} r={1.3} />
  </>
));

// Text colour: the baseline carries the colour the selection currently has.
export const TextColorGlyph = forwardRef(({ size = 24, strokeWidth = 2, color: swatch, className = '', ...rest }, ref) => (
  <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`kg kg-text-color ${className}`} aria-hidden="true" {...rest}>
    <path d="M6 16L12 4L18 16" />
    <path d="M8 12H16" />
    <path d="M4 20H20" stroke={swatch || 'currentColor'} strokeWidth={strokeWidth + 0.5} />
  </svg>
));
TextColorGlyph.displayName = 'Glyph(text-color)';

// Adapted from Tabler Icons (MIT, Copyright (c) 2020-2024 Paweł Kuna), drawn on the same grid and stroke as Lucide.
export const DragonIcon = makeGlyph('dragon', (
  <>
    <path d="M10.706 8.849l-5.706 -3.301l-2 6.452l3.5 -1.973l.5 2.973l3.555 -1.385" />
    <path d="M15 9c0 3.5 4 3 4 7c0 3 -3 5 -5.5 5s-6 -.5 -6.5 -5c2 2 6.592 3.043 7.5 1c1.094 -2.461 -4 -3.459 -4 -6.5c0 -2.062 .5 -2.5 1.8 -3.2" />
    <path d="M18 6a3 3 270 1 0 -3 3h5l1 -3h-3" />
    <path d="M15 3h-8l5 3" />
  </>
));

export const PennantIcon = makeGlyph('pennant', (
  <path d="M5 14h14l-4.5 -4.5l4.5 -4.5h-14v16" />
));

export const MoneybagIcon = makeGlyph('moneybag', (
  <>
    <path d="M9.5 3h5a1.5 1.5 0 0 1 1.5 1.5a3.5 3.5 0 0 1 -3.5 3.5h-1a3.5 3.5 0 0 1 -3.5 -3.5a1.5 1.5 0 0 1 1.5 -1.5" />
    <path d="M4 17v-1a8 8 0 1 1 16 0v1a4 4 0 0 1 -4 4h-8a4 4 0 0 1 -4 -4" />
  </>
));

export const StopwatchIcon = makeGlyph('stopwatch', (
  <>
    <path d="M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0" />
    <path d="M14.5 10.5l-2.5 2.5" />
    <path d="M17 8l1 -1" />
    <path d="M14 3h-4" />
  </>
));

export const StoreIcon = makeGlyph('store', (
  <>
    <path d="M3 21l18 0" />
    <path d="M3 7v1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1h-18l2 -4h14l2 4" />
    <path d="M5 21l0 -10.15" />
    <path d="M19 21l0 -10.15" />
    <path d="M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4" />
  </>
));


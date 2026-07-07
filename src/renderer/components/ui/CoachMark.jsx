import React from 'react';
import { Sparkles } from 'lucide-react';
import Popover from './Popover';

// One-time coach-mark: a small dismissible callout anchored to an element.
// Presentational only. The caller gates `open` on a persisted UI flag (see
// uiFlags / dismissHint in AppContext) and calls onDismiss to record it as seen.
export default function CoachMark({ anchorRef, open, onDismiss, title, children, align = 'left' }) {
  if (!open) return null;
  return (
    <Popover
      anchorRef={anchorRef}
      open={open}
      onClose={onDismiss}
      matchAnchorWidth={false}
      align={align}
      scroll={false}
      className="w-64 !p-3 border border-accent/40"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1.5">
          {title && <span className="text-xs font-bold text-white">{title}</span>}
          <p className="text-[0.6875rem] leading-relaxed text-gray-300">{children}</p>
          <button
            type="button"
            onClick={onDismiss}
            className="self-start mt-1 text-[0.6875rem] font-semibold text-accent hover:brightness-110 cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </Popover>
  );
}

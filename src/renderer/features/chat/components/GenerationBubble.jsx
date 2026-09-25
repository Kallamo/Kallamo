import { useLayoutEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useStreamingText } from '../../../context/AppContext';
import { SpeakerLabel } from './ChatMessageItem';

// Work in progress is an active state, so the phase and the caret take the accent.
// Runner statuses arrive as "Searching Context..."; the label reads them as a quiet phase.
function phaseLabel(status) {
  const text = String(status || 'Thinking').replace(/\.{3}|…/g, '').trim();
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

// Reads the streamed text itself, so each stream tick re-renders this bubble only.
export default function GenerationBubble({ progress, color, style, sizeClass = 'text-sm', onTextChange }) {
  const { content: streamingContent, reasoning: streamingReasoning } = useStreamingText();
  useLayoutEffect(() => {
    onTextChange?.();
  }, [streamingContent, streamingReasoning, onTextChange]);
  const steps = progress.totalSteps > 1 ? ` · step ${progress.step || 1} of ${progress.totalSteps}` : '';
  return (
    <div className="flex w-full flex-col items-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300" aria-live="polite">
      <SpeakerLabel name={progress.profileName} color={color}>
        <span className="inline-flex items-center gap-1.5 font-medium text-accent">
          <span aria-hidden="true" className="text-text-disabled">·</span>
          <span className="inline-flex animate-spin motion-reduce:animate-none"><Loader2 aria-hidden="true" className="h-3.5 w-3.5" /></span>
          {phaseLabel(progress.status)}{steps}
        </span>
      </SpeakerLabel>
      {(streamingContent || streamingReasoning) && (
        <div style={style} className={`max-w-[86%] rounded-surface border px-4.5 py-4 text-text-secondary shadow-sm ${sizeClass}`}>
          {streamingReasoning && (
            <div className="mb-3 max-h-48 overflow-y-auto border-b border-white/[0.07] pb-3 text-xs italic text-text-muted whitespace-pre-wrap custom-scrollbar">
              {streamingReasoning}
            </div>
          )}
          {streamingContent && (
            <div className="whitespace-pre-wrap leading-relaxed">
              {streamingContent}
              <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-1.5 -mb-0.5 rounded-sm bg-accent/80 animate-pulse" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

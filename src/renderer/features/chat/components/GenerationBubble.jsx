import { useLayoutEffect } from 'react';
import { Brain, RotateCw } from 'lucide-react';
import { useStreamingText } from '../../../context/AppContext';

// Reads the streamed text itself, so each stream tick re-renders this bubble only.
export default function GenerationBubble({ progress, style, onTextChange }) {
  const { content: streamingContent, reasoning: streamingReasoning } = useStreamingText();
  useLayoutEffect(() => {
    onTextChange?.();
  }, [streamingContent, streamingReasoning, onTextChange]);
  return (
    <div
      style={style}
      className="flex flex-col w-full items-start rounded-2xl p-4 relative overflow-hidden select-none animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <div className="flex flex-col space-y-1.5 w-full pl-4">
        {/* Left accent color bar with custom glow and curved caps */}
        <div
          className="absolute top-0 left-0 bottom-0 w-1 bg-accent rounded-r-md animate-pulse shadow-[0_0_8px_#FBCB2D]"
        />

        {/* Top Right Floating Brain Icon for high-end feel */}
        <div className="absolute top-4 right-4 text-accent/20">
          <Brain className="w-5 h-5 animate-pulse" />
        </div>

        {/* Header info */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-[0.625rem] font-extrabold uppercase tracking-widest text-[#ddba6e] drop-shadow">
              [{progress.step || 1}/{progress.totalSteps || 1}] {progress.profileName || 'Thinking'}
            </span>
          </div>
        </div>

        {(streamingContent || streamingReasoning) ? (
          <div className="flex flex-col space-y-2 pt-1 w-full">
            {streamingReasoning && (
              <div className="text-xs italic text-gray-500 whitespace-pre-wrap border-l border-accent/20 pl-2.5 max-h-48 overflow-y-auto custom-scrollbar">
                {streamingReasoning}
              </div>
            )}
            {streamingContent && (
              <div className="relative">
                <div className="whitespace-pre-wrap leading-relaxed">{streamingContent}</div>
                <span className="inline-block w-1.5 h-4 -mb-0.5 bg-accent/70 animate-pulse rounded-sm" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center space-x-2.5 pt-0.5">
            <RotateCw className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
            <span className="text-xs font-semibold text-accent animate-pulse tracking-wide">
              {progress.status || 'Thinking...'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

import React from 'react';
import Logo, { Logotype } from '../../logo';

// Covers the first data load, so the home never flashes as an empty library.
export default function LaunchScreen() {
  return (
    <div
      role="status"
      aria-label="Opening Kallamo"
      className="flex h-full w-full flex-col items-center justify-center gap-[1.625rem] pb-10 bg-surface-canvas bg-[radial-gradient(42rem_30rem_at_50%_46%,color-mix(in_srgb,var(--app-accent)_9%,transparent),transparent_70%)]"
    >
      <Logo size={84} shimmer compact={false} fluteColor="currentColor" className="logo-launch text-text-primary" />
      <Logotype height={40} className="text-text-primary animate-[rise-in_0.5s_ease-out_1.1s_both]" />
      {/* Only after a beat: a quick launch should not flash a line of text. */}
      <span className="caption mt-3.5 text-[0.8125rem] animate-[fade-in_0.4s_ease-out_1.4s_both]">Opening your workspaces</span>
    </div>
  );
}

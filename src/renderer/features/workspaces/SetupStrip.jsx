import React from 'react';
import { Check, Lightbulb, Plug } from 'lucide-react';

// Shown until an AI profile first can reply, then never again; each step opens where it gets done.
export default function SetupStrip({ hasConnection, onOpenSettings, onOpenLibrary, onGuide, hasWorkspace }) {
  const steps = [
    { title: 'Add a connection', text: 'In Settings, under Connections. Any provider, or a local model.', action: 'Open Settings', onClick: onOpenSettings, done: hasConnection },
    { title: 'Link it to a profile', text: 'Pick the connection and a model in the profile. The example profiles only need that.', action: 'Open Library', onClick: onOpenLibrary, done: false },
    { title: hasWorkspace ? 'Open a workspace' : 'Create a workspace', text: 'Then write, chat or build the world with the AI.', action: null, done: false },
  ];
  const current = steps.findIndex(step => !step.done);

  return (
    <section className="flex shrink-0 flex-col gap-3.5 rounded-[1.125rem] border border-status-warning/22 bg-surface-panel/70 px-5 py-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-2.5">
        <Plug className="h-4 w-4 text-status-warning" aria-hidden="true" />
        <h2 className="text-sm font-bold text-text-primary">Connect a model so the AI can write</h2>
        <span className="caption">The profiles can't reply until one is linked. This goes away once one works.</span>
        <span className="flex-1" />
        {onGuide && (
          <button
            type="button"
            onClick={onGuide}
            className="inline-flex h-[1.875rem] items-center gap-1.5 rounded-lg bg-accent/90 px-3 text-xs font-semibold text-on-accent shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
            Guide me step by step
          </button>
        )}
      </div>
      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-[0.875rem] border border-border-subtle bg-tint/[0.025] p-4">
            <span
              className={`inline-flex h-[1.625rem] w-[1.625rem] shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-bold tabular-nums ${
                step.done ? 'border-status-success text-status-success' : index === current ? 'border-accent text-accent' : 'border-tint/20 text-text-muted'
              }`}
            >
              {step.done ? <Check className="h-3.5 w-3.5" aria-label="Done" /> : index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-semibold text-text-primary">{step.title}</span>
              <span className="caption">{step.text}</span>
              {step.action && !step.done && (
                <button
                  type="button"
                  onClick={step.onClick}
                  className="mt-1 inline-flex h-[1.875rem] self-start items-center rounded-lg border border-border-default bg-tint/[0.04] px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {step.action}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

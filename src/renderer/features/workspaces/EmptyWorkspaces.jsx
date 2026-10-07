import React from 'react';
import { MessageSquare, Plug, Plus } from 'lucide-react';
import Logo from '../../logo';
import { MemoryGlyph, WorldbuildGlyph, WritingGlyph } from '../../components/ui/glyphs';
import ContourCover from './ContourCover';

const PARTS = [
  [MessageSquare, 'Chat', 'Talk with your AI profiles, or play the story as roleplay.'],
  [WorldbuildGlyph, 'Worldbuild', 'Characters, places and factions the AI keeps straight.'],
  [MemoryGlyph, 'Memory', 'Notes, files and lore it can look up while it writes.'],
  [WritingGlyph, 'Writing Desk', 'Chapters you write, with the AI one selection away.'],
];

export function EmptyBackdrop() {
  return (
    <>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-90">
        <ContourCover title="Kallamo" lines={13} width={1440} height={900} dim />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_48%,color-mix(in_srgb,var(--theme-surface-canvas)_55%,transparent),color-mix(in_srgb,var(--theme-surface-canvas)_92%,transparent)_75%)]" />
    </>
  );
}

export default function EmptyWorkspaces({ onCreate, needsModel, onOpenSettings }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 pb-14 text-center">
      <Logo size={92} />
      <span className="text-xs font-semibold text-text-secondary">Welcome to Kallamo</span>
      <h2 className="text-[2.875rem] font-extrabold leading-[1.08] tracking-[-0.025em] text-text-primary">Start your first story</h2>
      <p className="max-w-[35rem] text-base leading-relaxed text-text-muted">
        A workspace keeps one story together: the conversation, its world, what the AI remembers and the chapters you write.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-1 inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-on-accent shadow-sm transition-[filter,transform] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New workspace
      </button>
      <ul className="mt-6 grid w-full max-w-[61rem] grid-cols-2 gap-3.5 text-left lg:grid-cols-4">
        {PARTS.map(([Icon, title, text]) => (
          <li key={title} className="flex flex-col gap-2.5 rounded-2xl border border-border-subtle bg-surface-panel/60 p-4.5 backdrop-blur-xl">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-[0.6875rem] border border-border-default bg-tint/[0.05] text-text-secondary">
              <Icon size={18} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-text-primary">{title}</span>
            <span className="caption">{text}</span>
          </li>
        ))}
      </ul>
      {needsModel && (
        <div className="mt-2 inline-flex items-center gap-2.5 rounded-xl border border-status-setup/25 bg-surface-panel/70 py-2.5 pl-4 pr-2 text-sm text-text-secondary backdrop-blur-xl">
          <Plug className="h-4 w-4 text-status-setup" aria-hidden="true" />
          No model connected yet. Add an API key so the AI can reply.
          <button type="button" onClick={onOpenSettings} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-status-setup transition-colors hover:bg-tint/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            Open Settings
          </button>
        </div>
      )}
    </div>
  );
}

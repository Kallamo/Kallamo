import { useRef, useState } from 'react';
import { Check, Drama, SlidersHorizontal } from 'lucide-react';
import Popover from '../../../components/ui/Popover';
import Toggle from '../../../components/ui/Toggle';
import { MenuItem, MenuLabel, MenuSeparator } from '../../../components/ui/Menu';
import { WorkspaceGlyph, WorldbuildGlyph } from '../../../components/ui/glyphs';

function ReadsRow({ icon: Icon, iconClassName = 'text-text-muted', title, description, children }) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-2.5 py-2">
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${iconClassName}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-primary">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-text-muted">{description}</span>
      </span>
      {children}
    </div>
  );
}

/** In the Chat of a roleplay workspace: what this conversation reads, and the switch for the story's history. */
export default function RoleplayHistoryChip({ enabled, share, onToggle, onOpenSettings }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border px-2.5 text-[0.8125rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open ? 'border-border-strong bg-tint/[0.07] text-text-primary' : enabled ? 'border-border-default bg-tint/[0.03] text-text-secondary hover:text-text-primary' : 'border-dashed border-border-default text-text-muted hover:text-text-primary'}`}
      >
        <Drama aria-hidden="true" className={`h-3.5 w-3.5 ${enabled ? 'text-roleplay' : 'text-text-subtle'}`} />
        Reads the roleplay
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} scroll={false} className="w-[22rem] !p-1.5">
        <div role="dialog" aria-label="What this chat reads" className="flex flex-col">
          <MenuLabel>This chat reads</MenuLabel>
          <ReadsRow
            icon={Drama}
            iconClassName="text-roleplay"
            title="Roleplay history"
            description={enabled ? `Recent turns and summaries, up to ${share}% of the history room.` : 'Off. The chat does not see what happened in the story.'}
          >
            <span className="mt-0.5"><Toggle checked={enabled} onChange={onToggle} ariaLabel="Roleplay history" /></span>
          </ReadsRow>
          <ReadsRow icon={WorldbuildGlyph} title="Worldbuild and the current scene" description="Always. Sheets, place, time and who is present.">
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" />
          </ReadsRow>
          <ReadsRow icon={WorkspaceGlyph} title="This chat's own messages" description="Its own history and summaries.">
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" />
          </ReadsRow>
          <p className="mx-2.5 mb-1.5 mt-1 rounded-lg bg-tint/[0.03] px-2.5 py-2 text-xs leading-snug text-text-muted">
            The Chat never changes the Narrative State: no turns, time, resources or scene changes.
          </p>
          <MenuSeparator />
          <MenuItem icon={SlidersHorizontal} label="Change the split in Configuration" onSelect={() => { setOpen(false); onOpenSettings(); }} />
        </div>
      </Popover>
    </>
  );
}

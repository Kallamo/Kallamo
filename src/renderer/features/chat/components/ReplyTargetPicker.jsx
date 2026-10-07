import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal, Workflow } from 'lucide-react';
import { Menu, MenuItem, MenuLabel, MenuNote, MenuSeparator } from '../../../components/ui/Menu';

const Dot = ({ color, dim = false }) => (
  <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dim ? 'opacity-50' : ''}`} style={{ backgroundColor: color || 'var(--theme-text-subtle)' }} />
);

/** Chooses which AI profile or workflow answers the next message. */
export default function ReplyTargetPicker({ profiles, workflows, selectedId, onSelect, onManage }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const selected = profiles.find(profile => profile.id === selectedId) || workflows.find(workflow => workflow.id === selectedId);
  const selectedIsWorkflow = workflows.some(workflow => workflow.id === selectedId);
  const choose = id => () => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Reply with ${selected?.name || 'no profile chosen'}`}
        onClick={() => setOpen(value => !value)}
        className={`inline-flex h-8 max-w-[14rem] items-center gap-2 rounded-control border px-2.5 text-[0.8125rem] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open ? 'border-border-strong bg-tint/[0.07] text-text-primary' : 'border-border-default bg-tint/[0.03] text-text-secondary hover:text-text-primary'}`}
      >
        {selectedIsWorkflow
          ? <Workflow aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          : <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: selected?.color || 'var(--theme-text-subtle)' }} />}
        <span className="truncate">{selected?.name || 'Choose a profile'}</span>
        {open ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-muted" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
      </button>
      <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Reply with" className="w-80">
        <MenuLabel>Profiles</MenuLabel>
        {profiles.length ? profiles.map(profile => (
          <MenuItem
            key={profile.id}
            icon={() => <Dot color={profile.color} dim={profile.needsSetup} />}
            label={profile.name}
            description={profile.needsSetup ? 'Needs an API profile before it can reply.' : undefined}
            checked={profile.id === selectedId}
            onSelect={choose(profile.id)}
          />
        )) : <MenuNote>No profiles in this workspace.</MenuNote>}
        <MenuSeparator />
        <MenuLabel>Workflows</MenuLabel>
        {workflows.length ? workflows.map(workflow => (
          <MenuItem
            key={workflow.id}
            icon={Workflow}
            label={workflow.name}
            checked={workflow.id === selectedId}
            onSelect={choose(workflow.id)}
          />
        )) : <MenuNote>No workflows in this workspace.</MenuNote>}
        <MenuSeparator />
        <MenuItem icon={SlidersHorizontal} label="Manage in Configuration" onSelect={() => { setOpen(false); onManage(); }} />
      </Menu>
    </>
  );
}

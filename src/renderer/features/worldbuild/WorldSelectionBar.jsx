import React, { useRef, useState } from 'react';
import { Check, ChevronDown, MoreHorizontal, RefreshCw, Trash2, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import Menu, { MenuItem, MenuLabel, MenuSeparator } from '../../components/ui/Menu';
import { PolicyLockedGlyph } from '../../components/ui/glyphs';

const count = (value) => <span className="text-xs tabular-nums text-text-subtle">{value}</span>;

// Bulk actions for the rows picked in the sidebar. Only what applies to the selection
// shows; the main action leads, the rest wait in a menu with Delete set apart.
export default function WorldSelectionBar({
  count: selectedCount, hiddenCount = 0, proposedCount, updateCount, confirmedCount, busy,
  selectOptions, policyOptions, onClear, onAction,
}) {
  const selectRef = useRef(null);
  const policyRef = useRef(null);
  const moreRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const close = () => setMenu(null);
  const toggle = (name) => setMenu(current => current === name ? null : name);
  const run = (fn) => () => { close(); fn(); };

  const primary = proposedCount > 0
    ? { label: `Keep ${proposedCount} ${proposedCount === 1 ? 'proposal' : 'proposals'}`, action: 'accept-proposed' }
    : updateCount > 0
      ? { label: `Accept ${updateCount === 1 ? 'update' : 'updates'}`, action: 'accept-updates' }
      : null;

  return (
    <div className="m-2.5 shrink-0 rounded-card border border-border-default bg-surface-panel/95 p-2.5 shadow-overlay backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-text-primary">{selectedCount} selected</span>
        {hiddenCount > 0 && <span className="text-xs text-text-subtle">{hiddenCount} hidden by the filter</span>}
        {selectedCount > 0 && <button type="button" onClick={onClear} className="rounded px-1 text-xs font-semibold text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Clear</button>}
        <span className="flex-1" />
        <button ref={selectRef} type="button" aria-haspopup="menu" aria-expanded={menu === 'select'} onClick={() => toggle('select')}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          Select<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {selectedCount > 0 && (
        <div className="mt-2 flex items-center gap-1.5">
          {primary && <Button size="sm" variant="ghost" icon={Check} loading={busy} className="!border-accent/40 !bg-accent/10 !text-accent" onClick={() => onAction(primary.action)}>{primary.label}</Button>}
          <Button ref={policyRef} size="sm" variant="ghost" icon={PolicyLockedGlyph} aria-haspopup="menu" aria-expanded={menu === 'policy'} onClick={() => toggle('policy')}>AI policy<ChevronDown className="h-3 w-3" aria-hidden="true" /></Button>
          <span className="flex-1" />
          <IconButton ref={moreRef} icon={MoreHorizontal} size="sm" label="More actions for the selection" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => toggle('more')} />
        </div>
      )}

      <Menu anchorRef={selectRef} open={menu === 'select'} onClose={close} label="Select" className="w-64" align="right">
        <MenuLabel>Select</MenuLabel>
        {selectOptions.filter(option => option.count > 0).map(option => (
          <MenuItem key={option.key} icon={option.icon} iconClassName={option.tone || 'text-text-muted'} label={option.label} trailing={count(option.count)} onSelect={run(option.onSelect)} />
        ))}
        <MenuSeparator />
        <MenuLabel>By AI policy</MenuLabel>
        {policyOptions.map(option => (
          <MenuItem key={option.key} icon={option.icon} label={option.label} trailing={count(option.count)} disabled={!option.count} onSelect={run(option.onSelectAll)} />
        ))}
      </Menu>
      <Menu anchorRef={policyRef} open={menu === 'policy'} onClose={close} label="Set AI policy" className="w-72">
        <MenuLabel>Set AI policy</MenuLabel>
        {policyOptions.map(option => (
          <MenuItem key={option.key} icon={option.icon} label={option.label} description={option.description} disabled={busy} onSelect={run(option.onApply)} />
        ))}
      </Menu>
      <Menu anchorRef={moreRef} open={menu === 'more'} onClose={close} label="Selection actions" className="w-72">
        {proposedCount > 0 && <MenuItem icon={X} label={`Dismiss ${proposedCount} ${proposedCount === 1 ? 'proposal' : 'proposals'}`} description="Confirmed entities in the selection stay." onSelect={run(() => onAction('reject-proposed'))} />}
        {updateCount > 0 && proposedCount > 0 && <MenuItem icon={Check} label="Accept suggested updates" onSelect={run(() => onAction('accept-updates'))} />}
        {updateCount > 0 && <MenuItem icon={X} label="Reject suggested updates" description="Current values stay as they are." onSelect={run(() => onAction('reject-updates'))} />}
        {confirmedCount > 0 && <MenuItem icon={RefreshCw} label="Read the story again" description="The next update rereads their passages." onSelect={run(() => onAction('reprocess'))} />}
        <MenuSeparator />
        <MenuItem icon={Trash2} danger label={`Delete ${selectedCount} ${selectedCount === 1 ? 'entity' : 'entities'}`} onSelect={run(() => onAction('delete'))} />
      </Menu>
    </div>
  );
}

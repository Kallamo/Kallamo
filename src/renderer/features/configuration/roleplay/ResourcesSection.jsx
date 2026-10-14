import { useRef, useState } from 'react';
import { ChevronDown, Gauge, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '../../../components/ui/Button';
import IconButton from '../../../components/ui/IconButton';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import { Menu, MenuItem, MenuSeparator } from '../../../components/ui/Menu';
import { meta } from '../../worldbuild/worldbuildConfig';
import { ConfigSection, FieldLabel, Help, formatNumber, formatSigned } from '../ConfigParts';
import ResourceModal, { EMPTY_RESOURCE } from './ResourceModal';

const POLICY_LABEL = { manual: 'Manual', review: 'Review', automatic: 'Automatic' };
const TARGET_LABEL = { entity: 'Character', race: 'Race', species: 'Species' };

export function describeRange(definition, levels = false) {
  const unit = definition.unit ? ` ${definition.unit}` : '';
  const parts = [`${definition.startsFull === false ? 'Starts empty' : 'Starts full'}, ${formatNumber(definition.minimum)} to ${formatNumber(definition.maximum)}${unit}`];
  if (levels && definition.growthPerLevel) parts.push(`${formatSigned(definition.growthPerLevel)} per level${definition.refillOnLevelUp ? ', refills' : ''}`);
  if (definition.timeRate > 0) parts.push(`${definition.timeDirection === 'drains' ? 'drains' : 'recovers'} ${formatNumber(definition.timeRate)} per ${definition.timePeriod === 'day' ? 'day' : 'hour'}`);
  return parts.join(' · ');
}

/** The world's resources and who holds them. Each character's current values live on their sheet. */
export default function ResourcesSection({ sectionRef, workspaceId, api, showToast, definitions, assignments, groups, names, levels = false, defaultPolicy = 'review', onChanged, embedded = false }) {
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const save = async (draft, holderWrites = []) => {
    const payload = {
      ...draft,
      minimum: Number(draft.minimum),
      maximum: Number(draft.maximum),
      key: draft.key || draft.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `resource-${Date.now()}`
    };
    const result = await api.saveRoleplayResourceDefinition(workspaceId, payload);
    if (!result?.success) {
      const duplicate = String(result?.error || '').includes('UNIQUE constraint failed');
      showToast(duplicate ? 'A resource with this name already exists. Use a different name.' : result?.error || 'Could not save the resource.', 'error');
      return;
    }
    const definitionId = result.definition.id;
    for (const write of holderWrites) {
      const target = { workspaceId, definitionId, targetType: write.targetType, targetId: write.targetId };
      let outcome = { success: true };
      if (write.remove) outcome = await api.removeRoleplayResourceValue(target);
      else if (write.targetType !== 'entity') outcome = await api.setRoleplayResourceValue({ ...target, value: write.value });
      else {
        // Giving the resource makes the row; a new adjustment is a change, so History keeps its reason.
        if (write.give) outcome = await api.setRoleplayResourceValue({ ...target, value: {} });
        if (outcome?.success && write.maximumDelta) outcome = await api.changeRoleplayResource({
          id: crypto.randomUUID(), workspaceId, definitionId, entityId: write.targetId, delta: 0,
          maximumDelta: write.maximumDelta, reason: write.reason, source: 'manual', provenanceId: 'resource-editor'
        });
      }
      if (!outcome?.success) showToast(outcome?.error || `Could not save ${names.get(write.targetId) || 'a holder'}.`, 'error');
    }
    setEditing(null);
    setOpenId(definitionId);
    await onChanged();
  };

  const remove = async definition => {
    setDeletingBusy(true);
    const result = await api.deleteRoleplayResourceDefinition(workspaceId, definition.id);
    setDeletingBusy(false);
    if (!result?.success) return showToast(result?.error || 'Could not delete the resource.', 'error');
    setDeleting(null);
    await onChanged();
  };

  return (
    <ConfigSection
      id="resources"
      sectionRef={sectionRef}
      icon={Gauge}
      title="Resources"
      description="Numbers the AI keeps for characters and creatures, such as Health or Mana. Each character's current values live on their sheet."
      action={<Button variant="ghost" size="sm" icon={Plus} onClick={() => setEditing({ ...EMPTY_RESOURCE, updatePolicy: defaultPolicy })}>New resource</Button>}
      embedded={embedded}
    >
      {definitions.length ? (
          <div className="flex flex-col gap-2.5">
            {definitions.map(definition => (
              <ResourceRow
                key={definition.id}
                definition={definition}
                holders={assignments.filter(item => item.definitionId === definition.id)}
                levels={levels}
                open={openId === definition.id}
                onToggle={() => setOpenId(current => current === definition.id ? null : definition.id)}
                onEdit={() => setEditing(definition)}
                onDelete={() => setDeleting(definition)}
                names={names}
              />
            ))}
          </div>
      ) : (
        <p className="rounded-card border border-dashed border-border-subtle px-4 py-6 text-center text-[0.8125rem] text-text-muted">No resources yet. Add Health, Stamina, Mana or anything the story should count.</p>
      )}

      {editing && <ResourceModal initial={editing} levels={levels} workspaceId={workspaceId} api={api} groups={groups} onCancel={() => setEditing(null)} onSave={save} />}
      {deleting && (
        <ConfirmDialog
          tone="danger"
          title={`Delete ${deleting.name}?`}
          message={<>Everyone loses <strong className="text-text-primary">{deleting.name}</strong>, with its values and its history.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => { if (!deletingBusy) setDeleting(null); } },
            { label: 'Delete resource', variant: 'danger', loading: deletingBusy, autoFocus: true, onClick: () => remove(deleting) }
          ]}
          onClose={() => { if (!deletingBusy) setDeleting(null); }}
        />
      )}
    </ConfigSection>
  );
}

function ResourceRow({ definition, holders, levels, open, onToggle, onEdit, onDelete, names }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const chosen = definition.scope === 'chosen';
  const lowest = definition.lowestEffect ? `At ${formatNumber(definition.minimum)}: ${definition.lowestEffect}` : '';
  const ordered = [...holders].sort((left, right) => Number(left.targetType === 'entity') - Number(right.targetType === 'entity'));
  const describeHolder = holder => {
    if (holder.targetType !== 'entity') {
      const parts = [holder.base != null ? `base ${formatNumber(holder.base)}` : '', levels && holder.growth != null ? `${formatSigned(holder.growth)} per level` : ''].filter(Boolean);
      return parts.join(', ') || 'Uses the resource';
    }
    return holder.adjustment ? `Adjusted ${formatSigned(holder.adjustment)}` : chosen ? 'Given directly' : 'Own current value';
  };

  return (
    <article className="rounded-card border border-border-subtle bg-surface-inset">
      <div className="flex flex-wrap items-center gap-3 py-3 pl-4 pr-2.5">
        <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-[0.25rem]" style={{ backgroundColor: definition.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-x-2.5">
            <span className="text-[0.9375rem] font-semibold text-text-primary">{definition.name}</span>
            <span className="min-w-0 truncate text-xs tabular-nums text-text-subtle" data-tooltip={describeRange(definition, levels)}>{describeRange(definition, levels)}</span>
          </div>
          {lowest && !open && <p className="mt-0.5 truncate text-xs text-text-subtle">{lowest}</p>}
        </div>
        <span className="inline-flex h-5.5 shrink-0 items-center whitespace-nowrap rounded-md bg-tint/[0.06] px-2 text-xs font-medium text-text-secondary">
          {chosen ? `Only: ${holders.length} chosen` : 'Everyone'}
        </span>
        <span className="inline-flex h-5.5 shrink-0 items-center whitespace-nowrap rounded-md bg-tint/[0.06] px-2 text-xs font-medium text-text-secondary">AI: {POLICY_LABEL[definition.updatePolicy] || definition.updatePolicy}</span>
        <IconButton ref={menuRef} icon={MoreHorizontal} size="sm" label={`${definition.name} actions`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)} />
        <Menu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={`${definition.name} actions`} className="w-52">
          <MenuItem icon={Pencil} label="Edit" onSelect={() => { setMenuOpen(false); onEdit(); }} />
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Delete" danger onSelect={() => { setMenuOpen(false); onDelete(); }} />
        </Menu>
        <IconButton icon={ChevronDown} size="sm" label={open ? `Fold ${definition.name}` : `Unfold ${definition.name}`} aria-expanded={open} onClick={onToggle} className={open ? '[&_svg]:rotate-180' : ''} />
      </div>

      {open && (
        <div className="flex flex-col gap-4.5 border-t border-border-subtle p-4">
          <div>
            <FieldLabel>What it means to the AI</FieldLabel>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{definition.description || 'Nothing written yet. Edit the resource to tell the AI what moves it.'}</p>
            {lowest && <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{lowest}</p>}
            {definition.aiChangesMaximum && definition.updatePolicy !== 'manual' && (
              <p className="mt-1.5 text-xs leading-relaxed text-text-muted">The AI can change the maximum{definition.maximumRule ? `: ${definition.maximumRule}` : '.'}</p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-baseline gap-2.5">
              <FieldLabel>{chosen ? 'Who has it' : 'Races and characters'}</FieldLabel>
              <span className="text-xs tabular-nums text-text-subtle">{holders.length}</span>
            </div>
            <Help className="mb-2.5">
              {chosen
                ? `Only the people, races or species listed here. Everyone else has no ${definition.name}, and the AI is never told about it.`
                : 'Races and species with their own base or growth, and characters with an adjustment.'}
            </Help>
            {ordered.length > 0 && (
              <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle">
                {ordered.map(holder => (
                  <div key={`${holder.targetType}:${holder.targetId}`} className="flex items-center gap-3 px-3 py-2">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${holder.targetType === 'race' ? meta('Races').dot : holder.targetType === 'species' ? meta('Creatures').dot : meta('Characters').dot}`} />
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-text-primary">{names.get(holder.targetId) || 'Unknown'}<span className="ml-1.5 text-xs text-text-subtle">{TARGET_LABEL[holder.targetType]}</span></span>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">{describeHolder(holder)}</span>
                  </div>
                ))}
              </div>
            )}
            <Button variant="ghost" size="sm" icon={chosen ? Plus : Pencil} className="mt-2.5" onClick={onEdit}>{chosen ? `Give ${definition.name}` : 'Edit races and characters'}</Button>
          </div>
        </div>
      )}
    </article>
  );
}

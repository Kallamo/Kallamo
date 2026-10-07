import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Gauge, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '../../../components/ui/Button';
import IconButton from '../../../components/ui/IconButton';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import NumberInput from '../../../components/ui/NumberInput';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import SegmentedControl from '../../../components/ui/SegmentedControl';
import { Menu, MenuItem, MenuSeparator } from '../../../components/ui/Menu';
import { meta } from '../../worldbuild/worldbuildConfig';
import { ConfigSection, FieldLabel, Help, Track, formatNumber } from '../ConfigParts';
import ResourceModal, { EMPTY_RESOURCE, KIND_LABELS } from './ResourceModal';

const POLICY_LABEL = { manual: 'Manual', review: 'Review', automatic: 'Automatic' };
const TARGET_LABEL = { entity: 'Character', race: 'Race', species: 'Species' };

const option = entity => ({
  id: entity.id,
  label: entity.canonicalName,
  aliases: Array.isArray(entity.aliases) ? entity.aliases : String(entity.aliases || '').split(',').map(alias => alias.trim()).filter(Boolean),
  group: meta(entity.type).label,
  dotClassName: meta(entity.type).dot
});

const percentOf = (value, minimum, maximum) => ((value - minimum) / Math.max(1, maximum - minimum)) * 100;

export function describeRange(definition) {
  const unit = definition.unit ? ` ${definition.unit}` : '';
  const parts = [`${formatNumber(definition.minimum)} to ${formatNumber(definition.maximum)}${unit}, starts at ${formatNumber(definition.initialValue)}`];
  if (definition.timeRate > 0) parts.push(`${definition.timeDirection === 'drains' ? 'drains' : 'recovers'} ${formatNumber(definition.timeRate)} per ${definition.timePeriod === 'day' ? 'day' : 'hour'}`);
  return parts.join(' · ');
}

/** The world's resources and who holds them. Each character's current values live on their sheet. */
export default function ResourcesSection({ sectionRef, workspaceId, api, showToast, definitions, assignments, groups, names, defaultPolicy = 'review', onChanged, embedded = false }) {
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const save = async draft => {
    const payload = {
      ...draft,
      minimum: Number(draft.minimum),
      maximum: Number(draft.maximum),
      initialValue: Number(draft.initialValue),
      key: draft.key || draft.name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `resource-${Date.now()}`
    };
    const result = await api.saveRoleplayResourceDefinition(workspaceId, payload);
    if (!result?.success) {
      const duplicate = String(result?.error || '').includes('UNIQUE constraint failed');
      showToast(duplicate ? 'A resource with this name already exists. Use a different name.' : result?.error || 'Could not save the resource.', 'error');
      return;
    }
    setEditing(null);
    setOpenId(result.definition.id);
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
                open={openId === definition.id}
                onToggle={() => setOpenId(current => current === definition.id ? null : definition.id)}
                onEdit={() => setEditing(definition)}
                onDelete={() => setDeleting(definition)}
                groups={groups}
                names={names}
                workspaceId={workspaceId}
                api={api}
                showToast={showToast}
                onChanged={onChanged}
              />
            ))}
          </div>
      ) : (
        <p className="rounded-card border border-dashed border-border-subtle px-4 py-6 text-center text-[0.8125rem] text-text-muted">No resources yet. Add Health, Stamina, Mana or anything the story should count.</p>
      )}

      {editing && <ResourceModal initial={editing} onCancel={() => setEditing(null)} onSave={save} />}
      {deleting && (
        <ConfirmDialog
          tone="danger"
          title={`Delete ${deleting.name}?`}
          message={<>Everyone loses <strong className="text-text-primary">{deleting.name}</strong>, with its values and its history. Level rewards that raise it stop doing so.</>}
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

function ResourceRow({ definition, holders, open, onToggle, onEdit, onDelete, groups, names, workspaceId, api, showToast, onChanged }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const chosen = definition.scope === 'chosen';
  const [give, setGive] = useState({ targetType: 'entity', targetIds: [], current: definition.initialValue, maximum: definition.maximum });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);

  useEffect(() => setGive(current => ({ ...current, current: definition.initialValue, maximum: definition.maximum })), [definition.initialValue, definition.maximum]);

  const targets = give.targetType === 'race' ? groups.races : give.targetType === 'species' ? groups.species : groups.actors;
  const lowest = definition.lowestEffect ? `At ${formatNumber(definition.minimum)}: ${definition.lowestEffect}` : '';

  const addHolders = async () => {
    setAdding(true);
    const result = await api.setRoleplayResourceValues({
      workspaceId, definitionId: definition.id, targetType: give.targetType, targetIds: give.targetIds,
      value: { current: Number(give.current), maximum: Number(give.maximum) }
    });
    setAdding(false);
    if (!result?.success) return showToast(result?.error || 'Could not save.', 'error');
    setGive(current => ({ ...current, targetIds: [], current: definition.initialValue, maximum: definition.maximum }));
    await onChanged();
  };
  const editHolder = holder => setGive({ targetType: holder.targetType, targetIds: [holder.targetId], current: holder.current, maximum: holder.maximum });
  const holderKeys = new Set(holders.map(holder => `${holder.targetType}:${holder.targetId}`));
  const updating = give.targetIds.length > 0 && give.targetIds.every(id => holderKeys.has(`${give.targetType}:${id}`));

  const removeHolder = async holder => {
    const result = await api.removeRoleplayResourceValue({ workspaceId, definitionId: definition.id, targetType: holder.targetType, targetId: holder.targetId });
    setRemoving(null);
    if (!result?.success) return showToast(result?.error || 'Could not remove it.', 'error');
    await onChanged();
  };

  return (
    <article className="rounded-card border border-border-subtle bg-surface-inset">
      <div className="flex flex-wrap items-center gap-3 py-3 pl-4 pr-2.5">
        <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-[0.25rem]" style={{ backgroundColor: definition.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-x-2.5">
            <span className="text-[0.9375rem] font-semibold text-text-primary">{definition.name}</span>
            <span className="min-w-0 truncate text-xs tabular-nums text-text-subtle" data-tooltip={describeRange(definition)}>{describeRange(definition)}</span>
          </div>
          {lowest && !open && <p className="mt-0.5 truncate text-xs text-text-subtle">{lowest}</p>}
        </div>
        <span className="inline-flex h-5.5 shrink-0 items-center whitespace-nowrap rounded-md bg-tint/[0.06] px-2 text-xs font-medium text-text-secondary">
          {chosen ? `Only: ${holders.length} chosen` : `Everyone: ${definition.appliesTo.map(kind => KIND_LABELS[kind] || kind).join(', ')}`}
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
          </div>

          <div>
            <div className="mb-1 flex items-baseline gap-2.5">
              <FieldLabel>{chosen ? 'Who has it' : 'Own values'}</FieldLabel>
              <span className="text-xs tabular-nums text-text-subtle">{holders.length}</span>
            </div>
            <Help className="mb-2.5">
              {chosen
                ? `Only the people, races or species listed here. Everyone else has no ${definition.name}, and the AI is never told about it.`
                : 'Characters, races or species that start differently. A character\'s own value comes first, then their race or species, then the default.'}
            </Help>
            {holders.length > 0 && (
              <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle">
                {holders.map(holder => {
                  const name = names.get(holder.targetId) || 'Unknown';
                  return (
                    <div key={`${holder.targetType}:${holder.targetId}`} className="flex items-center gap-3 px-3 py-2">
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${holder.targetType === 'race' ? meta('Races').dot : holder.targetType === 'species' ? meta('Creatures').dot : meta('Characters').dot}`} />
                      <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-text-primary">{name}{holder.targetType !== 'entity' && <span className="ml-1.5 text-xs text-text-subtle">{TARGET_LABEL[holder.targetType]}</span>}</span>
                      <Track percent={percentOf(holder.current, definition.minimum, holder.maximum)} color={definition.color} className="hidden h-1.5 w-28 sm:block" />
                      <span className="w-[5.5rem] text-right text-[0.8125rem] tabular-nums text-text-secondary">{formatNumber(holder.current)} / {formatNumber(holder.maximum)}</span>
                      <IconButton icon={Pencil} size="sm" label={`Change ${name}'s ${definition.name}`} onClick={() => editHolder(holder)} />
                      <IconButton icon={Trash2} size="sm" tone="danger" label={`Remove ${definition.name} from ${name}`} onClick={() => setRemoving(holder)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-tint/[0.02] p-3">
            <FieldLabel>{updating ? `Change ${definition.name} for` : chosen ? `Give ${definition.name} to` : 'Set a different value for'}</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl label="Give to" value={give.targetType} onChange={targetType => setGive(current => ({ ...current, targetType, targetIds: [] }))} options={['entity', 'race', 'species'].map(value => ({ value, label: TARGET_LABEL[value] }))} />
              <SearchableSelect className="min-w-[12rem] flex-1" multiple values={give.targetIds} onChange={targetIds => setGive(current => ({ ...current, targetIds }))} options={targets.map(option)} placeholder={`Choose ${give.targetType === 'entity' ? 'characters' : give.targetType === 'race' ? 'races' : 'species'}`} ariaLabel="Who gets it" />
              <span className="flex shrink-0 items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-text-muted">Current<NumberInput className="field-input h-10 w-16 px-2.5 text-sm tabular-nums" value={give.current} integer={false} onChange={current => setGive(value => ({ ...value, current }))} /></label>
              <label className="flex items-center gap-1.5 text-xs text-text-muted">Highest<NumberInput className="field-input h-10 w-16 px-2.5 text-sm tabular-nums" value={give.maximum} integer={false} onChange={maximum => setGive(value => ({ ...value, maximum }))} /></label>
              <Button variant="primary" size="sm" loading={adding} disabled={!give.targetIds.length} onClick={addHolders}>{updating ? 'Save' : 'Add'}</Button>
              </span>
            </div>
          </div>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title={chosen ? `Take ${definition.name} away?` : 'Use the default again?'}
          message={chosen
            ? <><strong className="text-text-primary">{names.get(removing.targetId) || 'They'}</strong> will no longer have {definition.name}.</>
            : <><strong className="text-text-primary">{names.get(removing.targetId) || 'They'}</strong> go back to the value they would inherit.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setRemoving(null) },
            { label: chosen ? 'Take it away' : 'Use the default', variant: 'danger', autoFocus: true, onClick: () => removeHolder(removing) }
          ]}
          onClose={() => setRemoving(null)}
        />
      )}
    </article>
  );
}

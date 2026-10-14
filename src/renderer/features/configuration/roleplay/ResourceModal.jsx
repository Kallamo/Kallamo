import { useEffect, useId, useState } from 'react';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Checkbox from '../../../components/ui/Checkbox';
import ColorField from '../../../components/ui/ColorField';
import IconButton from '../../../components/ui/IconButton';
import NumberInput from '../../../components/ui/NumberInput';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import SegmentedControl from '../../../components/ui/SegmentedControl';
import Tabs from '../../../components/ui/Tabs';
import Toggle from '../../../components/ui/Toggle';
import { Gauge, X } from 'lucide-react';
import { meta } from '../../worldbuild/worldbuildConfig';
import { ChoiceCard, FieldLabel, Help, ReasonInput, formatNumber, formatSigned } from '../ConfigParts';
import ResizableTextarea from '../../../components/ui/ResizableTextarea';

export const EMPTY_RESOURCE = {
  name: '', key: '', description: '', color: '#dc2626', minimum: 0, maximum: 100, startsFull: true, unit: '',
  updatePolicy: 'review', enabled: true, scope: 'everyone', lowestEffect: '',
  timeRate: 0, timeDirection: 'recovers', timePeriod: 'hour',
  growthPerLevel: 0, refillOnLevelUp: false, aiChangesMaximum: false, maximumRule: ''
};

const POLICY_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'review', label: 'Review everything' },
  { value: 'automatic', label: 'Automatic' }
];

const PREVIEW_LEVELS = [1, 5, 10, 20];
const subLabel = 'text-xs text-text-muted';

const blankToNull = value => (value === '' || value === null || value === undefined ? null : Number(value));

/**
 * Create or edit one resource. Rules says what it is and how it moves; Races and characters
 * holds who has their own base and growth, and each character's adjustment.
 */
export default function ResourceModal({ initial, levels = false, workspaceId, api, groups, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => ({ ...EMPTY_RESOURCE, ...initial }));
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('rules');
  const [timeOn, setTimeOn] = useState(() => Number(initial?.timeRate) > 0);
  const [holders, setHolders] = useState({ original: { groups: [], characters: [] }, groups: [], characters: [] });
  const formId = useId();
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  const editing = Boolean(initial?.id);
  const name = draft.name.trim() || 'it';

  useEffect(() => {
    if (!initial?.id) return undefined;
    let live = true;
    api.listRoleplayResourceHolders(workspaceId, initial.id).then(result => {
      if (!live || !result?.success) return;
      const loaded = {
        groups: result.groups.map(group => ({ ...group, base: group.base ?? '', growth: group.growth ?? '' })),
        characters: result.characters.map(character => ({ ...character, adjustment: character.adjustment || '' }))
      };
      setHolders({ original: loaded, ...loaded });
    });
    return () => { live = false; };
  }, [api, workspaceId, initial?.id]);

  const rangeValid = Number(draft.maximum) > Number(draft.minimum);
  const groupsValid = holders.groups.every(group => group.base === '' || Number(group.base) > Number(draft.minimum));
  const rate = Math.max(0, Number(draft.timeRate) || 0);
  const growth = Number(draft.growthPerLevel) || 0;
  const manual = draft.updatePolicy === 'manual';
  const example = rate > 0
    ? draft.timeDirection === 'drains'
      ? `A day without rest takes ${formatAmount(rate * (draft.timePeriod === 'day' ? 1 : 24))} ${name}.`
      : `An eight-hour rest gives back ${formatAmount(draft.timePeriod === 'day' ? rate / 3 : rate * 8)} ${name}.`
    : '';
  const holderCount = holders.groups.length + holders.characters.length;

  const submit = async event => {
    event?.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...draft,
        timeRate: timeOn ? rate : 0,
        growthPerLevel: growth,
        aiChangesMaximum: draft.aiChangesMaximum && !manual
      }, changedHolders(holders));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${initial.name}` : 'New resource'}
      subtitle={editing ? `${draft.scope === 'chosen' ? 'Only who you choose' : 'Everyone'}${holderCount ? ` · ${holderCount} with their own values` : ''}` : null}
      leading={<ResourceTile color={draft.color} />}
      onClose={() => { if (!saving) onCancel(); }}
      size="xl"
    >
      <form id={formId} onSubmit={submit} className="flex h-[min(78vh,56rem)] flex-col">
        <Tabs
          variant="underline"
          label="Resource"
          className="shrink-0 px-6 pt-3"
          activeId={tab}
          onChange={setTab}
          items={[{ id: 'rules', label: 'Rules' }, { id: 'holders', label: 'Races and characters', count: holderCount }]}
        />
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 py-5 custom-scrollbar">
          {tab === 'rules' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_8rem]">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${formId}-name`}>Name</FieldLabel>
                  <input id={`${formId}-name`} autoFocus className="field-input h-10 px-3 text-sm" value={draft.name} onChange={event => set({ name: event.target.value })} placeholder="Health, Mana, Sanity" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>Colour</FieldLabel>
                  <ColorField ariaLabel="Resource colour" value={draft.color} onChange={color => set({ color })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${formId}-unit`}>Unit</FieldLabel>
                  <input id={`${formId}-unit`} className="field-input h-10 px-3 text-sm" value={draft.unit || ''} onChange={event => set({ unit: event.target.value })} placeholder="optional" />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <FieldLabel>Who has it</FieldLabel>
                <div role="radiogroup" aria-label="Who has it" className="grid gap-2 sm:grid-cols-2">
                  <ChoiceCard name={`${formId}-scope`} selected={draft.scope === 'everyone'} onSelect={() => set({ scope: 'everyone' })} title="Everyone" description="Every character and specific being has it." />
                  <ChoiceCard name={`${formId}-scope`} selected={draft.scope === 'chosen'} onSelect={() => set({ scope: 'chosen' })} title="Only who I choose" description="Given to a character, a race or a species. For a mage's Mana, or a curse." />
                </div>
              </div>

              <Block title="Maximum">
                <div className="grid gap-2.5 sm:grid-cols-[7rem_9rem_minmax(0,1fr)]">
                  <NumberLabel label="Lowest" value={draft.minimum} onChange={minimum => set({ minimum })} />
                  <NumberLabel label={levels ? 'Maximum at level 1' : 'Maximum'} value={draft.maximum} onChange={maximum => set({ maximum })} />
                  <div className="flex flex-col gap-1">
                    <span className={subLabel}>A new holder starts</span>
                    <div><SegmentedControl label="A new holder starts" value={draft.startsFull ? 'full' : 'empty'} onChange={value => set({ startsFull: value === 'full' })} options={[{ value: 'full', label: 'Full' }, { value: 'empty', label: 'Empty' }]} /></div>
                  </div>
                </div>
                {!rangeValid && <p className="text-xs text-status-danger">The maximum must be above the lowest.</p>}
                <Help>
                  {levels
                    ? "Each character's maximum is worked out: this base, plus the growth for each level, plus their own adjustments. A race or species can set its own base and growth."
                    : "Each character's maximum is this, plus their own adjustments. A race or species can set its own. With levels on in Progression, it can also grow per level."}
                </Help>
              </Block>

              {levels && (
                <Block title="Per level" aside="Progression uses levels">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
                    <label className="flex items-center gap-2 text-[0.8125rem] text-text-secondary">
                      Grows
                      <NumberInput aria-label="Growth per level" className="field-input h-10 w-20 px-3 text-right text-sm tabular-nums" value={draft.growthPerLevel} integer={false} onChange={growthPerLevel => set({ growthPerLevel })} />
                      per level
                    </label>
                    <Checkbox checked={Boolean(draft.refillOnLevelUp)} onChange={() => set({ refillOnLevelUp: !draft.refillOnLevelUp })} label="Refill when they level up" />
                  </div>
                  <p className="text-xs tabular-nums text-text-subtle">
                    {PREVIEW_LEVELS.map((level, index) => (
                      <span key={level}>
                        {index ? ' · ' : ''}{index ? 'level' : 'Level'} {level}: <b className="font-semibold text-text-secondary">{formatNumber(Number(draft.maximum) + growth * (level - 1))}</b>
                      </span>
                    ))}
                  </p>
                </Block>
              )}

              <Block title="Over time">
                <div className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface-inset p-3">
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8125rem] font-semibold text-text-secondary">Changes with time</span>
                      <span className="block text-xs text-text-subtle">Only story time counts: what the Roleplay clock moves.</span>
                    </span>
                    <Toggle checked={timeOn} onChange={value => { setTimeOn(value); if (value && !rate) set({ timeRate: 1 }); }} ariaLabel="Changes with time" />
                  </div>
                  {timeOn && (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <SegmentedControl label="Direction" value={draft.timeDirection} onChange={timeDirection => set({ timeDirection })} options={[{ value: 'recovers', label: 'Recovers' }, { value: 'drains', label: 'Drains' }]} />
                        <NumberInput aria-label="Amount" className="field-input h-10 w-20 px-3 text-sm tabular-nums" value={draft.timeRate} min={0} integer={false} onChange={timeRate => set({ timeRate })} />
                        <span className={subLabel}>per</span>
                        <SegmentedControl label="Period" value={draft.timePeriod} onChange={timePeriod => set({ timePeriod })} options={[{ value: 'hour', label: 'hour' }, { value: 'day', label: 'day' }]} />
                      </div>
                      <Help>{example} Use Drains for hunger or a curse.</Help>
                    </>
                  )}
                </div>
              </Block>

              <Block title="For the AI" aside="Sent to the narrator and to Narrative State">
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${formId}-meaning`}>What it means</FieldLabel>
                  <ResizableTextarea id={`${formId}-meaning`} storageKey="rules-resource-meaning" value={draft.description || ''} onChange={event => set({ description: event.target.value })} placeholder="What makes it go down, and what brings it back." />
                </div>
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor={`${formId}-lowest`}>At the lowest</FieldLabel>
                  <input id={`${formId}-lowest`} className="field-input h-10 px-3 text-sm" value={draft.lowestEffect || ''} onChange={event => set({ lowestEffect: event.target.value })} placeholder="Unconscious. Cannot act until someone helps." />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <FieldLabel className="flex-1">How the AI changes it</FieldLabel>
                  <SegmentedControl label="How the AI changes it" value={draft.updatePolicy} onChange={updatePolicy => set({ updatePolicy })} options={POLICY_OPTIONS} />
                </div>
                {!editing && <Help className="-mt-2">Starts with the rule set in Configuration, Narrative State.</Help>}
                <div className={`flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface-inset p-3 ${manual ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8125rem] font-semibold text-text-secondary">The AI can change the maximum</span>
                      <span className="block text-xs text-text-subtle">
                        {manual ? 'Manual keeps the AI away from this resource.' : 'For lasting change. Each one waits for your review, even with Automatic.'}
                      </span>
                    </span>
                    <Toggle checked={Boolean(draft.aiChangesMaximum) && !manual} disabled={manual} onChange={aiChangesMaximum => set({ aiChangesMaximum })} ariaLabel="The AI can change the maximum" />
                  </div>
                  {draft.aiChangesMaximum && !manual && (
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel htmlFor={`${formId}-maximum-rule`}>When the maximum changes</FieldLabel>
                      <ResizableTextarea id={`${formId}-maximum-rule`} storageKey="rules-resource-maximum-rule" value={draft.maximumRule || ''} onChange={event => set({ maximumRule: event.target.value })} placeholder="Only after long training or a lasting change to the body. Between +5 and +20 each time." />
                      <Help>A potion or a curse that will lift changes the current value, not the maximum.</Help>
                    </div>
                  )}
                </div>
              </Block>
            </>
          ) : (
            <HoldersTab draft={draft} levels={levels} groups={groups} holders={holders} setHolders={setHolders} />
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-6 py-4">
          <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!draft.name.trim() || !rangeValid || !groupsValid}>{editing ? 'Save resource' : 'Create resource'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function HoldersTab({ draft, levels, groups, holders, setHolders }) {
  const [addingGroup, setAddingGroup] = useState('');
  const [addingCharacter, setAddingCharacter] = useState('');
  const chosen = draft.scope === 'chosen';
  const listedGroups = new Set(holders.groups.map(group => group.targetId));
  const listedCharacters = new Set(holders.characters.map(character => character.entityId));
  const groupOptions = [...groups.races, ...groups.species].filter(entity => !listedGroups.has(entity.id)).map(entity => ({
    id: entity.id, label: entity.canonicalName, group: entity.type === 'Races' ? 'Races' : 'Species', dotClassName: meta(entity.type).dot
  }));
  const characterOptions = groups.actors.filter(entity => !listedCharacters.has(entity.id)).map(entity => ({
    id: entity.id, label: entity.canonicalName, group: meta(entity.type).label, dotClassName: meta(entity.type).dot
  }));
  const updateGroup = (id, patch) => setHolders(current => ({ ...current, groups: current.groups.map(group => group.targetId === id ? { ...group, ...patch } : group) }));
  const updateCharacter = (id, patch) => setHolders(current => ({ ...current, characters: current.characters.map(character => character.entityId === id ? { ...character, ...patch } : character) }));
  const addGroup = id => {
    const entity = [...groups.races, ...groups.species].find(item => item.id === id);
    if (!entity) return;
    setHolders(current => ({ ...current, groups: [...current.groups, { targetType: entity.type === 'Races' ? 'race' : 'species', targetId: id, name: entity.canonicalName, base: '', growth: '', members: null }] }));
    setAddingGroup('');
  };
  const addCharacter = id => {
    const entity = groups.actors.find(item => item.id === id);
    if (!entity) return;
    setHolders(current => ({ ...current, characters: [...current.characters, { entityId: id, name: entity.canonicalName, adjustment: '', current: null, maximum: null, groupName: null, level: null }] }));
    setAddingCharacter('');
  };
  const growthHint = levels ? `, ${formatSigned(Number(draft.growthPerLevel) || 0)} per level` : '';
  const groupColumns = levels ? 'minmax(0,1fr) 6.5rem 6.5rem 5.5rem 2rem' : 'minmax(0,1fr) 6.5rem 5.5rem 2rem';

  return (
    <>
      <Block title="Races and species" aside={levels ? 'Their own base and growth' : 'Their own base'} first>
        {holders.groups.length > 0 ? (
          <div>
            <div className="grid gap-3 px-3.5 pb-1.5 text-xs text-text-subtle" style={{ gridTemplateColumns: groupColumns }}>
              <span>Race or species</span><span className="text-right">Base</span>{levels && <span className="text-right">Per level</span>}<span className="text-right">Members</span><span />
            </div>
            <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
              {holders.groups.map(group => (
                <div key={group.targetId} className="grid items-center gap-3 px-3.5 py-2" style={{ gridTemplateColumns: groupColumns }}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${meta(group.targetType === 'race' ? 'Races' : 'Creatures').dot}`} />
                    <span className="truncate text-[0.8125rem] font-semibold text-text-primary">{group.name}</span>
                    <span className="text-xs text-text-subtle">{group.targetType === 'race' ? 'Race' : 'Species'}</span>
                  </span>
                  <NumberInput aria-label={`${group.name} base`} className="field-input h-9 px-3 text-right text-sm tabular-nums" value={group.base === '' ? null : group.base} nullable placeholder={formatNumber(draft.maximum)} integer={false} onChange={base => updateGroup(group.targetId, { base: base ?? '' })} />
                  {levels && <NumberInput aria-label={`${group.name} growth per level`} className="field-input h-9 px-3 text-right text-sm tabular-nums" value={group.growth === '' ? null : group.growth} nullable placeholder={formatSigned(Number(draft.growthPerLevel) || 0)} integer={false} onChange={growth => updateGroup(group.targetId, { growth: growth ?? '' })} />}
                  <span className="text-right text-xs tabular-nums text-text-muted">{group.members == null ? 'New' : `${group.members} ${group.members === 1 ? 'member' : 'members'}`}</span>
                  <IconButton icon={X} size="sm" label={`Remove ${group.name}`} onClick={() => setHolders(current => ({ ...current, groups: current.groups.filter(item => item.targetId !== group.targetId) }))} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-subtle">No race or species has its own values{chosen ? `, and none of their members have ${draft.name.trim() || 'it'}` : ''}.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SearchableSelect className="w-60" value={addingGroup} onChange={addGroup} options={groupOptions} placeholder="Add a race or species" ariaLabel="Add a race or species" emptyMessage="No race or species left" />
          <Help>Empty uses the resource: {formatNumber(draft.maximum)}{growthHint}.</Help>
        </div>
      </Block>

      <Block title="Characters" aside="The maximum is worked out; the adjustment is theirs">
        {holders.characters.length > 0 ? (
          <div>
            <div className="grid gap-3 px-3.5 pb-1.5 text-xs text-text-subtle" style={{ gridTemplateColumns: 'minmax(0,1fr) 8rem 6.5rem 2rem' }}>
              <span>Character</span><span className="text-right">Now</span><span className="text-right">Adjustment</span><span />
            </div>
            <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
              {holders.characters.map(character => {
                const was = holders.original.characters.find(item => item.entityId === character.entityId);
                const changed = (Number(character.adjustment) || 0) !== (Number(was?.adjustment) || 0);
                return (
                <div key={character.entityId} className="grid items-center gap-x-3 gap-y-2 px-3.5 py-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 8rem 6.5rem 2rem' }}>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.8125rem] font-semibold text-text-primary">{character.name}</span>
                    {character.level != null && <span className="block truncate text-xs text-text-subtle">{character.groupName || 'No race'}{levels ? ` · level ${character.level}` : ''}</span>}
                  </span>
                  <span className="text-right text-[0.8125rem] tabular-nums">
                    {character.maximum == null
                      ? <span className="text-text-subtle">After saving</span>
                      : <><span className="text-text-secondary">{formatNumber(character.current)}</span><span className="text-text-subtle"> / {formatNumber(character.maximum)}</span></>}
                  </span>
                  <NumberInput aria-label={`${character.name} adjustment`} className="field-input h-9 px-3 text-right text-sm tabular-nums" value={character.adjustment === '' ? null : character.adjustment} nullable placeholder="+0" integer={false} onChange={adjustment => updateCharacter(character.entityId, { adjustment: adjustment ?? '' })} />
                  <IconButton icon={X} size="sm" label={`Remove ${character.name}`} onClick={() => setHolders(current => ({ ...current, characters: current.characters.filter(item => item.entityId !== character.entityId) }))} />
                  {changed && <ReasonInput className="col-span-full" label={`Why ${character.name}'s adjustment changed`} value={character.reason} onChange={reason => updateCharacter(character.entityId, { reason })} />}
                </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-subtle">No character has an adjustment{chosen ? ' or was given it directly' : ''}.</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SearchableSelect className="w-60" value={addingCharacter} onChange={addCharacter} options={characterOptions} placeholder={chosen ? 'Give to a character' : 'Adjust a character'} ariaLabel={chosen ? 'Give to a character' : 'Adjust a character'} emptyMessage="No character left" />
          {chosen && <Help>Characters of a race above already have it.</Help>}
        </div>
      </Block>

      <Help>The same numbers show on each race and character sheet, and can be changed there too.</Help>
    </>
  );
}

// What the second tab changed, as writes the caller makes once the resource itself is saved.
function changedHolders({ original, groups, characters }) {
  const writes = [];
  const before = new Map(original.groups.map(group => [group.targetId, group]));
  for (const group of groups) {
    const was = before.get(group.targetId);
    before.delete(group.targetId);
    if (was && String(was.base) === String(group.base) && String(was.growth) === String(group.growth)) continue;
    writes.push({ targetType: group.targetType, targetId: group.targetId, value: { base: blankToNull(group.base), growth: blankToNull(group.growth) } });
  }
  for (const gone of before.values()) writes.push({ targetType: gone.targetType, targetId: gone.targetId, remove: true });
  const beforeCharacters = new Map(original.characters.map(character => [character.entityId, character]));
  for (const character of characters) {
    const was = beforeCharacters.get(character.entityId);
    beforeCharacters.delete(character.entityId);
    const maximumDelta = (Number(character.adjustment) || 0) - (Number(was?.adjustment) || 0);
    if (was && !maximumDelta) continue;
    writes.push({ targetType: 'entity', targetId: character.entityId, give: !was, maximumDelta, reason: String(character.reason || '').trim() });
  }
  for (const gone of beforeCharacters.values()) writes.push({ targetType: 'entity', targetId: gone.entityId, remove: true });
  return writes;
}

function Block({ title, aside, first = false, children }) {
  return (
    <div className={`flex flex-col gap-3 ${first ? '' : 'border-t border-border-subtle pt-4'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="flex-1 text-[0.8125rem] font-semibold text-text-muted">{title}</span>
        {aside && <span className="text-xs text-text-subtle">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

function ResourceTile({ color }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 34%, transparent)` }}
    >
      <Gauge className="h-5 w-5" />
    </span>
  );
}

function NumberLabel({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={subLabel}>{label}</span>
      <NumberInput className="field-input h-10 px-3 text-sm tabular-nums" value={value} integer={false} onChange={onChange} />
    </label>
  );
}

function formatAmount(value) {
  return Math.round(value * 10) / 10;
}

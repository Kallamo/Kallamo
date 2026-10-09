import { useEffect, useRef, useState } from 'react';
import { Gamepad2, MoreHorizontal, Pencil, Plus, Sprout, Trash2, X } from 'lucide-react';
import Button from '../../../components/ui/Button';
import Checkbox from '../../../components/ui/Checkbox';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import IconButton from '../../../components/ui/IconButton';
import Modal from '../../../components/ui/Modal';
import NumberInput from '../../../components/ui/NumberInput';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import SegmentedControl from '../../../components/ui/SegmentedControl';
import { Menu, MenuItem, MenuSeparator } from '../../../components/ui/Menu';
import { meta } from '../../worldbuild/worldbuildConfig';
import { ChoiceCard, ConfigSection, FieldLabel, Help, formatNumber } from '../ConfigParts';

const MODES = [
  { value: 'off', title: 'Off', description: 'No growth. Only resources like HP change.' },
  { value: 'levels', title: 'Levels and attributes', description: 'XP raises a level. The AI raises attributes when the story earns it.' }
];
const GROWTH_OPTIONS = [
  { value: 'same', label: 'Needs the same' },
  { value: 'add', label: 'Needs more by' },
  { value: 'multiply', label: 'Multiplies by' }
];
const POLICY_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'review', label: 'Review' },
  { value: 'automatic', label: 'Automatic' }
];

const grow = (first, growth, amount, steps) => {
  if (growth === 'add') return Math.max(1, Math.round(first + amount * steps));
  if (growth === 'multiply') return Math.max(1, Math.round(first * Math.pow(Math.max(1, amount), steps)));
  return Math.max(1, first);
};

function xpExample(xp) {
  const steps = [0, 1, 2].map(step => grow(xp.firstGoal, xp.growth, xp.growthAmount, step));
  return `Level 2 at ${formatNumber(steps[0])} · level 3 at ${formatNumber(steps[1])} more · level 4 at ${formatNumber(steps[2])} more. Extra XP carries over. Highest level: ${xp.maxLevel ? formatNumber(xp.maxLevel) : 'none'}.`;
}

/** How characters grow: one style per campaign, who grows, and the rules the AI follows. */
export default function ProgressionSection({ sectionRef, workspaceId, api, showToast, progression, traits, definitions, groups, names, onChanged, embedded = false }) {
  const [config, setConfigState] = useState(progression.config);
  const configRef = useRef(progression.config);
  const setConfig = next => {
    const value = typeof next === 'function' ? next(configRef.current) : next;
    configRef.current = value;
    setConfigState(value);
  };
  const [traitDraft, setTraitDraft] = useState(null);
  const [deletingTrait, setDeletingTrait] = useState(null);
  const [rewardDraft, setRewardDraft] = useState(null);
  useEffect(() => setConfig(progression.config), [progression.config]); // eslint-disable-line react-hooks/exhaustive-deps

  const mode = progression.mode;

  const persist = async patch => {
    const result = await api.saveRoleplayProgression(workspaceId, patch);
    if (!result?.success) {
      showToast(result?.error || 'Could not save progression.', 'error');
      setConfig(progression.config);
      return;
    }
    await onChanged();
  };
  const saveConfig = async patch => {
    const next = { ...configRef.current, ...patch };
    setConfig(next);
    await persist({ config: next });
  };
  const draftXp = patch => setConfig(current => ({ ...current, xp: { ...current.xp, ...patch } }));
  const draftAttributes = patch => setConfig(current => ({ ...current, attributes: { ...current.attributes, ...patch } }));
  const commit = () => persist({ config: configRef.current });

  const setMembers = async members => {
    const result = await api.setRoleplayProgressionMembers(workspaceId, members);
    if (!result?.success) return showToast(result?.error || 'Could not change who progresses.', 'error');
    await onChanged();
  };

  const saveTrait = async draft => {
    const result = await api.saveRoleplayTrait(workspaceId, draft);
    if (!result?.success) return showToast(result?.error || 'Could not save it.', 'error');
    setTraitDraft(null);
    await onChanged();
  };
  const removeTrait = async trait => {
    const result = await api.deleteRoleplayTrait(workspaceId, trait.id);
    setDeletingTrait(null);
    if (!result?.success) return showToast(result?.error || 'Could not delete it.', 'error');
    await onChanged();
  };

  const definitionById = new Map(definitions.map(definition => [definition.id, definition]));
  const rewards = config.rewards.filter(reward => definitionById.has(reward.definitionId));

  return (
    <ConfigSection
      id="progression"
      sectionRef={sectionRef}
      embedded={embedded}
      icon={Sprout}
      title="Progression"
      description="How characters grow over the campaign: XP raises their level, and the AI raises attributes when the story earns it."
    >
      <div className="flex flex-col gap-5">
        <div role="radiogroup" aria-label="Progression style" className="grid gap-2.5 md:grid-cols-2">
          {MODES.map(option => (
            <ChoiceCard key={option.value} name="progression-mode" selected={mode === option.value} onSelect={() => persist({ mode: option.value })} title={option.title} description={option.description} />
          ))}
        </div>

        {mode !== 'off' && (
          <>
            <Block title="Who progresses">
              <WhoProgresses progression={progression} groups={groups} names={names} onChange={setMembers} />
            </Block>

            <Block title="Experience">
              <div className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
                <label className="flex w-40 flex-col gap-1">
                  <span className="text-xs text-text-muted">Level 2 needs</span>
                  <span className="field-input flex h-10 items-center gap-2 px-3"><NumberInput aria-label="XP for level 2" className="min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none" min={1} value={config.xp.firstGoal} onChange={firstGoal => draftXp({ firstGoal })} onBlur={commit} /><span className="text-xs text-text-subtle">XP</span></span>
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-text-muted">Each next level</span>
                  <SegmentedControl className="!flex-nowrap" label="How the goal grows" value={config.xp.growth} onChange={growth => saveConfig({ xp: { ...config.xp, growth } })} options={GROWTH_OPTIONS} />
                </label>
                {config.xp.growth !== 'same' ? (
                  <NumberInput aria-label="How much it grows" className="field-input h-10 w-24 px-3 text-sm tabular-nums" min={0} integer={config.xp.growth === 'add'} value={config.xp.growthAmount} onChange={growthAmount => draftXp({ growthAmount })} onBlur={commit} />
                ) : null}
                <label className="flex w-28 flex-col gap-1">
                  <span className="text-xs text-text-muted">Highest level</span>
                  <MaxLevelInput value={config.xp.maxLevel} onCommit={maxLevel => saveConfig({ xp: { ...configRef.current.xp, maxLevel } })} />
                </label>
              </div>
              <Help className="tabular-nums">{xpExample(config.xp)}</Help>
              <Checkbox checked={config.xp.aiOnlyAdds} onChange={aiOnlyAdds => saveConfig({ xp: { ...config.xp, aiOnlyAdds } })} label="The AI only adds XP" />
              <Help className="-mt-2 pl-8">It can never take XP away. You still can, on the sheet.</Help>
              <div className="flex flex-col gap-1.5">
                <FieldLabel>When to give XP</FieldLabel>
                <textarea className="field-input min-h-16 resize-none px-3 py-2.5 text-sm leading-relaxed custom-scrollbar" value={config.xp.guidance} onChange={event => draftXp({ guidance: event.target.value })} onBlur={commit} placeholder="Winning fights, finishing quests and clever solutions. About 50 for a small win, 300 for a quest." />
              </div>
            </Block>

            <Block title="Attributes" aside="Numbers that describe what a character is good at.">
              <TraitTable
                traits={traits}
                onEdit={trait => setTraitDraft(trait)}
                onDelete={trait => setDeletingTrait(trait)}
                onStart={(trait, initialValue) => saveTrait({ ...trait, initialValue })}
              />
              <Button variant="ghost" size="sm" icon={Plus} className="self-start" onClick={() => setTraitDraft({ name: '', description: '', initialValue: 10, minimum: 1, maximum: 20 })}>Add attribute</Button>
              <div className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface-inset p-3.5">
                <span className="text-[0.8125rem] font-semibold text-text-secondary">How attributes change</span>
                <CheckRow checked={config.attributes.aiRaises} onChange={aiRaises => saveConfig({ attributes: { ...config.attributes, aiRaises } })} label="The AI raises them when the story earns it" help="Training, a hard-won fight, a new level. One point at a time, and it says why." />
                {config.attributes.aiRaises && (
                  <div className="flex flex-col gap-1.5 pl-8">
                    <FieldLabel>When attributes go up</FieldLabel>
                    <textarea className="field-input min-h-16 resize-none px-3 py-2.5 text-sm leading-relaxed custom-scrollbar" value={config.attributes.guidance} onChange={event => draftAttributes({ guidance: event.target.value })} onBlur={commit} placeholder="Only after weeks of focused training or a fight that pushed them to the limit. An ordinary fight does not count. Above 15, only rare milestones." />
                    <Help>Leave it empty and the AI uses a general rule: lasting training, a hard-won lesson or a breakthrough.</Help>
                  </div>
                )}
                <CheckRow checked={config.attributes.aiLowers} onChange={aiLowers => saveConfig({ attributes: { ...config.attributes, aiLowers } })} label="The AI can also lower them" help="For lasting injuries, curses or age. Off by default." />
                <Help>You can change any attribute, level or XP on the character's sheet whenever you want.</Help>
              </div>
            </Block>

            <Block title="On each new level" aside="Optional">
              {rewards.length > 0 && (
                <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
                  {rewards.map(reward => {
                    const definition = definitionById.get(reward.definitionId);
                    return (
                      <div key={reward.definitionId} className="flex items-center gap-2 py-2 pl-3.5 pr-2">
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[0.1875rem]" style={{ backgroundColor: definition.color }} />
                        <span className="min-w-0 flex-1 text-[0.8125rem] text-text-secondary">
                          {definition.name}: {reward.maximumIncrease ? <>highest value <b className="font-semibold text-text-primary">+{formatNumber(reward.maximumIncrease)}</b></> : null}{reward.maximumIncrease && reward.refill ? ' and ' : ''}{reward.refill ? 'refill' : ''}
                        </span>
                        <IconButton icon={Trash2} size="sm" tone="danger" label={`Remove the ${definition.name} reward`} onClick={() => saveConfig({ rewards: config.rewards.filter(item => item.definitionId !== reward.definitionId) })} />
                      </div>
                    );
                  })}
                </div>
              )}
              {rewardDraft ? (
                <div className="flex flex-wrap items-center gap-2 rounded-card border border-border-subtle bg-tint/[0.02] p-3">
                  <SearchableSelect className="min-w-[11rem] flex-1" value={rewardDraft.definitionId} onChange={definitionId => setRewardDraft(current => ({ ...current, definitionId }))} options={definitions.filter(definition => !rewards.some(reward => reward.definitionId === definition.id)).map(definition => ({ id: definition.id, label: definition.name, color: definition.color }))} placeholder="Resource" ariaLabel="Resource to reward" />
                  <label className="flex items-center gap-1.5 text-xs text-text-muted">Highest +<NumberInput className="field-input h-10 w-18 px-2.5 text-sm tabular-nums" min={0} value={rewardDraft.maximumIncrease} onChange={maximumIncrease => setRewardDraft(current => ({ ...current, maximumIncrease }))} /></label>
                  <Checkbox checked={rewardDraft.refill} onChange={refill => setRewardDraft(current => ({ ...current, refill }))} label="Refill" />
                  <Button variant="subtle" size="sm" onClick={() => setRewardDraft(null)}>Cancel</Button>
                  <Button variant="primary" size="sm" disabled={!rewardDraft.definitionId || (!rewardDraft.maximumIncrease && !rewardDraft.refill)} onClick={async () => { await saveConfig({ rewards: [...config.rewards, rewardDraft] }); setRewardDraft(null); }}>Add</Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" icon={Plus} className="self-start" disabled={!definitions.length} onClick={() => setRewardDraft({ definitionId: '', maximumIncrease: 10, refill: true })}>Add a resource reward</Button>
              )}
              {!definitions.length && <Help>Create a resource first, such as HP, to reward it on each level.</Help>}
            </Block>

            <PolicyBlock label="How AI changes are applied" help="Covers XP and attribute changes. Review shows each one in Narrative State first." value={config.policy} onChange={policy => saveConfig({ policy })} />
          </>
        )}
      </div>

      {traitDraft && <TraitModal initial={traitDraft} onCancel={() => setTraitDraft(null)} onSave={saveTrait} />}
      {deletingTrait && (
        <ConfirmDialog
          tone="danger"
          title={`Delete ${deletingTrait.name}?`}
          message={`Every character loses ${deletingTrait.name}, with what they had in it. Race bonuses for it go too.`}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDeletingTrait(null) },
            { label: 'Delete', variant: 'danger', autoFocus: true, onClick: () => removeTrait(deletingTrait) }
          ]}
          onClose={() => setDeletingTrait(null)}
        />
      )}
    </ConfigSection>
  );
}

const TYPE_LINES = { Characters: 'All characters', Creatures: 'All specific beings' };
const GROUP_KINDS = {
  race: { label: 'Race', type: 'Races', list: 'races' },
  species: { label: 'Species', type: 'Creatures', list: 'species' }
};
const lineKey = member => `${member.targetType}:${member.targetId}`;

const PROGRESS_WORDING = {
  label: 'Who progresses',
  included: 'Progresses',
  everyone: count => `Every character and specific being grows: ${count} now, and anyone created later. The AI only hears about those in the scene or named in the turn.`,
  chosen: count => `${count > 1 ? `${count} characters progress. ` : ''}Add one character, or every member of a race or species. Everyone else is a fixed NPC: no level, no XP, nothing sent to the AI about it.`,
  noPlayer: 'Choose a player character in Configuration, Scene. They always progress.'
};

/**
 * The player always grows. Everyone else grows through a line: one character, every member of a
 * race or species, every character or specific being, or everyone at once. Skills reuse it for
 * who learns, with their own wording.
 */
export function WhoProgresses({ progression, groups, names, onChange, wording = PROGRESS_WORDING }) {
  const [adding, setAdding] = useState(false);
  const members = progression.members || [];
  const everyone = members.some(member => member.targetType === 'everyone');
  const player = progression.playerEntityId;
  const lines = members.filter(member => member.targetType !== 'everyone' && !(member.targetType === 'entity' && member.targetId === player));
  const progressing = new Set(progression.progressingIds || progression.learningIds || []);
  const count = progressing.size;
  const actorType = new Map(groups.actors.map(entity => [entity.id, entity.type]));
  const taken = new Set(lines.map(lineKey));

  const describe = member => {
    if (member.targetType === 'type') return { name: TYPE_LINES[member.targetId] || member.targetId, dot: meta(member.targetId).dot };
    if (member.targetType === 'entity') return { name: names.get(member.targetId) || 'Unknown', dot: meta(actorType.get(member.targetId) || 'Characters').dot };
    const kind = GROUP_KINDS[member.targetType];
    return { name: names.get(member.targetId) || 'Unknown', dot: meta(kind.type).dot, kind: kind.label };
  };
  const options = [
    ...Object.entries(TYPE_LINES).map(([type, label]) => ({ id: `type:${type}`, label, group: 'Everyone', dotClassName: meta(type).dot })),
    ...Object.entries(GROUP_KINDS).flatMap(([targetType, kind]) => (groups[kind.list] || []).map(entity => ({
      id: `${targetType}:${entity.id}`, label: entity.canonicalName, group: `Whole ${kind.label.toLowerCase()}`, dotClassName: meta(kind.type).dot
    }))),
    ...groups.actors.map(entity => ({ id: `entity:${entity.id}`, label: entity.canonicalName, group: meta(entity.type).label, dotClassName: meta(entity.type).dot }))
  ].map(option => {
    if (taken.has(option.id)) return { ...option, disabled: true, disabledLabel: 'Added' };
    const [type, id] = option.id.split(':');
    return type === 'entity' && progressing.has(id) ? { ...option, disabled: true, disabledLabel: wording.included } : option;
  });
  const add = key => {
    setAdding(false);
    if (!key) return;
    const index = key.indexOf(':');
    onChange([...members, { targetType: key.slice(0, index), targetId: key.slice(index + 1) }]);
  };
  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-control bg-tint/[0.06] pl-2.5 text-[0.8125rem] text-text-primary';

  return (
    <>
      <SegmentedControl
        className="self-start"
        label={wording.label}
        value={everyone ? 'everyone' : 'chosen'}
        onChange={value => onChange(value === 'everyone' ? [...members, { targetType: 'everyone', targetId: '' }] : members.filter(member => member.targetType !== 'everyone'))}
        options={[{ value: 'chosen', label: 'Only who I choose' }, { value: 'everyone', label: 'Everyone' }]}
      />
      {everyone ? (
        <Help>{wording.everyone(count)}</Help>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {player && (
              <span className={`${chip} pr-2.5`}>
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${meta(actorType.get(player) || 'Characters').dot}`} />
                {names.get(player) || 'Unknown'}
                <span className="inline-flex items-center gap-1 text-xs text-text-subtle"><Gamepad2 aria-hidden="true" className="h-3.5 w-3.5" />You play them</span>
              </span>
            )}
            {lines.map(member => {
              const view = describe(member);
              return (
                <span key={lineKey(member)} className={`${chip} pr-1`}>
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${view.dot}`} />
                  {view.name}
                  {view.kind && <span className="text-xs text-text-subtle">whole {view.kind.toLowerCase()}</span>}
                  <button type="button" onClick={() => onChange(members.filter(item => lineKey(item) !== lineKey(member)))} aria-label={`Remove ${view.name}`} className="inline-flex h-5 w-5 items-center justify-center rounded text-text-subtle hover:bg-tint/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
                </span>
              );
            })}
            {adding ? (
              <SearchableSelect
                className="w-80"
                value=""
                onChange={add}
                onClose={() => setAdding(false)}
                options={options}
                placeholder={`Add ${wording.label.toLowerCase()}`}
                searchPlaceholder="Search characters, races, species"
                ariaLabel={`Add ${wording.label.toLowerCase()}`}
                searchInTrigger
                autoOpen
              />
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="inline-flex h-7 items-center gap-1 rounded-control border border-dashed border-border-default px-2.5 text-xs font-semibold text-text-muted hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />Add
              </button>
            )}
          </div>
          <Help>{wording.chosen(count)}</Help>
        </>
      )}
      {!player && <p className="text-xs text-status-warning">{wording.noPlayer}</p>}
    </>
  );
}

// Empty means no highest level, which a number field cannot express.
function MaxLevelInput({ value, onCommit }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => setText(value ? String(value) : ''), [value]);
  const commit = () => {
    const number = Math.round(Number(text));
    const next = text.trim() && Number.isFinite(number) && number > 1 ? number : null;
    setText(next ? String(next) : '');
    if (next !== (value ?? null)) onCommit(next);
  };
  return (
    <input aria-label="Highest level" inputMode="numeric" className="field-input h-10 px-3 text-sm tabular-nums" value={text} placeholder="None" onChange={event => { if (/^\d*$/.test(event.target.value)) setText(event.target.value); }} onBlur={commit} onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const current = Number(text) || 1;
        const next = event.key === 'ArrowUp' ? current + 1 : current - 1;
        setText(next > 1 ? String(next) : '');
      }
    }} />
  );
}

export function Block({ title, aside, children }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <h3 className="flex-1 text-sm font-semibold text-text-primary">{title}</h3>
        {aside && <Help>{aside}</Help>}
      </div>
      {children}
    </div>
  );
}

export function CheckRow({ checked, onChange, label, help }) {
  return (
    <div>
      <Checkbox checked={checked} onChange={onChange} label={label} />
      <Help className="pl-8">{help}</Help>
    </div>
  );
}

export function PolicyBlock({ label, help, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-5">
      <span className="min-w-[14rem] flex-1">
        <span className="block text-[0.8125rem] font-semibold text-text-secondary">{label}</span>
        <Help>{help}</Help>
      </span>
      <SegmentedControl label={label} value={value} onChange={onChange} options={POLICY_OPTIONS} />
    </div>
  );
}

const TRAIT_COLUMNS = 'grid-cols-[9rem_4.5rem_5.5rem_minmax(0,1fr)_2rem]';

function TraitTable({ traits, onEdit, onDelete, onStart }) {
  if (!traits.length) {
    return <p className="rounded-card border border-dashed border-border-subtle px-4 py-5 text-center text-[0.8125rem] text-text-muted">No attributes yet.</p>;
  }
  return (
    <div className="overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
      <div className={`grid ${TRAIT_COLUMNS} items-center gap-3 bg-tint/[0.025] py-2 pl-3.5 pr-2 text-xs font-semibold text-text-subtle`}>
        <span>Attribute</span>
        <span>Starts at</span>
        <span>Range</span>
        <span>What it means to the AI</span>
        <span />
      </div>
      {traits.map(trait => (
        <TraitRow key={trait.id} trait={trait} onEdit={() => onEdit(trait)} onDelete={() => onDelete(trait)} onStart={value => onStart(trait, value)} />
      ))}
    </div>
  );
}

function TraitRow({ trait, onEdit, onDelete, onStart }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const startRef = useRef(trait.initialValue);
  return (
    <div className={`grid ${TRAIT_COLUMNS} items-center gap-3 border-t border-border-subtle py-1.5 pl-3.5 pr-2`}>
      <span className="truncate text-[0.8125rem] font-semibold text-text-secondary">{trait.name}</span>
      <NumberInput aria-label={`${trait.name} starts at`} className="field-input h-8 px-2 text-right text-[0.8125rem] tabular-nums" min={trait.minimum} max={trait.maximum} value={trait.initialValue} onChange={value => { startRef.current = value; }} onBlur={() => { if (startRef.current !== trait.initialValue) onStart(startRef.current); }} />
      <span className="text-xs tabular-nums text-text-muted">{formatNumber(trait.minimum)} to {formatNumber(trait.maximum)}</span>
      <span className="truncate text-xs text-text-muted" data-tooltip={trait.description?.length > 70 ? trait.description : undefined}>{trait.description || '—'}</span>
      <IconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label={`${trait.name} actions`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} />
      <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label={`${trait.name} actions`} className="w-48">
        <MenuItem icon={Pencil} label="Edit" onSelect={() => { setOpen(false); onEdit(); }} />
        <MenuSeparator />
        <MenuItem icon={Trash2} label="Delete" danger onSelect={() => { setOpen(false); onDelete(); }} />
      </Menu>
    </div>
  );
}

function TraitModal({ initial, onCancel, onSave }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  const valid = draft.name?.trim() && Number(draft.maximum) > Number(draft.minimum)
    && Number(draft.initialValue) >= Number(draft.minimum) && Number(draft.initialValue) <= Number(draft.maximum);
  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  };
  return (
    <Modal title={initial.id ? `Edit ${initial.name}` : 'New attribute'} icon={Sprout} iconClassName="text-text-secondary" onClose={() => { if (!saving) onCancel(); }} size="md">
      <form onSubmit={submit} className="flex flex-col gap-4 px-6 py-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-text-secondary">Name</span>
          <input autoFocus className="field-input h-10 px-3 text-sm" value={draft.name || ''} onChange={event => set({ name: event.target.value })} placeholder="Strength" />
        </label>
        <div className="grid grid-cols-3 gap-2.5">
          {[['initialValue', 'Starts at'], ['minimum', 'Lowest'], ['maximum', 'Highest']].map(([field, label]) => (
            <label key={field} className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">{label}</span>
              <NumberInput className="field-input h-10 px-3 text-sm tabular-nums" value={draft[field]} onChange={value => set({ [field]: value })} />
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-text-secondary">What it means to the AI</span>
          <textarea className="field-input min-h-20 resize-none px-3 py-2.5 text-sm leading-relaxed custom-scrollbar" value={draft.description || ''} onChange={event => set({ description: event.target.value })} placeholder="Lifting, forcing doors, melee damage." />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!valid}>{initial.id ? 'Save' : 'Add attribute'}</Button>
        </div>
      </form>
    </Modal>
  );
}

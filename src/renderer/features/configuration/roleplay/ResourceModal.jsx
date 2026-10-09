import { useId, useState } from 'react';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import Checkbox from '../../../components/ui/Checkbox';
import ColorField from '../../../components/ui/ColorField';
import NumberInput from '../../../components/ui/NumberInput';
import SegmentedControl from '../../../components/ui/SegmentedControl';
import Toggle from '../../../components/ui/Toggle';
import { Gauge } from 'lucide-react';
import { ChoiceCard, FieldLabel, Help } from '../ConfigParts';

export const EMPTY_RESOURCE = {
  name: '', key: '', description: '', color: '#dc2626', minimum: 0, maximum: 100, initialValue: 100, unit: '',
  appliesTo: ['Characters'], updatePolicy: 'review', enabled: true, scope: 'everyone', lowestEffect: '',
  timeRate: 0, timeDirection: 'recovers', timePeriod: 'hour'
};

const POLICY_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'review', label: 'Review everything' },
  { value: 'automatic', label: 'Automatic' }
];

const subLabel = 'text-xs text-text-muted';
export const KIND_LABELS = { Characters: 'Characters', Creatures: 'Specific beings' };

/** Create or edit one resource: who has it, its range, what its lowest means, and how it moves. */
export default function ResourceModal({ initial, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => ({ ...EMPTY_RESOURCE, ...initial }));
  const [saving, setSaving] = useState(false);
  const [timeOn, setTimeOn] = useState(() => Number(initial?.timeRate) > 0);
  const formId = useId();
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  const editing = Boolean(initial?.id);
  const name = draft.name.trim() || 'it';
  const toggleKind = kind => set({ appliesTo: draft.appliesTo.includes(kind) ? draft.appliesTo.filter(item => item !== kind) : [...draft.appliesTo, kind] });
  const rangeValid = Number(draft.maximum) > Number(draft.minimum)
    && Number(draft.initialValue) >= Number(draft.minimum) && Number(draft.initialValue) <= Number(draft.maximum);
  const kindsValid = draft.scope === 'chosen' || draft.appliesTo.length > 0;
  const rate = Math.max(0, Number(draft.timeRate) || 0);
  const example = rate > 0
    ? draft.timeDirection === 'drains'
      ? `A day without rest takes ${formatAmount(rate * (draft.timePeriod === 'day' ? 1 : 24))} ${name}.`
      : `An eight-hour rest gives back ${formatAmount(draft.timePeriod === 'day' ? rate / 3 : rate * 8)} ${name}.`
    : '';

  const submit = async event => {
    event?.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...draft, timeRate: timeOn ? rate : 0 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? `Edit ${initial.name}` : 'New resource'} icon={Gauge} iconClassName="text-text-secondary" onClose={() => { if (!saving) onCancel(); }} size="xl">
      <form id={formId} onSubmit={submit} className="flex max-h-[78vh] flex-col">
        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5 custom-scrollbar">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${formId}-name`}>Name</FieldLabel>
              <input id={`${formId}-name`} autoFocus className="field-input h-10 px-3 text-sm" value={draft.name} onChange={event => set({ name: event.target.value })} placeholder="Health, Mana, Sanity" />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Colour</FieldLabel>
              <ColorField ariaLabel="Resource colour" value={draft.color} onChange={color => set({ color })} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <FieldLabel>Who has it</FieldLabel>
            <div role="radiogroup" aria-label="Who has it" className="flex flex-col gap-2">
              <div>
                <ChoiceCard name={`${formId}-scope`} selected={draft.scope === 'everyone'} onSelect={() => set({ scope: 'everyone', appliesTo: draft.appliesTo.length ? draft.appliesTo : ['Characters'] })} title="Everyone of a kind" description="Every character or specific being gets it with the starting value." />
                {draft.scope === 'everyone' && (
                  <div className="mt-2 flex flex-wrap gap-2 pl-[1.625rem]">
                    {['Characters', 'Creatures'].map(kind => (
                      <span key={kind} className="inline-flex h-8 items-center rounded-control border border-border-default px-2.5">
                        <Checkbox checked={draft.appliesTo.includes(kind)} onChange={() => toggleKind(kind)} label={KIND_LABELS[kind]} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <ChoiceCard name={`${formId}-scope`} selected={draft.scope === 'chosen'} onSelect={() => set({ scope: 'chosen' })} title="Only who I choose" description="No one has it until you add them. For a mage's Mana, or a curse only one person carries." />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            <span className="text-[0.8125rem] font-semibold text-text-muted">Values</span>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <NumberLabel label="Lowest" value={draft.minimum} onChange={minimum => set({ minimum })} />
              <NumberLabel label="Full at" value={draft.maximum} onChange={maximum => set({ maximum })} />
              <NumberLabel label="Starts at" value={draft.initialValue} onChange={initialValue => set({ initialValue })} />
              <label className="flex flex-col gap-1">
                <span className={subLabel}>Unit</span>
                <input className="field-input h-10 px-3 text-sm" value={draft.unit || ''} onChange={event => set({ unit: event.target.value })} placeholder="optional" />
              </label>
            </div>
            <Help>Full at is where a new holder's bar is full. It is not a ceiling: level rewards and edits on a sheet can raise one character's bar past it.</Help>
            {!rangeValid && <p className="text-xs text-status-danger">Full at must be above the lowest, and Starts at must be between them.</p>}
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={`${formId}-lowest`}>At the lowest</FieldLabel>
              <input id={`${formId}-lowest`} className="field-input h-10 px-3 text-sm" value={draft.lowestEffect || ''} onChange={event => set({ lowestEffect: event.target.value })} placeholder="Unconscious. Cannot act until someone helps." />
              <Help>What it means to hit the bottom. The AI follows it in the story.</Help>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            <span className="text-[0.8125rem] font-semibold text-text-muted">Changes</span>
            <div>
              <FieldLabel>How the AI changes it</FieldLabel>
              <SegmentedControl className="mt-1.5" label="How the AI changes it" value={draft.updatePolicy} onChange={updatePolicy => set({ updatePolicy })} options={POLICY_OPTIONS} />
              <Help className="mt-1.5">{editing ? 'Manual keeps it out of what the AI is told it can change.' : 'Starts with the rule set in Configuration, Narrative State.'}</Help>
            </div>
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
          </div>

          <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-4">
            <FieldLabel htmlFor={`${formId}-meaning`}>What it means to the AI</FieldLabel>
            <textarea id={`${formId}-meaning`} className="field-input min-h-20 resize-none px-3 py-2.5 text-sm leading-relaxed custom-scrollbar" value={draft.description || ''} onChange={event => set({ description: event.target.value })} placeholder="What makes it go down, and what brings it back." />
            <Help>Sent to the narrator and to Narrative State.</Help>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-4">
          <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!draft.name.trim() || !rangeValid || !kindsValid}>{editing ? 'Save resource' : 'Create resource'}</Button>
        </div>
      </form>
    </Modal>
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

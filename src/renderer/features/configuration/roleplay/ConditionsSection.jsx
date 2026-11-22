import { useRef, useState } from 'react';
import { Check, HeartPulse, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import Button from '../../../components/ui/Button';
import ColorField from '../../../components/ui/ColorField';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import IconButton from '../../../components/ui/IconButton';
import Modal from '../../../components/ui/Modal';
import NumberInput from '../../../components/ui/NumberInput';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import { Menu, MenuItem, MenuSeparator } from '../../../components/ui/Menu';
import ResizableTextarea from '../../../components/ui/ResizableTextarea';
import { ConfigSection, FieldLabel, Help, SettingsList, SwitchRow } from '../ConfigParts';
import { Block, CheckRow, PolicyBlock } from './ProgressionSection';

const NO_RESOURCE = '__none';
const EMPTY_CONDITION = {
  name: '', description: '', color: '#a855f7', durationMinutes: null, sleepMinutes: null, restMinutes: null,
  endsWhen: '', triggerDefinitionId: null, triggerBelowPercent: 25
};

/** How a condition ends, in a few words, for the list. */
export function describeConditionRules(condition, resourceNames = new Map()) {
  return [
    condition.triggerDefinitionId && resourceNames.has(condition.triggerDefinitionId)
      ? `while ${resourceNames.get(condition.triggerDefinitionId)} is below ${formatNumber(condition.triggerBelowPercent)}%`
      : '',
    condition.durationMinutes ? `wears off after ${formatMinutes(condition.durationMinutes)}` : '',
    condition.sleepMinutes ? `passes after ${formatMinutes(condition.sleepMinutes)} of sleep` : '',
    condition.restMinutes ? `passes after ${formatMinutes(condition.restMinutes)} of rest` : '',
    condition.endsWhen ? `ends ${condition.endsWhen}` : ''
  ].filter(Boolean).join(' · ');
}

export function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const days = Math.floor(value / 1440);
  const hours = Math.floor((value % 1440) / 60);
  const rest = value % 60;
  return [days ? `${days} d` : '', hours ? `${hours} h` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ') || '0 min';
}

function formatNumber(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value) * 10) / 10) : '';
}

/**
 * What can happen to a character for a while: bleeding, a curse, an overload. Each says what it
 * does and how it ends; the clock, sleep and a resource's line end most of them on their own.
 */
export default function ConditionsSection({ sectionRef, workspaceId, api, showToast, conditions, changes, definitions, names, onChanged, embedded = false }) {
  const [draft, setDraft] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const catalog = conditions.catalog || [];
  const resourceNames = new Map((definitions || []).map(definition => [definition.id, definition.name]));
  const proposals = new Map((changes || [])
    .filter(change => change.status === 'pending' && catalog.some(condition => condition.id === change.conditionId && condition.status === 'proposed'))
    .map(change => [change.conditionId, change]));

  const persist = async patch => {
    const result = await api.saveRoleplayConditionSettings(workspaceId, patch);
    if (!result?.success) return showToast(result?.error || 'Could not save conditions.', 'error');
    await onChanged();
  };
  const save = async condition => {
    const result = await api.saveRoleplayCondition(workspaceId, condition);
    if (!result?.success) return showToast(result?.error || 'Could not save the condition.', 'error');
    setDraft(null);
    await onChanged();
  };
  const remove = async condition => {
    const result = await api.deleteRoleplayCondition(workspaceId, condition.id);
    setDeleting(null);
    if (!result?.success) return showToast(result?.error || 'Could not delete it.', 'error');
    await onChanged();
  };
  const resolve = async (change, decision) => {
    const result = await api.resolveRoleplayConditionChange(workspaceId, change.id, decision);
    if (!result?.success) return showToast(result?.error || 'Could not resolve it.', 'error');
    await onChanged();
  };
  const holders = conditionId => (conditions.active || []).filter(condition => condition.conditionId === conditionId).length;

  return (
    <ConfigSection
      id="conditions"
      sectionRef={sectionRef}
      embedded={embedded}
      icon={HeartPulse}
      title="Conditions"
      description="What can happen to a character for a while, such as bleeding, a curse or an overload. Each one says what it does and how it ends."
    >
      <div className="flex flex-col gap-5">
        <SettingsList>
          <SwitchRow
            label="Use conditions in this world"
            description="The AI starts a condition when the story shows its cause. Time, sleep and a resource's line end them on their own."
            checked={conditions.enabled}
            onChange={enabled => persist({ enabled })}
          />
        </SettingsList>

        {conditions.enabled && (
          <>
            <Block title={<>Conditions{catalog.length > 0 && <span className="ml-1.5 font-normal tabular-nums text-text-subtle">{catalog.length}</span>}</>} aside="The name and what it does are what the narrator plays.">
              {catalog.length ? (
                <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
                  {catalog.map(condition => (
                    <ConditionRow
                      key={condition.id}
                      condition={condition}
                      rules={describeConditionRules(condition, resourceNames)}
                      holders={holders(condition.id)}
                      proposal={proposals.get(condition.id)}
                      proposedFor={names.get(proposals.get(condition.id)?.entityId)}
                      onEdit={() => setDraft(condition)}
                      onDelete={() => setDeleting(condition)}
                      onResolve={resolve}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-card border border-dashed border-border-subtle px-4 py-5 text-center text-[0.8125rem] text-text-muted">No conditions yet.</p>
              )}
              <div><Button variant="ghost" size="sm" icon={Plus} onClick={() => setDraft({ ...EMPTY_CONDITION })}>Add condition</Button></div>
            </Block>

            <Block title="How the AI changes conditions">
              <div className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface-inset p-3.5">
                <CheckRow checked={conditions.aiCreates} onChange={aiCreates => persist({ aiCreates })} label="The AI can propose new conditions" help="When the story gives someone a lasting condition nothing here covers. A new condition always waits for your review before it joins the list." />
              </div>
            </Block>

            <PolicyBlock label="How AI changes are applied" help="Covers starting, worsening and ending a condition. One tied to a resource, and one the clock or sleep ends, always applies on its own." value={conditions.updatePolicy} onChange={updatePolicy => persist({ updatePolicy })} />
          </>
        )}
      </div>

      {draft && <ConditionModal initial={draft} definitions={definitions || []} onCancel={() => setDraft(null)} onSave={save} />}
      {deleting && (
        <ConfirmDialog
          tone="danger"
          title={`Delete ${deleting.name}?`}
          message={`Everyone who has ${deleting.name} loses it.`}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
            { label: 'Delete', variant: 'danger', autoFocus: true, onClick: () => remove(deleting) }
          ]}
          onClose={() => setDeleting(null)}
        />
      )}
    </ConfigSection>
  );
}

function ConditionRow({ condition, rules, holders, proposal, proposedFor, onEdit, onDelete, onResolve }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef(null);
  const proposed = condition.status === 'proposed';
  const detail = proposed && proposal
    ? [proposedFor ? `For ${proposedFor}.` : '', proposal.reason, condition.description].filter(Boolean).join(' ')
    : [condition.description, rules].filter(Boolean).join(' · ') || '—';
  return (
    <div className={`flex items-center gap-2.5 py-2 pl-3 pr-2 ${proposed ? 'bg-status-warning/[0.04]' : ''}`}>
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: condition.color }} />
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[0.8125rem] font-semibold text-text-secondary">{condition.name}</span>
          {holders > 0 && <span className="shrink-0 rounded-full bg-tint/[0.06] px-2 py-0.5 text-xs font-medium tabular-nums text-text-muted">{holders} {holders === 1 ? 'has it' : 'have it'}</span>}
          {proposed && <span className="shrink-0 rounded-full bg-status-warning/12 px-2 py-0.5 text-xs font-semibold text-status-warning">Proposed by the AI</span>}
        </span>
        <span className="block truncate text-xs text-text-muted" data-tooltip={detail.length > 90 ? detail : undefined}>{detail}</span>
      </div>
      {proposed && proposal ? (
        <>
          <Button variant="subtle" size="sm" icon={X} onClick={() => onResolve(proposal, 'rejected')}>Dismiss</Button>
          <Button variant="ghost" size="sm" icon={Check} onClick={() => onResolve(proposal, 'approved')}>Add</Button>
        </>
      ) : (
        <>
          <IconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label={`${condition.name} actions`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)} />
          <Menu anchorRef={anchorRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={`${condition.name} actions`} className="w-48">
            <MenuItem icon={Pencil} label="Edit" onSelect={() => { setMenuOpen(false); onEdit(); }} />
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete" danger onSelect={() => { setMenuOpen(false); onDelete(); }} />
          </Menu>
        </>
      )}
    </div>
  );
}

// Hours in the form, minutes in storage: an hour and a half is 1.5.
const toHours = minutes => (minutes ? Math.round((Number(minutes) / 60) * 100) / 100 : '');
const toMinutes = hours => (hours === '' || hours === null || hours === undefined || !(Number(hours) > 0) ? null : Math.round(Number(hours) * 60));

function ConditionModal({ initial, definitions, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => ({
    ...EMPTY_CONDITION,
    ...initial,
    durationHours: toHours(initial.durationMinutes),
    sleepHours: toHours(initial.sleepMinutes),
    restHours: toHours(initial.restMinutes)
  }));
  const [saving, setSaving] = useState(false);
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    try {
      const { durationHours, sleepHours, restHours, ...condition } = draft;
      await onSave({
        ...condition,
        durationMinutes: toMinutes(durationHours),
        sleepMinutes: toMinutes(sleepHours),
        restMinutes: toMinutes(restHours),
        triggerDefinitionId: draft.triggerDefinitionId || null,
        triggerBelowPercent: draft.triggerDefinitionId ? Number(draft.triggerBelowPercent) || 0 : null
      });
    } finally {
      setSaving(false);
    }
  };
  const resourceOptions = [{ id: NO_RESOURCE, label: 'No resource' }, ...definitions.map(definition => ({ id: definition.id, label: definition.name }))];
  return (
    <Modal title={initial.id ? `Edit ${initial.name}` : 'New condition'} icon={HeartPulse} iconClassName="text-text-secondary" onClose={() => { if (!saving) onCancel(); }} size="lg">
      <form onSubmit={submit} className="flex flex-col gap-4 px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-semibold text-text-secondary">Name</span>
            <input autoFocus className="field-input h-10 px-3 text-sm" value={draft.name || ''} onChange={event => set({ name: event.target.value })} placeholder="Bleeding" />
          </label>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>Colour</FieldLabel>
            <ColorField ariaLabel="Condition colour" value={draft.color} onChange={color => set({ color })} />
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-text-secondary">What it does</span>
          <ResizableTextarea storageKey="rules-condition-meaning" value={draft.description || ''} onChange={event => set({ description: event.target.value })} placeholder="Loses blood with every effort; weaker and slower until the wound is closed." />
          <Help>The narrator plays this while someone has it.</Help>
        </label>

        <div className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface-inset p-3.5">
          <span className="text-[0.8125rem] font-semibold text-text-secondary">How it ends</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <HoursField label="Wears off after" value={draft.durationHours} onChange={durationHours => set({ durationHours })} suffix="hours" />
            <HoursField label="Passes after" value={draft.sleepHours} onChange={sleepHours => set({ sleepHours })} suffix="hours of sleep" />
            <HoursField label="or" value={draft.restHours} onChange={restHours => set({ restHours })} suffix="hours of rest" />
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-text-muted">Or when this happens in the story</span>
            <input className="field-input h-10 px-3 text-sm" value={draft.endsWhen || ''} onChange={event => set({ endsWhen: event.target.value })} placeholder="when the wound is treated" />
          </label>
          <Help>Leave a field empty when it does not end that way. Whichever comes first ends it.</Help>
        </div>

        <div className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface-inset p-3.5">
          <span className="text-[0.8125rem] font-semibold text-text-secondary">Tied to a resource</span>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <SearchableSelect clearable={false} value={draft.triggerDefinitionId || NO_RESOURCE} onChange={value => set({ triggerDefinitionId: value === NO_RESOURCE ? null : value })} options={resourceOptions} placeholder="No resource" ariaLabel="Resource" />
            </div>
            {draft.triggerDefinitionId && (
              <label className="flex items-center gap-2 text-[0.8125rem] text-text-secondary">
                below
                <NumberInput aria-label="Percentage" className="field-input h-10 w-20 px-3 text-right text-sm tabular-nums" value={draft.triggerBelowPercent} min={0} integer={false} onChange={triggerBelowPercent => set({ triggerBelowPercent })} />
                % of its maximum
              </label>
            )}
          </div>
          <Help>It starts by itself when the resource falls below the line, and ends when it is back above.</Help>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!draft.name?.trim()}>{initial.id ? 'Save' : 'Add condition'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function HoursField({ label, value, onChange, suffix }) {
  return (
    <label className="flex items-center gap-2 text-[0.8125rem] text-text-secondary">
      {label}
      <NumberInput aria-label={`${label} ${suffix}`} className="field-input h-10 w-20 px-3 text-right text-sm tabular-nums" value={value} min={0} integer={false} nullable onChange={onChange} />
      {suffix}
    </label>
  );
}

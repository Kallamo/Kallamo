import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Check, History, Pencil, Plus, RotateCcw } from 'lucide-react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import NumberInput from '../../components/ui/NumberInput';
import { meta } from './worldbuildConfig';
import HistoryList from '../configuration/roleplay/HistoryList';

const PROGRESS_COLOR = 'var(--color-entity-event)';
const numberField = 'wb-input rounded-md border border-border-default bg-surface-input px-2 text-right tabular-nums text-text-primary focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';
const format = value => Number(value).toLocaleString('en-US');
const percent = (value, minimum, maximum) => Math.max(0, Math.min(100, ((value - minimum) / Math.max(1, maximum - minimum)) * 100));

// A number field that only reports valid numbers inside its range, for the sheet's edit mode.
function SheetNumber({ value, onChange, className, ariaLabel, min, max, integer = true }) {
  return (
    <NumberInput
      aria-label={ariaLabel}
      className={`${numberField} ${className}`}
      value={value}
      min={min}
      max={max}
      integer={integer}
      onChange={onChange}
    />
  );
}

/**
 * A character's live roleplay numbers, drawn as a sheet section. It reads like the rest of the
 * sheet; Edit turns every number into a field, saved together. What the AI wants to change
 * waits here and in Narrative State, and can be approved without editing.
 */
export default function WorldbuildRoleplayResources({ workspaceId, entity, entities = [], api, showToast, onOpen }) {
  const [resources, setResources] = useState([]);
  const [progress, setProgress] = useState(null);
  const [pending, setPending] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [history, setHistory] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const [resourceResult, progressResult, config] = await Promise.all([
      api.getRoleplayEntityResources?.(workspaceId, entity.id),
      api.getRoleplayEntityProgress?.(workspaceId, entity.id),
      api.getRoleplayConfiguration?.(workspaceId)
    ]);
    if (request !== requestRef.current) return;
    setResources(resourceResult?.resources || []);
    setProgress(progressResult?.success ? progressResult.progress : null);
    setDefinitions(config?.definitions || []);
    const traitNames = new Map((config?.traits || []).map(trait => [trait.id, trait.name]));
    const definitionNames = new Map((config?.definitions || []).map(definition => [definition.id, definition.name]));
    setPending([
      ...(config?.progressChanges || [])
        .filter(change => change.entityId === entity.id && change.status === 'pending')
        .map(change => ({ ...change, area: 'progress', traitName: traitNames.get(change.traitId) })),
      ...(config?.changes || [])
        .filter(change => change.entityId === entity.id && change.status === 'pending')
        .map(change => ({ ...change, area: 'resource', definitionName: definitionNames.get(change.definitionId) }))
    ]);
  }, [api, entity.id, workspaceId]);

  useEffect(() => { setDraft(null); load(); }, [load]);
  useEffect(() => {
    const refresh = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) load(); };
    window.addEventListener('roleplay-state-change', refresh);
    const unsubscribe = api.onRoleplayResourceChanges?.(payload => { if (payload?.workspaceId === workspaceId) load(); });
    return () => { window.removeEventListener('roleplay-state-change', refresh); unsubscribe?.(); };
  }, [api, load, workspaceId]);

  const progresses = Boolean(progress?.progresses);
  if (!resources.length && !progresses) return null;

  const levels = progresses && progress.mode === 'levels';
  const editing = Boolean(draft);
  const announce = () => window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));

  const startEdit = () => setDraft({
    level: progress?.level ?? 1,
    xp: progress?.xp ?? 0,
    attributes: Object.fromEntries((progress?.attributes || []).map(item => [item.traitId, item.value])),
    resources: Object.fromEntries(resources.map(item => [item.definitionId, item.current])),
    maximums: Object.fromEntries(resources.map(item => [item.definitionId, item.maximum]))
  });
  const setPart = (part, key, value) => setDraft(current => ({ ...current, [part]: { ...current[part], [key]: value } }));

  // Only what changed is written, so an untouched number keeps its race bonus and history quiet.
  const save = async () => {
    setSaving(true);
    try {
      const calls = [];
      if (levels && draft.level !== progress.level) calls.push(() => api.setRoleplayEntityProgress(workspaceId, entity.id, { kind: 'level', value: draft.level }));
      if (levels && draft.xp !== progress.xp) calls.push(() => api.setRoleplayEntityProgress(workspaceId, entity.id, { kind: 'xp', value: draft.xp }));
      if (levels) progress.attributes.forEach(item => {
        if (draft.attributes[item.traitId] !== item.value) calls.push(() => api.setRoleplayEntityProgress(workspaceId, entity.id, { kind: 'attribute', traitId: item.traitId, value: draft.attributes[item.traitId] }));
      });
      resources.forEach(item => {
        const maximumDelta = Number(draft.maximums[item.definitionId]) - item.maximum;
        if (draft.resources[item.definitionId] !== item.current || maximumDelta) calls.push(() => api.changeRoleplayResource({
          id: crypto.randomUUID(), workspaceId, definitionId: item.definitionId, entityId: entity.id,
          value: Number(draft.resources[item.definitionId]), maximumDelta, source: 'manual', provenanceId: 'worldbuild-entity-sheet'
        }));
      });
      for (const call of calls) {
        const result = await call();
        if (!result?.success) throw new Error(result?.error || 'Could not save a value.');
      }
      setDraft(null);
      await load();
      if (calls.length) announce();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const resolve = async (change, decision) => {
    const method = change.area === 'resource' ? api.resolveRoleplayResourceChange : api.resolveRoleplayProgressChange;
    const result = await method(workspaceId, change.id, decision);
    if (!result?.success) return showToast(result?.error || 'Could not resolve the change.', 'error');
    await load();
    announce();
  };
  const openHistory = async () => {
    const result = await api.getRoleplayEntityHistory?.(workspaceId, entity.id, 80);
    setHistory(result?.success ? result.history || [] : []);
  };

  const pendingByTrait = new Map(pending.filter(change => change.area === 'progress' && change.kind === 'attribute').map(change => [change.traitId, change]));
  const through = progress?.progressesThrough;
  const throughLabel = !through || through.targetType === 'player' || through.targetType === 'entity' ? ''
    : through.targetType === 'everyone' ? 'Progresses: everyone does'
      : through.targetType === 'type' ? `Progresses: all ${through.targetId === 'Creatures' ? 'specific beings' : 'characters'}`
        : `Progresses as a member of ${entities.find(item => item.id === through.targetId)?.canonicalName || 'a group'}`;
  const colors = new Map(definitions.map(definition => [definition.id, definition.color]));
  const headerButton = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

  return (
    <section className="ws-card overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
      <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle pl-4 pr-2">
        <Activity className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary">Roleplay state</h2>
        {editing ? <span className="text-xs text-text-subtle">Editing</span> : throughLabel && <span className="hidden truncate text-xs text-text-subtle sm:inline">{throughLabel}</span>}
        <span className="flex-1" />
        {!editing && (
          <>
            <button type="button" onClick={openHistory} className={headerButton}><History className="h-3.5 w-3.5" aria-hidden="true" />History</button>
            <button type="button" onClick={startEdit} aria-label="Edit Roleplay state" className={headerButton}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</button>
          </>
        )}
      </header>

      <div className="flex flex-col gap-4 p-4">
        {levels && (
          <div className="flex items-center gap-4 rounded-card border border-entity-event/25 bg-entity-event/[0.07] p-3.5">
            <div className="flex w-14 flex-col items-center gap-1">
              <span className="text-xs font-semibold text-entity-event">Level</span>
              {editing
                ? <SheetNumber ariaLabel="Level" value={draft.level} min={1} className="h-9 w-14 !text-center text-xl font-bold" onChange={value => setDraft(current => ({ ...current, level: value }))} />
                : <span className="text-2xl font-bold tabular-nums text-text-primary">{progress.level}</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[0.8125rem]">
                <span className="flex-1 font-semibold text-text-secondary">XP</span>
                {editing
                  ? <SheetNumber ariaLabel="XP" value={draft.xp} min={0} className="h-8 w-20 text-[0.8125rem]" onChange={value => setDraft(current => ({ ...current, xp: value }))} />
                  : <span className="tabular-nums text-text-primary">{format(progress.xp)}</span>}
                <span className="text-xs tabular-nums text-text-subtle">/ {progress.goal ? format(progress.goal) : '—'}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover/70"><div className="h-full rounded-full" style={{ width: `${progress.goal ? percent(progress.xp, 0, progress.goal) : 100}%`, backgroundColor: PROGRESS_COLOR }} /></div>
              <span className="mt-1 block text-xs tabular-nums text-text-subtle">{progress.goal ? `${format(Math.max(0, progress.goal - progress.xp))} to level ${progress.level + 1}` : 'Highest level'}</span>
            </div>
          </div>
        )}

        {levels && progress.attributes.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {progress.attributes.map(attribute => {
              const waiting = pendingByTrait.get(attribute.traitId);
              return (
                <div key={attribute.traitId} className={`flex flex-col gap-1 rounded-control border p-3 ${waiting ? 'border-status-warning/45 bg-status-warning/[0.05]' : 'border-border-subtle bg-surface-canvas/40'}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-text-muted">{attribute.name}</span>
                    {editing
                      ? <SheetNumber ariaLabel={attribute.name} value={draft.attributes[attribute.traitId]} min={attribute.minimum} max={attribute.maximum} className="h-8.5 w-13 text-lg font-bold" onChange={value => setPart('attributes', attribute.traitId, value)} />
                      : <span className="text-xl font-bold tabular-nums text-text-primary">{attribute.value}{waiting && <span className="ml-1 text-sm text-status-warning">→ {waiting.nextValue}</span>}</span>}
                  </div>
                  <span className="text-xs text-text-subtle">
                    {attribute.bonus
                      ? <>Base {attribute.base}, {attribute.bonus > 0 ? '+' : '−'}{Math.abs(attribute.bonus)} from {attribute.bonusFromId
                        ? <button type="button" onClick={() => onOpen?.(attribute.bonusFromId)} className="font-medium text-text-secondary hover:text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{attribute.bonusFromName}</button>
                        : attribute.bonusFromName}</>
                      : `Base ${attribute.base}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {resources.length > 0 && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {resources.map(resource => {
              const source = resource.inheritedFrom ? entities.find(item => item.id === resource.inheritedFrom) : null;
              const current = editing ? Number(draft.resources[resource.definitionId]) : resource.current;
              const maximum = editing ? Number(draft.maximums[resource.definitionId]) : resource.maximum;
              return (
                <div key={resource.definitionId} className="flex flex-col gap-2 rounded-control border border-border-subtle bg-surface-canvas/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-text-primary">{resource.name}</span>
                    {editing
                      ? <SheetNumber ariaLabel={`${resource.name} current value`} value={draft.resources[resource.definitionId]} min={resource.minimum} max={draft.maximums[resource.definitionId]} integer={false} className="h-8 w-16 text-[0.8125rem]" onChange={value => setPart('resources', resource.definitionId, value)} />
                      : <span className="text-[0.8125rem] tabular-nums text-text-primary">{format(resource.current)}</span>}
                    <span className="shrink-0 text-xs tabular-nums text-text-subtle">/</span>
                    {editing
                      ? <SheetNumber ariaLabel={`${resource.name} full at`} value={draft.maximums[resource.definitionId]} min={resource.minimum + 1} integer={false} className="h-8 w-16 text-[0.8125rem]" onChange={value => {
                        setPart('maximums', resource.definitionId, value);
                        if (Number(draft.resources[resource.definitionId]) > value) setPart('resources', resource.definitionId, value);
                      }} />
                      : <span className="shrink-0 text-xs tabular-nums text-text-subtle">{format(resource.maximum)}</span>}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover/70" role="progressbar" aria-label={resource.name} aria-valuemin={resource.minimum} aria-valuemax={maximum} aria-valuenow={current}>
                    <div className="h-full rounded-full transition-[width]" style={{ width: `${percent(current, resource.minimum, maximum)}%`, backgroundColor: resource.color }} />
                  </div>
                  <p className="flex min-h-5 items-center gap-1.5 text-xs text-text-subtle">
                    {editing
                      ? <button type="button" disabled={current >= maximum} onClick={() => setPart('resources', resource.definitionId, maximum)} className="inline-flex min-h-5 items-center gap-1 rounded-md px-1.5 -ml-1.5 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><RotateCcw className="h-3 w-3" aria-hidden="true" />Refill</button>
                      : source
                      ? <>From <button type="button" onClick={() => onOpen?.(source.id)} className="inline-flex min-h-5 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-hover/35 px-2 text-xs font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta(source.type).dot || 'bg-text-subtle'}`} />{source.canonicalName}</button></>
                      : resource.inheritedFromType === 'entity' ? 'Set on this sheet' : 'Starting value'}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {editing && (
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-text-subtle">The number you type is the number kept.{levels ? ' A new level gives its rewards; a lower one takes them back.' : ''}</span>
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="sm" icon={Check} loading={saving} onClick={save}>Save</Button>
          </div>
        )}

        {!editing && pending.length > 0 && (
          <div className="flex flex-col gap-2">
            {pending.map(change => (
              <div key={change.id} className="flex flex-wrap items-center gap-3 rounded-control border border-status-warning/25 bg-status-warning/[0.04] px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] font-semibold text-text-primary">{describePending(change)}</span>
                  {change.reason && <span className="block text-xs leading-relaxed text-text-muted">{change.reason}</span>}
                </div>
                <Button variant="subtle" size="sm" onClick={() => resolve(change, 'rejected')}>Reject</Button>
                <Button variant="ghost" size="sm" icon={Check} onClick={() => resolve(change, 'approved')}>Approve</Button>
              </div>
            ))}
            <p className="text-xs text-text-subtle">The same change waits in Narrative State. With Automatic it applies at once and shows in History.</p>
          </div>
        )}
      </div>

      {history && (
        <Modal title={`${entity.canonicalName}: history`} icon={History} iconClassName="text-text-secondary" onClose={() => setHistory(null)} size="xl">
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4 custom-scrollbar">
            <HistoryList entries={history} colors={colors} />
          </div>
        </Modal>
      )}
    </section>
  );
}

function describePending(change) {
  if (change.area === 'resource') {
    const delta = change.delta ?? change.nextValue - change.previousValue;
    return `${change.definitionName || 'Resource'} ${delta > 0 ? '+' : '−'}${format(Math.abs(delta))}`;
  }
  if (change.kind === 'xp') return `XP ${change.delta > 0 ? '+' : '−'}${format(Math.abs(change.delta))}`;
  return `${change.traitName || 'Attribute'} ${change.previousValue} → ${change.nextValue}`;
}

// A race, or a species of creature, sets the starting values its members inherit and its
// attribute bonuses; a member's own sheet can change any of them.
export function RaceRoleplayDefaults({ workspaceId, race, api, showToast }) {
  const targetType = race.type === 'Races' ? 'race' : 'species';
  const [definitions, setDefinitions] = useState([]);
  const [values, setValues] = useState({});
  const [mode, setMode] = useState('off');
  const [traits, setTraits] = useState([]);
  const [traitValues, setTraitValues] = useState({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [traitDraft, setTraitDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const [result, raceProgress] = await Promise.all([
      api.getRoleplayConfiguration?.(workspaceId).catch(() => null),
      api.getRoleplayRaceProgress?.(workspaceId, race.id).catch(() => null)
    ]);
    if (!result?.success) return;
    setDefinitions((result.definitions || []).filter(definition => definition.enabled !== false));
    setValues(Object.fromEntries((result.assignments || [])
      .filter(item => item.targetType === targetType && item.targetId === race.id)
      .map(item => [item.definitionId, { current: item.current, maximum: item.maximum }])));
    const nextMode = result.progression?.mode || 'off';
    setMode(nextMode);
    setTraits(result.traits || []);
    setTraitValues(raceProgress?.success ? raceProgress.values || {} : {});
  }, [api, race.id, targetType, workspaceId]);
  useEffect(() => { load(); }, [load]);
  const showTraits = mode !== 'off' && traits.length > 0;
  if (!definitions.length && !showTraits) return null;

  const startEdit = () => {
    setDraft(Object.fromEntries(definitions.map(definition => [definition.id, {
      current: values[definition.id]?.current ?? '', maximum: values[definition.id]?.maximum ?? ''
    }])));
    setTraitDraft(Object.fromEntries(traits.map(trait => [trait.id, traitValues[trait.id] ?? ''])));
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      for (const definition of definitions) {
        const entry = draft[definition.id] || {};
        const blank = entry.current === '' && entry.maximum === '';
        const result = blank
          ? values[definition.id] ? await api.removeRoleplayResourceValue({ workspaceId, definitionId: definition.id, targetType, targetId: race.id }) : { success: true }
          : await api.setRoleplayResourceValue({ workspaceId, definitionId: definition.id, targetType, targetId: race.id, value: {
            current: Number(entry.current === '' ? entry.maximum : entry.current), maximum: Number(entry.maximum === '' ? definition.maximum : entry.maximum)
          } });
        if (!result?.success) throw new Error(result?.error || `Could not save ${definition.name}.`);
      }
      for (const trait of traits) {
        const next = traitDraft[trait.id];
        const current = traitValues[trait.id];
        if ((next === '' ? undefined : Number(next)) === current) continue;
        const result = await api.setRoleplayRaceProgress(workspaceId, race.id, trait.id, next === '' ? null : Number(next));
        if (!result?.success) throw new Error(result?.error || `Could not save ${trait.name}.`);
      }
      await load();
      setEditing(false);
      window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
    } catch (error) { showToast(error.message, 'error'); }
    finally { setSaving(false); }
  };
  const set = Object.keys(values).length > 0 || Object.keys(traitValues).length > 0;
  const field = 'wb-input h-9 w-full rounded-md border border-border-default bg-surface-input px-2 text-right text-sm tabular-nums text-text-primary focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';
  const traitLabel = 'Attribute bonuses';

  return (
    <section className="ws-card overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
      <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle pl-4 pr-2">
        <Activity className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary">Roleplay state</h2>
        {editing && <span className="text-xs text-text-subtle">Editing</span>}
        <span className="flex-1" />
        {!editing && <button type="button" onClick={startEdit} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{set ? <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}{set ? 'Edit' : 'Set defaults'}</button>}
      </header>
      <div className="flex flex-col gap-4 p-4">
        {editing ? (
          <>
            {definitions.length > 0 && (
              <div>
                <span className="text-[0.8125rem] font-semibold text-text-muted">Starting values</span>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">{definitions.map(definition => (
                  <div key={definition.id} className="rounded-control border border-border-subtle bg-surface-canvas/40 p-3">
                    <p className="mb-2 text-sm font-semibold text-text-primary">{definition.name}</p>
                    <div className="flex items-center gap-2 text-xs text-text-subtle">
                      <input aria-label={`${definition.name} starting value`} className={field} type="number" placeholder="—" value={draft[definition.id]?.current ?? ''} onChange={event => setDraft(current => ({ ...current, [definition.id]: { ...current[definition.id], current: event.target.value } }))} />
                      <span>/</span>
                      <input aria-label={`${definition.name} highest`} className={field} type="number" placeholder={String(definition.maximum)} value={draft[definition.id]?.maximum ?? ''} onChange={event => setDraft(current => ({ ...current, [definition.id]: { ...current[definition.id], maximum: event.target.value } }))} />
                    </div>
                  </div>
                ))}</div>
              </div>
            )}
            {showTraits && (
              <div>
                <span className="text-[0.8125rem] font-semibold text-text-muted">{traitLabel}</span>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{traits.map(trait => (
                  <label key={trait.id} className="flex items-center justify-between gap-2 rounded-control border border-border-subtle bg-surface-canvas/40 px-3 py-2 text-[0.8125rem] text-text-secondary">
                    <span className="truncate">{trait.name}</span>
                    <input aria-label={`${trait.name} bonus`} className={`${field} !h-8 !w-16`} type="number" placeholder="—" value={traitDraft[trait.id] ?? ''} onChange={event => setTraitDraft(current => ({ ...current, [trait.id]: event.target.value }))} />
                  </label>
                ))}</div>
              </div>
            )}
            <p className="caption">Leave a field empty to let members use the value set in roleplay.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              <Button size="sm" icon={Check} loading={saving} onClick={save}>Save</Button>
            </div>
          </>
        ) : set ? (
          <>
            {Object.keys(values).length > 0 && (
              <div>
                <span className="text-[0.8125rem] font-semibold text-text-muted">Starting values</span>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">{definitions.filter(definition => values[definition.id]).map(definition => {
                  const value = values[definition.id];
                  return (
                    <div key={definition.id}>
                      <div className="flex items-baseline justify-between text-xs"><span className="font-semibold text-text-secondary">{definition.name}</span><span className="tabular-nums text-text-muted">{value.current} / {value.maximum}</span></div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-hover/70"><div className="h-full rounded-full" style={{ width: `${percent(value.current, definition.minimum, value.maximum)}%`, backgroundColor: definition.color }} /></div>
                    </div>
                  );
                })}</div>
              </div>
            )}
            {showTraits && (
              <div>
                <span className="text-[0.8125rem] font-semibold text-text-muted">{traitLabel}</span>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{traits.map(trait => {
                  const value = traitValues[trait.id];
                  return (
                    <div key={trait.id} className={`flex items-center justify-between rounded-control border border-border-subtle bg-tint/[0.025] px-3 py-2.5 text-[0.8125rem] ${value ? 'text-text-secondary' : 'text-text-subtle'}`}>
                      <span className="truncate">{trait.name}</span>
                      {value
                        ? <b className={`font-semibold tabular-nums ${value > 0 ? 'text-status-success' : 'text-status-danger'}`}>{`${value > 0 ? '+' : '−'}${Math.abs(value)}`}</b>
                        : <span>—</span>}
                    </div>
                  );
                })}</div>
              </div>
            )}
            <p className="caption">Every member starts with these. A member's own sheet can change them.</p>
          </>
        ) : (
          <p className="text-sm text-text-disabled">No defaults yet. Members use the values set in roleplay.</p>
        )}
      </div>
    </section>
  );
}

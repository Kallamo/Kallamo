import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Check, Pencil, Plus } from 'lucide-react';
import Button from '../../components/ui/Button';
import { meta } from './worldbuildConfig';

export default function WorldbuildRoleplayResources({ workspaceId, entity, entities = [], api, showToast, onOpen }) {
  const [resources, setResources] = useState([]);
  const load = useCallback(async () => {
    const result = await api.getRoleplayEntityResources?.(workspaceId, entity.id);
    setResources(result?.resources || []);
  }, [api, entity.id, workspaceId]);

  useEffect(() => { load(); }, [load]);
  if (!resources.length) return null;

  const update = async (resource, value) => {
    const result = await api.changeRoleplayResource({
      id: crypto.randomUUID(), workspaceId, definitionId: resource.definitionId,
      entityId: entity.id, value: Number(value), source: 'manual', provenanceId: 'worldbuild-entity-sheet'
    });
    if (!result?.success) return showToast(result?.error || 'Could not update roleplay state.', 'error');
    await load();
  };

  // Drawn like a sheet section, so live roleplay values sit among the rest of the sheet.
  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
      <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle pl-4 pr-4">
        <Activity className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary">Roleplay state</h2>
        <span className="flex-1" />
        <span className="text-xs text-text-subtle">Live values used in roleplay</span>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-3">{resources.map(resource => (
        <ResourceCard key={resource.definitionId} resource={resource}
          source={resource.inheritedFrom ? entities.find(item => item.id === resource.inheritedFrom) : null}
          onOpen={onOpen} onCommit={value => update(resource, value)} />
      ))}</div>
    </section>
  );
}

function ResourceCard({ resource, source, onOpen, onCommit }) {
  const [draft, setDraft] = useState(String(resource.current));
  useEffect(() => setDraft(String(resource.current)), [resource.current]);
  const commit = () => { if (draft !== '' && draft !== '-') onCommit(draft); else setDraft(String(resource.current)); };
  const range = (resource.maximum - resource.minimum) || 1;
  const percentage = Math.max(0, Math.min(100, ((resource.current - resource.minimum) / range) * 100));
  return (
    <div className="rounded-control border border-border-subtle bg-surface-canvas/40 p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{resource.name}</span>
        <input type="number" min={resource.minimum} max={resource.maximum} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
          onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} aria-label={`${resource.name} current value`}
          className="wb-input h-8 w-16 rounded-md border border-border-default bg-surface-input px-2 text-right text-sm tabular-nums text-text-primary focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20" />
        <span className="shrink-0 text-xs tabular-nums text-text-subtle">/ {resource.maximum}</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-hover/70" role="progressbar" aria-label={resource.name} aria-valuemin={resource.minimum} aria-valuemax={resource.maximum} aria-valuenow={resource.current}>
        <div className="h-full rounded-full transition-[width]" style={{ width: `${percentage}%`, backgroundColor: resource.color }} />
      </div>
      <p className="mt-2 flex min-h-6 items-center gap-1.5 text-xs text-text-subtle">
        {source
          ? <>From <button type="button" onClick={() => onOpen?.(source.id)} className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-hover/35 px-2.5 text-xs font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta(source.type).dot || 'bg-text-subtle'}`} />{source.canonicalName}</button></>
          : resource.inheritedFrom ? 'Starting value' : 'Set on this sheet'}
      </p>
    </div>
  );
}

// A race sets the starting values its members inherit; a member's own sheet can override them.
export function RaceRoleplayDefaults({ workspaceId, race, api, showToast }) {
  const [definitions, setDefinitions] = useState([]);
  const [values, setValues] = useState({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const result = await api.getRoleplayConfiguration?.(workspaceId).catch(() => null);
    if (!result?.success) return;
    setDefinitions((result.definitions || []).filter(definition => definition.enabled !== false));
    setValues(Object.fromEntries((result.assignments || [])
      .filter(item => item.targetType === 'race' && item.targetId === race.id)
      .map(item => [item.definitionId, { current: item.current, maximum: item.maximum }])));
  }, [api, race.id, workspaceId]);
  useEffect(() => { load(); }, [load]);
  if (!definitions.length) return null;

  const startEdit = () => {
    setDraft(Object.fromEntries(definitions.map(definition => [definition.id, {
      current: values[definition.id]?.current ?? '', maximum: values[definition.id]?.maximum ?? '',
    }])));
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      for (const definition of definitions) {
        const entry = draft[definition.id] || {};
        const blank = entry.current === '' && entry.maximum === '';
        const result = blank
          ? values[definition.id] ? await api.removeRoleplayResourceValue({ workspaceId, definitionId: definition.id, targetType: 'race', targetId: race.id }) : { success: true }
          : await api.setRoleplayResourceValue({ workspaceId, definitionId: definition.id, targetType: 'race', targetId: race.id, value: {
            current: Number(entry.current === '' ? entry.maximum : entry.current), maximum: Number(entry.maximum === '' ? definition.maximum : entry.maximum),
          } });
        if (!result?.success) throw new Error(result?.error || `Could not save ${definition.name}.`);
      }
      await load();
      setEditing(false);
    } catch (error) { showToast(error.message, 'error'); }
    finally { setSaving(false); }
  };
  const set = values && Object.keys(values).length > 0;
  const field = 'wb-input h-9 w-full rounded-md border border-border-default bg-surface-input px-2 text-right text-sm tabular-nums text-text-primary focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';

  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
      <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle pl-4 pr-2">
        <Activity className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary">Roleplay state</h2>
        {editing && <span className="text-xs text-text-subtle">Editing</span>}
        <span className="flex-1" />
        {!editing && <button type="button" onClick={startEdit} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{set ? <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}{set ? 'Edit' : 'Set defaults'}</button>}
      </header>
      <div className="space-y-3 p-4">
        {editing ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">{definitions.map(definition => (
              <div key={definition.id} className="rounded-control border border-border-subtle bg-surface-canvas/40 p-3">
                <p className="mb-2 text-sm font-semibold text-text-primary">{definition.name}</p>
                <div className="flex items-center gap-2 text-xs text-text-subtle">
                  <input aria-label={`${definition.name} starting value`} className={field} type="number" placeholder="—" value={draft[definition.id]?.current ?? ''} onChange={event => setDraft(current => ({ ...current, [definition.id]: { ...current[definition.id], current: event.target.value } }))} />
                  <span>/</span>
                  <input aria-label={`${definition.name} maximum`} className={field} type="number" placeholder={String(definition.maximum)} value={draft[definition.id]?.maximum ?? ''} onChange={event => setDraft(current => ({ ...current, [definition.id]: { ...current[definition.id], maximum: event.target.value } }))} />
                </div>
              </div>
            ))}</div>
            <p className="caption">Leave both empty to let members use the value set in roleplay.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              <Button size="sm" icon={Check} loading={saving} onClick={save}>Save</Button>
            </div>
          </>
        ) : set ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">{definitions.filter(definition => values[definition.id]).map(definition => {
              const value = values[definition.id];
              const share = Math.max(0, Math.min(100, ((value.current - definition.minimum) / ((value.maximum - definition.minimum) || 1)) * 100));
              return (
                <div key={definition.id}>
                  <div className="flex items-baseline justify-between text-xs"><span className="font-semibold text-text-secondary">{definition.name}</span><span className="tabular-nums text-text-muted">{value.current}/{value.maximum}</span></div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-hover/70"><div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: definition.color }} /></div>
                </div>
              );
            })}</div>
            <p className="caption">Defaults for every member. A member's sheet can override them.</p>
          </>
        ) : (
          <p className="text-sm text-text-disabled">No defaults yet. Members use the values set in roleplay.</p>
        )}
      </div>
    </section>
  );
}

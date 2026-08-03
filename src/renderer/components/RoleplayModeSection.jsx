import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Check, ChevronDown, Clock3, Eye, Gauge, MapPin, Pencil, Plus, RefreshCw, Shield, Trash2, Users, X } from 'lucide-react';
import ColorField from './ui/ColorField';
import SearchableSelect from './ui/SearchableSelect';

const EMPTY_SETTINGS = { playerEntityId: null, locationEntityId: null, activeSceneId: null, scenarioName: '', scenarioSummary: '', defaultUpdatePolicy: 'review' };
const EMPTY_SCENE = { locationId: null, participantIds: [], possibleObserverIds: [], nearbyIds: [], objectIds: [] };
const EMPTY_RESOURCE = { name: '', key: '', description: '', color: '#dc2626', minimum: 0, maximum: 100, initialValue: 100, unit: '', appliesTo: ['Characters'], updatePolicy: 'review', enabled: true };
const POLICY = { manual: 'Only you can update it.', review: 'AI changes wait for your approval.', automatic: 'Clear AI changes apply immediately.' };
const EMPTY_TIME_MATRIX = { categories: [] };

export default function RoleplayModeSection({ workspaceId, api, showToast, inputClass, fieldLabel, SectionHead, onModeChange }) {
  const [enabled, setEnabled] = useState(false);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [scene, setScene] = useState(EMPTY_SCENE);
  const [definitions, setDefinitions] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [entities, setEntities] = useState([]);
  const [changes, setChanges] = useState([]);
  const [sceneChanges, setSceneChanges] = useState([]);
  const [inventoryChanges, setInventoryChanges] = useState([]);
  const [entityChanges, setEntityChanges] = useState([]);
  const [narrativeEvents, setNarrativeEvents] = useState([]);
  const [narrativeMetrics, setNarrativeMetrics] = useState([]);
  const [narrativeJobs, setNarrativeJobs] = useState([]);
  const [resourceDraft, setResourceDraft] = useState(null);
  const [assignment, setAssignment] = useState({ definitionId: '', targetType: 'entity', targetIds: [], current: 100, maximum: 100 });
  const [inspectId, setInspectId] = useState('');
  const [resources, setResources] = useState([]);
  const [timeMatrix, setTimeMatrix] = useState(EMPTY_TIME_MATRIX);

  const load = useCallback(async () => {
    const [mode, config, worldbuild] = await Promise.all([api.getWorkspaceExperienceMode(workspaceId), api.getRoleplayConfiguration(workspaceId), api.listEntities(workspaceId)]);
    const active = mode?.mode === 'roleplay';
    setEnabled(active);
    onModeChange?.(active);
    if (config?.success) {
      setSettings(config.settings || EMPTY_SETTINGS);
      setScene(config.scene || EMPTY_SCENE);
      setDefinitions(config.definitions || []);
      setAssignments(config.assignments || []);
      setChanges(config.changes || []);
      setSceneChanges(config.sceneChanges || []);
      setInventoryChanges(config.inventoryChanges || []);
      setEntityChanges(config.entityChanges || []);
      setNarrativeEvents(config.narrativeEvents || []);
      setNarrativeMetrics(config.narrativeMetrics || []);
      setNarrativeJobs(config.narrativeJobs || []);
      setTimeMatrix(config.timeMatrix || EMPTY_TIME_MATRIX);
    }
    setEntities((worldbuild?.entities || worldbuild || []).filter(entity => entity.status !== 'proposed'));
  }, [api, onModeChange, workspaceId]);

  useEffect(() => { load().catch(error => showToast(error.message, 'error')); }, [load, showToast]);

  const groups = useMemo(() => ({
    actors: entities.filter(entity => entity.type === 'Characters' || (entity.type === 'Creatures' && (entity.data?.scope || 'individual') !== 'group')),
    locations: entities.filter(entity => entity.type === 'Locations'),
    items: entities.filter(entity => entity.type === 'Items'),
    races: entities.filter(entity => entity.type === 'Races'),
    species: entities.filter(entity => entity.type === 'Creatures' && entity.data?.scope === 'group')
  }), [entities]);
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);
  const entityOptions = list => list.map(entity => ({ id: entity.id, label: entity.canonicalName, aliases: Array.isArray(entity.aliases) ? entity.aliases : String(entity.aliases || '').split(','), group: entity.type.replace(/s$/, '') }));
  const definitionOptions = definitions.map(item => ({ id: item.id, label: item.name, description: item.description, color: item.color }));

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    onModeChange?.(next);
    window.dispatchEvent(new CustomEvent('roleplay-mode-change', { detail: { workspaceId, enabled: next } }));
    const result = await api.setWorkspaceExperienceMode(workspaceId, next ? 'roleplay' : 'standard');
    if (!result?.success) {
      setEnabled(!next);
      onModeChange?.(!next);
      window.dispatchEvent(new CustomEvent('roleplay-mode-change', { detail: { workspaceId, enabled: !next } }));
      showToast(result?.error || 'Could not update Roleplay Mode.', 'error');
    }
  };
  const saveSettings = async patch => {
    const next = { ...settings, ...patch };
    setSettings(next);
    const result = await api.saveRoleplaySettings(workspaceId, next);
    if (!result?.success) showToast(result?.error || 'Could not save roleplay settings.', 'error');
    else {
      setSettings(result.settings);
      window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
    }
  };
  const saveScene = async patch => {
    setScene(current => ({ ...current, ...patch }));
    const result = await api.saveRoleplayScene(workspaceId, patch);
    if (!result?.success) {
      showToast(result?.error || 'Could not save the current scene.', 'error');
      await load();
    } else {
      setScene(result.scene);
      window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
    }
  };
  const saveResource = async () => {
    const payload = { ...resourceDraft, minimum: Number(resourceDraft.minimum), maximum: Number(resourceDraft.maximum), initialValue: Number(resourceDraft.initialValue), key: resourceDraft.key || resourceDraft.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') };
    const result = await api.saveRoleplayResourceDefinition(workspaceId, payload);
    if (!result?.success) {
      const duplicate = String(result?.error || '').includes('UNIQUE constraint failed');
      return showToast(duplicate ? 'A resource with this name already exists. Use a different name.' : result?.error || 'Could not save resource.', 'error');
    }
    setResourceDraft(null);
    await load();
  };
  const deleteResource = async definitionId => {
    const result = await api.deleteRoleplayResourceDefinition(workspaceId, definitionId);
    if (!result?.success) return showToast(result?.error || 'Could not delete resource.', 'error');
    await load();
  };
  const saveAssignment = async () => {
    const result = await api.setRoleplayResourceValues({ workspaceId, definitionId: assignment.definitionId, targetType: assignment.targetType, targetIds: assignment.targetIds, value: { current: Number(assignment.current), maximum: Number(assignment.maximum) } });
    if (!result?.success) return showToast(result?.error || 'Could not save resource assignment.', 'error');
    setAssignment(current => ({ ...current, targetIds: [] }));
    await load();
  };
  const removeAssignment = async item => {
    const result = await api.removeRoleplayResourceValue({ workspaceId, definitionId: item.definitionId, targetType: item.targetType, targetId: item.targetId });
    if (!result?.success) return showToast(result?.error || 'Could not remove resource assignment.', 'error');
    await load();
    if (inspectId) await inspect(inspectId);
  };
  const inspect = async entityId => {
    setInspectId(entityId);
    if (!entityId) return setResources([]);
    const result = await api.getRoleplayEntityResources(workspaceId, entityId);
    setResources(result?.resources || []);
  };
  const changeValue = async (resource, value) => {
    const result = await api.changeRoleplayResource({ id: crypto.randomUUID(), workspaceId, definitionId: resource.definitionId, entityId: inspectId, value: Number(value), source: 'manual', provenanceId: 'workspace-configuration' });
    if (!result?.success) return showToast(result?.error || 'Could not change resource.', 'error');
    await inspect(inspectId);
    await load();
  };
  const resolve = async (kind, id, decision) => {
    const method = kind === 'scene' ? api.resolveRoleplaySceneChange : kind === 'inventory' ? api.resolveRoleplayInventoryChange : kind === 'entity' ? api.resolveRoleplayEntityChange : kind === 'narrative' ? api.resolveNarrativeStateEvent : api.resolveRoleplayResourceChange;
    const result = await method(workspaceId, id, decision);
    if (!result?.success) return showToast(result?.error || 'Could not resolve roleplay change.', 'error');
    await load();
  };
  const reprocess = async originId => {
    const result = await api.reprocessNarrativeStateTurn(workspaceId, originId);
    if (!result?.success) return showToast(result?.error || 'Could not reprocess the turn.', 'error');
    showToast('Narrative State reprocessed.', 'success');
    await load();
  };
  const updateTimeCategory = (id, patch) => {
    setTimeMatrix(current => ({
      ...current,
      categories: current.categories.map(category => category.id === id ? { ...category, ...patch } : category)
    }));
  };
  const saveTimeMatrix = async () => {
    const result = await api.saveRoleplayTimeMatrix(workspaceId, timeMatrix);
    if (!result?.success) return showToast(result?.error || 'Could not save the time cost matrix.', 'error');
    setTimeMatrix(result.matrix);
    showToast('Time cost matrix saved.', 'success');
    window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  };

  const targets = assignment.targetType === 'race' ? groups.races : assignment.targetType === 'species' ? groups.species : groups.actors;
  const pendingResources = changes.filter(change => change.status === 'pending');
  const pendingScenes = sceneChanges.filter(change => change.status === 'pending');
  const pendingInventory = inventoryChanges.filter(change => change.status === 'pending');
  const pendingEntities = entityChanges.filter(change => change.status === 'pending' || change.status === 'conflicting');
  const pendingNarrative = narrativeEvents.filter(event => event.status === 'proposed');
  const metricTotals = narrativeMetrics.reduce((total, metric) => ({ turns: total.turns + 1, deep: total.deep + (metric.deepAnalysis ? 1 : 0), tokens: total.tokens + metric.triageInputTokens + metric.triageOutputTokens + metric.deepInputTokens + metric.deepOutputTokens }), { turns: 0, deep: 0, tokens: 0 });
  const delayedJobs = narrativeJobs.filter(job => job.status === 'failed' || (job.status === 'processing' && Date.now() - job.updatedAt > 120000));
  const recentEntities = entityChanges.filter(change => change.status === 'applied').slice(-5).reverse();
  const recentEvents = narrativeEvents.filter(event => event.status === 'approved').slice(-5).reverse();
  const pendingCount = pendingResources.length + pendingScenes.length + pendingInventory.length + pendingEntities.length + pendingNarrative.length;
  const playerName = names.get(settings.playerEntityId) || 'Not selected';
  const locationName = names.get(scene.locationId) || 'No location';

  return <div className="rounded-2xl border border-gray-800/60 bg-[#0a161d]/50 p-6">
    <SectionHead icon={Shield} title="Roleplay Mode" desc="Set the active scene first. Open campaign systems only when you need deeper control." />
    <div className="flex min-w-0 items-center justify-between gap-6 rounded-xl border border-gray-800 bg-[#011419] p-5">
      <div className="min-w-0"><span className="text-sm font-semibold text-gray-100">Enable Roleplay Mode</span><p className="caption mt-1">Turning it off preserves every scene, resource, value, and history entry.</p></div>
      <button type="button" role="switch" aria-label="Enable Roleplay Mode" aria-checked={enabled} onClick={toggle} className={'relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' + (enabled ? 'border-accent/50 bg-accent' : 'border-gray-600 bg-gray-700')}><span className={'absolute left-1 top-1 h-[1.125rem] w-[1.125rem] rounded-full bg-[#011419] transition-transform ' + (enabled ? 'translate-x-5' : '')} /></button>
    </div>

    {enabled && <div className="mt-5 space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        <Overview label="Playing as" value={playerName} />
        <Overview label="Current location" value={locationName} />
        <Overview label="Pending review" value={String(pendingCount)} accent={pendingCount > 0} />
      </div>

      <Panel icon={MapPin} title="Current Scene" summary={`${playerName} · ${locationName}`} description="Choose the active perspective, location, and who is present. These are the details used on the next roleplay turn." defaultOpen>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Player character" hint="The focal perspective used for roleplay context." fieldLabel={fieldLabel}><SearchableSelect value={settings.playerEntityId || ''} onChange={value => saveSettings({ playerEntityId: value || null })} options={entityOptions(groups.actors)} placeholder="Select a character" /></Field>
          <Field label="Current location" hint="Where the active scene is happening." fieldLabel={fieldLabel}><SearchableSelect value={scene.locationId || ''} onChange={value => saveScene({ locationId: value || null })} options={entityOptions(groups.locations)} placeholder="Select a location" /></Field>
          <Field label="Participating characters" hint="Characters currently taking part in the scene." fieldLabel={fieldLabel}><SearchableSelect multiple values={scene.participantIds} onChange={value => saveScene({ participantIds: value })} options={entityOptions(groups.actors)} placeholder="Add participating characters" /></Field>
          <Field label="Nearby characters" hint="Present in the broader location. Narrative State determines what they actually notice from the narrative." fieldLabel={fieldLabel}><SearchableSelect multiple values={[...new Set([...(scene.possibleObserverIds || []), ...(scene.nearbyIds || [])])]} onChange={value => saveScene({ possibleObserverIds: [], nearbyIds: value })} options={entityOptions(groups.actors)} placeholder="Add nearby characters" /></Field>
          <Field label="Objects present" hint="Scene presence does not change ownership or inventory." fieldLabel={fieldLabel}><SearchableSelect multiple values={scene.objectIds} onChange={value => saveScene({ objectIds: value })} options={entityOptions(groups.items)} placeholder="Add objects in the scene" /></Field>
          <Field label="AI scene updates" hint={POLICY[settings.defaultUpdatePolicy]} fieldLabel={fieldLabel}><select className={inputClass} value={settings.defaultUpdatePolicy} onChange={event => saveSettings({ defaultUpdatePolicy: event.target.value })}><option value="manual">Manual only</option><option value="review">Review changes</option><option value="automatic">Automatic</option></select></Field>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="Scenario name" fieldLabel={fieldLabel}><input className={inputClass} value={settings.scenarioName} onChange={event => setSettings({ ...settings, scenarioName: event.target.value })} onBlur={() => saveSettings({ scenarioName: settings.scenarioName })} placeholder="Siege at Dawn" /></Field>
          <Field label="Current situation" fieldLabel={fieldLabel}><textarea className={inputClass + ' min-h-20 resize-y'} value={settings.scenarioSummary} onChange={event => setSettings({ ...settings, scenarioSummary: event.target.value })} onBlur={() => saveSettings({ scenarioSummary: settings.scenarioSummary })} placeholder="Describe the immediate situation without replacing Worldbuild canon." /></Field>
        </div>
      </Panel>

      <Panel icon={Clock3} title="Time Cost Matrix" summary={`${timeMatrix.categories.length} action ranges`} description="Optional timing rules for actions that do not state an exact duration. Explicit time in the narrative always takes priority.">
        <div className="space-y-3">
          {timeMatrix.categories.map(category => (
            <article key={category.id} className="rounded-xl border border-white/10 bg-[#07151b] p-4">
              <div className="grid gap-3 sm:grid-cols-[9rem_1fr_1fr]">
                <div><span className="text-xs font-bold uppercase tracking-wider text-gray-300">{category.name}</span><p className="mt-1 text-[0.65rem] text-gray-600">{category.id}</p></div>
                <Field label="Minimum minutes" fieldLabel={fieldLabel}><input className={inputClass} type="number" min="1" value={category.minimumMinutes} onChange={event => updateTimeCategory(category.id, { minimumMinutes: Number(event.target.value) || 1 })} /></Field>
                <Field label="Maximum minutes" fieldLabel={fieldLabel}><input className={inputClass} type="number" min={category.minimumMinutes} value={category.maximumMinutes} onChange={event => updateTimeCategory(category.id, { maximumMinutes: Math.max(category.minimumMinutes, Number(event.target.value) || category.minimumMinutes) })} /></Field>
              </div>
              <label className="mt-3 block"><span className={fieldLabel + ' mb-1.5'}>Action guidance</span><textarea className={inputClass + ' min-h-16 resize-y'} value={category.guidance} onChange={event => updateTimeCategory(category.id, { guidance: event.target.value })} /></label>
            </article>
          ))}
        </div>
        <div className="mt-4 flex justify-end"><button type="button" onClick={saveTimeMatrix} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-[#011419]">Save time matrix</button></div>
      </Panel>

      <Panel icon={Gauge} title="Tracked Resources" summary={`${definitions.length} configured`} description="Create reusable values such as Health, Stamina, or Mana, including how each value may change.">
        <div className="grid gap-3 md:grid-cols-2">{definitions.map(definition => <DefinitionCard key={definition.id} definition={definition} count={assignments.filter(item => item.definitionId === definition.id).length} onEdit={() => setResourceDraft({ ...definition })} onDelete={() => deleteResource(definition.id)} />)}</div>
        {!definitions.length && <Empty text="No tracked resources yet. Add Health, Stamina, Mana, or another numeric state." />}
        <button type="button" onClick={() => setResourceDraft({ ...EMPTY_RESOURCE, updatePolicy: settings.defaultUpdatePolicy })} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-accent"><Plus className="h-4 w-4" />Add resource</button>
        {resourceDraft && <ResourceEditor draft={resourceDraft} setDraft={setResourceDraft} onSave={saveResource} onCancel={() => setResourceDraft(null)} inputClass={inputClass} fieldLabel={fieldLabel} />}
      </Panel>

      <Panel icon={Users} title="Resource Assignments" summary={`${assignments.length} assignments`} description="Apply tracked resources to characters, Races, or species. Individual values take priority over inherited defaults.">
        <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <div className="grid gap-3 lg:grid-cols-3">
            <Field label="Resource" fieldLabel={fieldLabel}><SearchableSelect value={assignment.definitionId} onChange={definitionId => { const definition = definitions.find(item => item.id === definitionId); setAssignment(current => ({ ...current, definitionId, current: definition?.initialValue ?? 0, maximum: definition?.maximum ?? 100 })); }} options={definitionOptions} placeholder="Select a resource" /></Field>
            <Field label="Assignment level" fieldLabel={fieldLabel}><select className={inputClass} value={assignment.targetType} onChange={event => setAssignment(current => ({ ...current, targetType: event.target.value, targetIds: [] }))}><option value="entity">Selected entities</option><option value="race">Race default</option><option value="species">Species default</option></select></Field>
            <Field label="Targets" fieldLabel={fieldLabel}><SearchableSelect multiple values={assignment.targetIds} onChange={targetIds => setAssignment(current => ({ ...current, targetIds }))} options={entityOptions(targets)} placeholder="Search and select targets" /></Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Current value" fieldLabel={fieldLabel}><input className={inputClass} type="number" value={assignment.current} onChange={event => setAssignment(current => ({ ...current, current: event.target.value }))} /></Field>
            <Field label="Maximum" fieldLabel={fieldLabel}><input className={inputClass} type="number" value={assignment.maximum} onChange={event => setAssignment(current => ({ ...current, maximum: event.target.value }))} /></Field>
            <button type="button" disabled={!assignment.definitionId || !assignment.targetIds.length} onClick={saveAssignment} className="mt-auto h-[2.65rem] rounded-lg border border-accent/30 bg-accent/10 px-5 text-xs font-semibold text-accent disabled:opacity-40">Apply value</button>
          </div>
        </div>
        <AssignmentList assignments={assignments} definitions={definitions} names={names} onRemove={removeAssignment} />
      </Panel>

      <Panel icon={Eye} title="Entity State" summary="Inspect effective values" description="Check a character's current resources and whether each value is individual, inherited, or using its default.">
        <SearchableSelect value={inspectId} onChange={inspect} options={entityOptions(groups.actors)} placeholder="Search for an entity" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">{resources.map(resource => <ResourceBar key={resource.definitionId} resource={resource} sourceName={names.get(resource.inheritedFrom)} onChange={value => changeValue(resource, value)} onRemove={resource.inheritedFromType === 'entity' ? () => removeAssignment({ definitionId: resource.definitionId, targetType: 'entity', targetId: inspectId }) : null} />)}</div>
      </Panel>

      {pendingCount > 0 && <Panel icon={Activity} title="Pending AI Changes" summary={`${pendingCount} waiting`} description="Review changes that require your approval before they become part of the campaign state." defaultOpen>
        <div className="space-y-2">
          {pendingEntities.map(change => <Pending key={change.id} label={`${change.proposal.type.replace(/s$/, '')}: ${change.proposal.name}`} detail={change.status === 'conflicting' ? `Conflict: ${change.proposal.reason || change.proposal.description}` : change.proposal.description || change.proposal.reason} onApprove={() => resolve('entity', change.id, 'approved')} onReject={() => resolve('entity', change.id, 'rejected')} />)}
          {pendingNarrative.map(item => <Pending key={item.proposal.changeSet.event.id} label={item.proposal.changeSet.event.description} detail={describeNarrativeEvent(item, names)} onApprove={() => resolve('narrative', item.proposal.changeSet.event.id, 'approved')} onReject={() => resolve('narrative', item.proposal.changeSet.event.id, 'rejected')} />)}
          {pendingScenes.map(change => <Pending key={change.id} label="Scene update" detail={describePatch(change.patch, names)} onApprove={() => resolve('scene', change.id, 'approved')} onReject={() => resolve('scene', change.id, 'rejected')} />)}
          {pendingInventory.map(change => <Pending key={change.id} label="Inventory update" detail={describeInventoryPatch(change.patch, names)} onApprove={() => resolve('inventory', change.id, 'approved')} onReject={() => resolve('inventory', change.id, 'rejected')} />)}
          {pendingResources.map(change => <Pending key={change.id} label={names.get(change.entityId) || change.entityId} detail={change.previousValue + ' → ' + change.nextValue} onApprove={() => resolve('resource', change.id, 'approved')} onReject={() => resolve('resource', change.id, 'rejected')} />)}
        </div>
      </Panel>}

      <Panel icon={Activity} title="Narrative State Activity" summary="Diagnostics and recovery" description="Advanced local diagnostics for recent analysis, interrupted updates, and recovery tools.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Recent turns" value={metricTotals.turns} />
          <Metric label="Deep analyses" value={metricTotals.deep} />
          <Metric label="Estimated tokens" value={metricTotals.tokens.toLocaleString()} />
        </div>
        {delayedJobs.length > 0 && <div className="mt-4 space-y-2">{delayedJobs.map(job => <div key={job.originId} className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-amber-200">{job.status === 'failed' ? 'State update failed' : 'State update interrupted'}</p><p className="mt-0.5 truncate text-[0.7rem] text-gray-500">{job.error || 'This turn may be behind the visible narrative.'}</p></div><button type="button" onClick={() => reprocess(job.originId)} className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/25 px-2.5 py-1.5 text-[0.7rem] font-semibold text-amber-200 hover:bg-amber-500/10"><RefreshCw className="h-3.5 w-3.5" />Reprocess turn</button></div>)}</div>}
        {(recentEntities.length > 0 || recentEvents.length > 0) && <div className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/10">
          {recentEntities.map(change => <div key={change.id} className="bg-[#07151b] px-4 py-3"><p className="text-xs font-semibold text-gray-200">{change.createdEntity ? 'Created' : 'Resolved'} {change.proposal.name}</p><p className="mt-0.5 text-[0.7rem] text-gray-600">{change.createdEntity ? `${change.proposal.type.replace(/s$/, '')} identity added to Worldbuild` : 'Matched an existing Worldbuild identity'}</p></div>)}
          {recentEvents.map(event => <div key={event.proposal.changeSet.event.id} className="bg-[#07151b] px-4 py-3"><p className="text-xs font-semibold text-gray-200">{event.proposal.changeSet.event.description}</p><p className="mt-0.5 text-[0.7rem] text-gray-600">{describeNarrativeEvent(event, names)}</p></div>)}
        </div>}
      </Panel>
    </div>}
  </div>;
}

function Panel({ icon: Icon, title, summary, description, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className={`overflow-hidden rounded-xl border bg-[#011419] transition-colors ${open ? 'border-gray-700/80' : 'border-gray-800'}`}><button type="button" onClick={() => setOpen(current => !current)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left hover:bg-white/[0.025]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/[0.07]"><Icon className="h-4 w-4 text-accent" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-bold uppercase tracking-wider text-gray-200">{title}</span><span className="mt-1 block truncate text-xs text-text-subtle">{open ? description : summary || description}</span></span><ChevronDown className={`h-4 w-4 shrink-0 text-text-subtle transition-transform ${open ? 'rotate-180' : ''}`} /></button>{open && <div className="border-t border-border-subtle px-5 pb-5 pt-4">{children}</div>}</section>;
}
function Overview({ label, value, accent = false }) { return <div className="rounded-xl border border-border-subtle bg-surface-panel-muted px-3.5 py-3"><span className="block text-[0.65rem] font-bold uppercase tracking-wider text-text-subtle">{label}</span><strong className={`mt-1 block truncate text-sm ${accent ? 'text-accent' : 'text-text-secondary'}`}>{value}</strong></div>; }
function Field({ label, hint, fieldLabel, children }) {
  return <label className="block"><span className={fieldLabel + ' mb-1.5'}>{label}</span>{children}{hint && <span className="mt-1.5 block text-[0.7rem] leading-relaxed text-gray-600">{hint}</span>}</label>;
}
function Empty({ text }) { return <p className="rounded-xl border border-dashed border-gray-800 px-4 py-6 text-center text-sm text-gray-600">{text}</p>; }
function DefinitionCard({ definition, count, onEdit, onDelete }) {
  return <article className="flex gap-3 rounded-xl border border-white/10 bg-[#07151b] p-4"><span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: definition.color }} /><div className="min-w-0 flex-1"><div className="flex gap-2"><div className="min-w-0 flex-1"><h5 className="truncate text-sm font-semibold text-gray-100">{definition.name}</h5><p className="mt-1 line-clamp-2 text-xs text-gray-500">{definition.description || 'No AI guidance provided.'}</p></div><button type="button" onClick={onEdit} className="p-1.5 text-gray-500 hover:text-accent" aria-label={'Edit ' + definition.name}><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={onDelete} className="p-1.5 text-gray-600 hover:text-red-400" aria-label={'Delete ' + definition.name}><Trash2 className="h-3.5 w-3.5" /></button></div><div className="mt-3 flex flex-wrap gap-2 text-[0.65rem] font-semibold uppercase tracking-wider text-gray-400"><span>{definition.minimum}–{definition.maximum}</span><span>{POLICY[definition.updatePolicy]}</span><span className="text-accent">{count} {count === 1 ? 'assignment' : 'assignments'}</span></div></div></article>;
}
function ResourceEditor({ draft, setDraft, onSave, onCancel, inputClass, fieldLabel }) {
  const toggleType = type => setDraft({ ...draft, appliesTo: draft.appliesTo.includes(type) ? draft.appliesTo.filter(item => item !== type) : [...draft.appliesTo, type] });
  return <div className="mt-4 rounded-xl border border-accent/20 bg-accent/[0.025] p-4"><div className="grid gap-3 md:grid-cols-3"><Field label="Name" fieldLabel={fieldLabel}><input className={inputClass} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="Color" fieldLabel={fieldLabel}><ColorField value={draft.color} onChange={color => setDraft({ ...draft, color })} /></Field><Field label="AI updates" hint={POLICY[draft.updatePolicy]} fieldLabel={fieldLabel}><select className={inputClass} value={draft.updatePolicy} onChange={event => setDraft({ ...draft, updatePolicy: event.target.value })}><option value="manual">Manual only</option><option value="review">Review changes</option><option value="automatic">Automatic</option></select></Field><Field label="Minimum" fieldLabel={fieldLabel}><input className={inputClass} type="number" value={draft.minimum} onChange={event => setDraft({ ...draft, minimum: event.target.value })} /></Field><Field label="Maximum" fieldLabel={fieldLabel}><input className={inputClass} type="number" value={draft.maximum} onChange={event => setDraft({ ...draft, maximum: event.target.value })} /></Field><Field label="Initial value" fieldLabel={fieldLabel}><input className={inputClass} type="number" value={draft.initialValue} onChange={event => setDraft({ ...draft, initialValue: event.target.value })} /></Field></div><div className="mt-4"><span className={fieldLabel}>Applies to</span><div className="mt-2 flex gap-2">{['Characters', 'Creatures'].map(type => <button key={type} type="button" onClick={() => toggleType(type)} className={'rounded-lg border px-3 py-2 text-xs ' + (draft.appliesTo.includes(type) ? 'border-accent/50 bg-accent/10 text-accent' : 'border-gray-800 text-gray-500')}>{type}</button>)}</div></div><div className="mt-4"><Field label="Purpose and AI guidance" hint="Explain what this value means and when a narrative event should change it." fieldLabel={fieldLabel}><textarea className={inputClass + ' min-h-20 resize-y'} value={draft.description || ''} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="px-3 py-2 text-xs text-gray-500">Cancel</button><button type="button" onClick={onSave} className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-[#011419]">Save resource</button></div></div>;
}
function AssignmentList({ assignments, definitions, names, onRemove }) {
  if (!assignments.length) return <div className="mt-4"><Empty text="No explicit assignments. Resources currently use their default initial values." /></div>;
  const definitionNames = new Map(definitions.map(item => [item.id, item.name]));
  return <div className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/10">{assignments.map(item => <div key={[item.definitionId, item.targetType, item.targetId].join(':')} className="flex items-center gap-3 bg-[#07151b] px-4 py-3"><div className="min-w-0 flex-1"><span className="text-xs font-semibold text-gray-200">{definitionNames.get(item.definitionId)}</span><p className="truncate text-xs text-gray-600"><span className="capitalize">{item.targetType}</span>: {names.get(item.targetId) || item.targetId}</p></div><span className="font-mono text-xs text-gray-400">{item.current} / {item.maximum}</span><button type="button" onClick={() => onRemove(item)} className="p-1.5 text-gray-600 hover:text-red-400" aria-label="Remove assignment"><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div>;
}
function ResourceBar({ resource, sourceName, onChange, onRemove }) {
  const [draft, setDraft] = useState(String(resource.current));
  useEffect(() => setDraft(String(resource.current)), [resource.current]);
  const percentage = Math.max(0, Math.min(100, ((resource.current - resource.minimum) / (resource.maximum - resource.minimum)) * 100));
  const source = resource.inheritedFromType === 'entity' ? 'Individual override' : resource.inheritedFromType === 'default' ? 'Resource default' : 'Inherited from ' + (sourceName || resource.inheritedFromType);
  const commit = () => draft !== '' && draft !== '-' ? onChange(draft) : setDraft(String(resource.current));
  return <article className="rounded-xl border border-white/10 bg-[#07151b] p-4"><div className="mb-3 flex justify-between gap-3"><div><h5 className="text-sm font-semibold text-gray-200">{resource.name}</h5><p className="text-[0.7rem] text-gray-600">{source}</p></div><label className="flex items-center gap-1 font-mono text-xs text-gray-400"><input type="number" min={resource.minimum} max={resource.maximum} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} aria-label={resource.name + ' current value'} className="w-16 rounded-lg border border-white/10 bg-[#011419] px-2 py-1.5 text-right focus:border-accent focus:outline-none" /><span>/ {resource.maximum}</span></label></div><div className="h-2.5 overflow-hidden rounded-full bg-gray-800" role="progressbar" aria-label={resource.name} aria-valuemin={resource.minimum} aria-valuemax={resource.maximum} aria-valuenow={resource.current}><div className="h-full rounded-full transition-[width]" style={{ width: percentage + '%', backgroundColor: resource.color }} /></div>{onRemove && <button type="button" onClick={onRemove} className="mt-3 text-[0.7rem] font-semibold text-gray-500 hover:text-accent">Use inherited value</button>}</article>;
}
function Pending({ label, detail, onApprove, onReject }) {
  return <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><Activity className="h-4 w-4 text-amber-400" /><div className="min-w-0 flex-1 text-xs text-gray-300"><strong>{label}</strong><p className="truncate text-gray-500">{detail}</p></div><button type="button" onClick={onApprove} className="p-1.5 text-emerald-400" aria-label="Approve change"><Check className="h-4 w-4" /></button><button type="button" onClick={onReject} className="p-1.5 text-red-400" aria-label="Reject change"><X className="h-4 w-4" /></button></div>;
}
function Metric({ label, value }) {
  return <div className="rounded-xl border border-white/10 bg-[#07151b] p-4"><span className="text-[0.65rem] font-bold uppercase tracking-wider text-gray-600">{label}</span><strong className="mt-1 block text-lg text-gray-200">{value}</strong></div>;
}
function describeNarrativeEvent(item, names) {
  const event = item.proposal.changeSet.event;
  const actors = event.participants.map(participant => names.get(participant.entityId) || participant.entityId).join(', ');
  const types = [...new Set(item.proposal.changeSet.operations.map(operation => operation.type.replace(/^set-|^record-|^grant-/, '')))];
  return `${actors || 'Unknown participants'} · ${types.join(', ')}`;
}
function describePatch(patch, names) {
  const parts = [];
  if (Object.hasOwn(patch, 'locationId')) parts.push('Location: ' + (names.get(patch.locationId) || patch.locationId || 'none'));
  if (patch.participantIds) parts.push('Active: ' + (patch.participantIds.map(id => names.get(id) || id).join(', ') || 'none'));
  if (patch.possibleObserverIds || patch.nearbyIds) {
    const nearby = [...new Set([...(patch.possibleObserverIds || []), ...(patch.nearbyIds || [])])];
    parts.push('Nearby: ' + (nearby.map(id => names.get(id) || id).join(', ') || 'none'));
  }
  if (patch.objectIds) parts.push('Objects: ' + (patch.objectIds.map(id => names.get(id) || id).join(', ') || 'none'));
  return parts.join(' · ');
}
function describeInventoryPatch(patch, names) {
  const item = names.get(patch.itemId) || patch.itemId;
  const from = patch.fromHolderId ? names.get(patch.fromHolderId) || patch.fromHolderId : null;
  const to = patch.toHolderId ? names.get(patch.toHolderId) || patch.toHolderId : null;
  const location = patch.locationId ? names.get(patch.locationId) || patch.locationId : null;
  const movement = [from && `from ${from}`, to && `to ${to}`, location && `at ${location}`].filter(Boolean).join(' ');
  return `${item}${patch.quantity ? ` ×${patch.quantity}` : ''}${movement ? ` ${movement}` : ''}`;
}

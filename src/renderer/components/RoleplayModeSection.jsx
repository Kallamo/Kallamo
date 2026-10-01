import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, Check, ChevronDown, Gauge, Pencil, Plus, RefreshCw, Trash2, X, Clapperboard, Drama, HeartPulse, Hourglass, UserCog } from 'lucide-react';
import { AiGlyph } from './ui/glyphs';
import ColorField from './ui/ColorField';
import NumberInput from './ui/NumberInput';
import ConfirmDialog from './ui/ConfirmDialog';
import SearchableSelect from './ui/SearchableSelect';
import { locationPresenceOptions } from '../features/worldbuild/worldbuildConfig';
import { locationSizeLabel } from '../../shared/location-sizes';

const EMPTY_SETTINGS = { playerEntityId: null, locationEntityId: null, activeSceneId: null, scenarioName: '', scenarioSummary: '', defaultUpdatePolicy: 'review' };
const EMPTY_SCENE = { locationId: null, participantIds: [], possibleObserverIds: [], nearbyIds: [], objectIds: [] };
const EMPTY_RESOURCE = { name: '', key: '', description: '', color: '#dc2626', minimum: 0, maximum: 100, initialValue: 100, unit: '', appliesTo: ['Characters'], updatePolicy: 'review', enabled: true };
const POLICY = { manual: 'Only you can update it.', review: 'AI changes wait for your approval.', automatic: 'Clear AI changes apply immediately.' };
const UPDATE_POLICY_LABEL = { manual: 'Manual only', review: 'Review changes', automatic: 'Automatic' };
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
  const [pendingNarrativeTurn, setPendingNarrativeTurn] = useState(null);
  const [narrativeNow, setNarrativeNow] = useState(() => Date.now());
  const [resourceDraft, setResourceDraft] = useState(null);
  const [deletingResource, setDeletingResource] = useState(null);
  const [deletingResourceBusy, setDeletingResourceBusy] = useState(false);
  const [assignment, setAssignment] = useState({ definitionId: '', targetType: 'entity', targetIds: [], current: 100, maximum: 100 });
  const [removingAssignment, setRemovingAssignment] = useState(null);
  const [removingAssignmentBusy, setRemovingAssignmentBusy] = useState(false);
  const [inspectId, setInspectId] = useState('');
  const [resources, setResources] = useState([]);
  const [timeMatrix, setTimeMatrix] = useState(EMPTY_TIME_MATRIX);
  const [calendar, setCalendar] = useState({ hoursPerDay: 24 });
  const [presenceOpen, setPresenceOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [editingTimeCategoryId, setEditingTimeCategoryId] = useState(null);
  const [assignmentEditorOpen, setAssignmentEditorOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [compaction, setCompaction] = useState(null);
  const [compactionBusy, setCompactionBusy] = useState(false);
  const presencePanelId = useId();
  const scenarioPanelId = useId();
  const timeCategoryPanelId = useId();
  const resourceEditorId = useId();
  const assignmentEditorId = useId();
  const activityPanelId = useId();
  const loadRequestRef = useRef(0);
  const activityRequestRef = useRef(0);
  const inspectRequestRef = useRef(0);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

  const load = useCallback(async () => {
    if (workspaceRef.current !== workspaceId) return;
    const requestId = ++loadRequestRef.current;
    const [mode, config, worldbuild] = await Promise.all([api.getWorkspaceExperienceMode(workspaceId), api.getRoleplayConfiguration(workspaceId), api.listEntities(workspaceId)]);
    if (requestId !== loadRequestRef.current || workspaceRef.current !== workspaceId) return;
    if (!mode?.success) throw new Error(mode?.error || 'Could not load the workspace experience mode.');
    if (!config?.success) throw new Error(config?.error || 'Could not load Roleplay configuration.');
    if (!worldbuild?.success) throw new Error(worldbuild?.error || 'Could not load Worldbuild entities.');
    const active = mode?.mode === 'roleplay';
    setEnabled(active);
    onModeChange?.(active);
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
    setPendingNarrativeTurn(config.pendingNarrativeTurn || null);
    setTimeMatrix(config.timeMatrix || EMPTY_TIME_MATRIX);
    setCalendar(config.calendar || { hoursPerDay: 24 });
    setEntities((worldbuild.entities || []).filter(entity => entity.status !== 'proposed'));
  }, [api, onModeChange, workspaceId]);

  const refreshActivity = useCallback(async () => {
    if (workspaceRef.current !== workspaceId) return;
    const requestId = ++activityRequestRef.current;
    const config = await api.getRoleplayConfiguration(workspaceId);
    if (requestId !== activityRequestRef.current || workspaceRef.current !== workspaceId) return;
    if (!config?.success) throw new Error(config?.error || 'Could not refresh Roleplay activity.');
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
    setPendingNarrativeTurn(config.pendingNarrativeTurn || null);
    setCalendar(config.calendar || { hoursPerDay: 24 });
  }, [api, workspaceId]);

  useEffect(() => {
    loadRequestRef.current += 1;
    activityRequestRef.current += 1;
    inspectRequestRef.current += 1;
    setResourceDraft(null);
    setDeletingResource(null);
    setDeletingResourceBusy(false);
    setAssignment({ definitionId: '', targetType: 'entity', targetIds: [], current: 100, maximum: 100 });
    setRemovingAssignment(null);
    setRemovingAssignmentBusy(false);
    setInspectId('');
    setResources([]);
    setPresenceOpen(false);
    setScenarioOpen(false);
    setEditingTimeCategoryId(null);
    setAssignmentEditorOpen(false);
    setActivityOpen(false);
  }, [workspaceId]);

  useEffect(() => { load().catch(error => showToast(error.message, 'error')); }, [load, showToast]);

  useEffect(() => {
    const refresh = event => {
      if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) {
        load().catch(error => showToast(error.message, 'error'));
      }
    };
    window.addEventListener('roleplay-state-change', refresh);
    const unsubscribe = api.onRoleplayResourceChanges?.(payload => {
      if (payload?.workspaceId === workspaceId) refreshActivity().catch(error => showToast(error.message, 'error'));
    });
    return () => {
      window.removeEventListener('roleplay-state-change', refresh);
      unsubscribe?.();
      loadRequestRef.current += 1;
      activityRequestRef.current += 1;
      inspectRequestRef.current += 1;
    };
  }, [api, load, refreshActivity, showToast, workspaceId]);

  useEffect(() => {
    if (!narrativeJobs.some(job => job.status === 'processing')) return undefined;
    setNarrativeNow(Date.now());
    const intervalId = window.setInterval(() => setNarrativeNow(Date.now()), 15000);
    return () => window.clearInterval(intervalId);
  }, [narrativeJobs]);

  const groups = useMemo(() => ({
    actors: entities.filter(entity => entity.type === 'Characters' || (entity.type === 'Creatures' && (entity.data?.scope || 'individual') !== 'group')),
    locations: entities.filter(entity => entity.type === 'Locations'),
    items: entities.filter(entity => entity.type === 'Items'),
    races: entities.filter(entity => entity.type === 'Races'),
    species: entities.filter(entity => entity.type === 'Creatures' && entity.data?.scope === 'group')
  }), [entities]);
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);
  const entityOptions = list => list.map(entity => ({ id: entity.id, label: entity.canonicalName, aliases: Array.isArray(entity.aliases) ? entity.aliases : String(entity.aliases || '').split(','), group: entity.type.replace(/s$/, '') }));
  const sceneLocationOptions = useMemo(() => locationPresenceOptions(groups.locations), [groups.locations]);
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
    if (!result?.success) {
      showToast(result?.error || 'Could not save roleplay settings.', 'error');
      await load();
    }
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
    setDeletingResourceBusy(true);
    const result = await api.deleteRoleplayResourceDefinition(workspaceId, definitionId);
    if (!result?.success) {
      setDeletingResourceBusy(false);
      return showToast(result?.error || 'Could not delete resource.', 'error');
    }
    try {
      setDeletingResource(null);
      setResourceDraft(current => current?.id === definitionId ? null : current);
      await load();
    } finally {
      setDeletingResourceBusy(false);
    }
  };
  const saveAssignment = async () => {
    const result = await api.setRoleplayResourceValues({ workspaceId, definitionId: assignment.definitionId, targetType: assignment.targetType, targetIds: assignment.targetIds, value: { current: Number(assignment.current), maximum: Number(assignment.maximum) } });
    if (!result?.success) return showToast(result?.error || 'Could not save resource assignment.', 'error');
    setAssignment(current => ({ ...current, targetIds: [] }));
    setAssignmentEditorOpen(false);
    await load();
  };
  const removeAssignment = async item => {
    setRemovingAssignmentBusy(true);
    const result = await api.removeRoleplayResourceValue({ workspaceId, definitionId: item.definitionId, targetType: item.targetType, targetId: item.targetId });
    if (!result?.success) {
      setRemovingAssignmentBusy(false);
      return showToast(result?.error || 'Could not remove resource assignment.', 'error');
    }
    try {
      setRemovingAssignment(null);
      await load();
      if (inspectId) await inspect(inspectId);
    } finally {
      setRemovingAssignmentBusy(false);
    }
  };
  const inspect = async entityId => {
    const requestId = ++inspectRequestRef.current;
    setInspectId(entityId);
    if (!entityId) return setResources([]);
    const result = await api.getRoleplayEntityResources(workspaceId, entityId);
    if (requestId !== inspectRequestRef.current || workspaceRef.current !== workspaceId) return;
    if (!result?.success) {
      setResources([]);
      return showToast(result?.error || 'Could not load entity state.', 'error');
    }
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
  const minutesPerDay = Math.max(1, Number(calendar.hoursPerDay) || 24) * 60;
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
  // Housekeeping is always previewed before it is applied. It changes what the campaign
  // considers current, so it is the reviewer's decision and never a silent background sweep.
  const previewCompaction = async () => {
    setCompactionBusy(true);
    try {
      const result = await api.compactNarrativeState(workspaceId, false);
      if (!result.success) throw new Error(result.error || 'Could not inspect the stored records.');
      if (!result.report.retired) {
        showToast('Nothing to clean up. Every stored record is unique and current.', 'success');
        return;
      }
      setCompaction(result.report);
    } catch (error) {
      showToast(error.message || 'Could not inspect the stored records.', 'error');
    } finally {
      setCompactionBusy(false);
    }
  };

  const applyCompaction = async () => {
    setCompactionBusy(true);
    try {
      const result = await api.compactNarrativeState(workspaceId, true);
      if (!result.success) throw new Error(result.error || 'Could not clean up the stored records.');
      setCompaction(null);
      showToast(`${result.report.retired} redundant record${result.report.retired === 1 ? '' : 's'} retired.`, 'success');
    } catch (error) {
      showToast(error.message || 'Could not clean up the stored records.', 'error');
    } finally {
      setCompactionBusy(false);
    }
  };

  const pendingNarrative = narrativeEvents.filter(event => event.status === 'proposed');
  const metricTotals = narrativeMetrics.reduce((total, metric) => ({ turns: total.turns + 1, deep: total.deep + (metric.deepAnalysis ? 1 : 0), tokens: total.tokens + metric.triageInputTokens + metric.triageOutputTokens + metric.deepInputTokens + metric.deepOutputTokens }), { turns: 0, deep: 0, tokens: 0 });
  const narrativeJobStaleAfter = 120000;
  const narrativeStateUpdating = narrativeJobs.some(job => job.status === 'processing' && narrativeNow - job.updatedAt <= narrativeJobStaleAfter);
  const delayedJobs = narrativeJobs.filter(job => job.status === 'failed' || (job.status === 'processing' && narrativeNow - job.updatedAt > narrativeJobStaleAfter));
  const recentEntities = entityChanges.filter(change => change.status === 'applied').slice(-5).reverse();
  const recentEvents = narrativeEvents.filter(event => event.status === 'approved').slice(-5).reverse();
  const recentActivityCount = recentEntities.length + recentEvents.length;
  const pendingCount = pendingResources.length + pendingScenes.length + pendingInventory.length + pendingEntities.length + pendingNarrative.length;
  const playerName = names.get(settings.playerEntityId) || 'Not selected';
  const locationName = names.get(scene.locationId) || 'No location';
  const nearbyCount = new Set([...(scene.possibleObserverIds || []), ...(scene.nearbyIds || [])]).size;
  const presenceSummary = `${scene.participantIds?.length || 0} participating · ${nearbyCount} nearby · ${scene.objectIds?.length || 0} objects`;
  const scenarioSummary = settings.scenarioName
    ? `${settings.scenarioName}${settings.scenarioSummary ? ' · Situation set' : ''}`
    : settings.scenarioSummary ? 'Situation set' : 'Not set';
  const narrativeStatus = narrativeStateUpdating
    ? { value: 'Updating state', tone: 'info' }
    : pendingCount > 0
      ? { value: `${pendingCount} to review`, tone: 'warning' }
      : { value: 'Up to date', tone: 'default' };

  return <div className="rounded-surface border border-border-subtle bg-surface-panel/50 p-3 sm:p-5 lg:p-6">
    <SectionHead icon={Drama} title="Roleplay Mode" desc="Set the active scene first. Open campaign systems only when you need deeper control." />
    <section className="overflow-hidden rounded-card border border-border-default bg-surface-canvas">
      <div className="flex min-w-0 items-center justify-between gap-6 px-5 py-4">
        <div className="min-w-0"><span className="text-sm font-semibold text-text-primary">Enable Roleplay Mode</span><p className="caption mt-1">Turning it off preserves every scene, resource, value, and history entry.</p></div>
        <button type="button" role="switch" aria-label="Enable Roleplay Mode" aria-checked={enabled} onClick={toggle} className={'relative h-7 w-12 shrink-0 overflow-hidden rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none ' + (enabled ? 'border-accent/50 bg-accent' : 'border-border-strong bg-surface-hover')}><span className={'absolute left-1 top-1 h-[1.125rem] w-[1.125rem] rounded-full bg-surface-canvas transition-transform motion-reduce:transition-none ' + (enabled ? 'translate-x-5' : '')} /></button>
      </div>
      {enabled && <div className="grid border-t border-border-subtle sm:grid-cols-3">
        <StatusSummary label="Playing as" value={playerName} />
        <StatusSummary label="Current location" value={locationName} divided />
        <StatusSummary label="Narrative State" value={narrativeStatus.value} tone={narrativeStatus.tone} divided />
      </div>}
    </section>

    {enabled && <div className="mt-5 space-y-5">
      <Panel icon={Clapperboard} title="Current Scene" summary={`${playerName} · ${locationName}`} description="Choose the active perspective, location, and who is present. These are the details used on the next roleplay turn." defaultOpen>
        <div className="grid gap-4 lg:grid-cols-3">
          <Field label="Player character" hint="The focal perspective used for roleplay context." fieldLabel={fieldLabel}><SearchableSelect ariaLabel="Player character" value={settings.playerEntityId || ''} onChange={value => saveSettings({ playerEntityId: value || null })} options={entityOptions(groups.actors)} placeholder="Select a character" /></Field>
          <Field label="Current location" hint="Where the active scene is happening." fieldLabel={fieldLabel}><SearchableSelect ariaLabel="Current location" value={scene.locationId || ''} onChange={value => saveScene({ locationId: value || null })} options={sceneLocationOptions} placeholder="Select a location" /></Field>
          <Field label="Narrative State Updates" hint={POLICY[settings.defaultUpdatePolicy]} fieldLabel={fieldLabel}><select aria-label="Narrative State update policy" className={inputClass} value={settings.defaultUpdatePolicy} onChange={event => saveSettings({ defaultUpdatePolicy: event.target.value })}><option value="manual">Manual only</option><option value="review">Review changes</option><option value="automatic">Automatic</option></select></Field>
        </div>
        <div className="mt-4 space-y-2">
          <NestedDisclosure id={presencePanelId} title="Presence" summary={presenceSummary} open={presenceOpen} onToggle={() => setPresenceOpen(current => !current)}>
            <div className="grid gap-4 lg:grid-cols-3">
              <Field label="Participating characters" hint="Characters currently taking part in the scene." fieldLabel={fieldLabel}><SearchableSelect ariaLabel="Participating characters" multiple values={scene.participantIds} onChange={value => saveScene({ participantIds: value })} options={entityOptions(groups.actors)} placeholder="Add participating characters" /></Field>
              <Field label="Nearby characters" hint="Present in the broader location. Narrative State determines what they actually notice from the narrative." fieldLabel={fieldLabel}><SearchableSelect ariaLabel="Nearby characters" multiple values={[...new Set([...(scene.possibleObserverIds || []), ...(scene.nearbyIds || [])])]} onChange={value => saveScene({ possibleObserverIds: [], nearbyIds: value })} options={entityOptions(groups.actors)} placeholder="Add nearby characters" /></Field>
              <Field label="Objects present" hint="Scene presence does not change ownership or inventory." fieldLabel={fieldLabel}><SearchableSelect ariaLabel="Objects present" multiple values={scene.objectIds} onChange={value => saveScene({ objectIds: value })} options={entityOptions(groups.items)} placeholder="Add objects in the scene" /></Field>
            </div>
          </NestedDisclosure>
          <NestedDisclosure id={scenarioPanelId} title="Scenario context" summary={scenarioSummary} open={scenarioOpen} onToggle={() => setScenarioOpen(current => !current)}>
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Scenario name" fieldLabel={fieldLabel}><input aria-label="Scenario name" className={inputClass} value={settings.scenarioName} onChange={event => setSettings({ ...settings, scenarioName: event.target.value })} onBlur={() => saveSettings({ scenarioName: settings.scenarioName })} placeholder="Siege at Dawn" /></Field>
              <Field label="Current situation" fieldLabel={fieldLabel}><textarea aria-label="Current situation" className={inputClass + ' custom-scrollbar min-h-20 resize-none'} value={settings.scenarioSummary} onChange={event => setSettings({ ...settings, scenarioSummary: event.target.value })} onBlur={() => saveSettings({ scenarioSummary: settings.scenarioSummary })} placeholder="Describe the immediate situation without replacing Worldbuild canon." /></Field>
            </div>
          </NestedDisclosure>
        </div>
      </Panel>

      {pendingCount > 0 && <Panel icon={AiGlyph} title="Pending AI Changes" summary={`${pendingCount} waiting`} description="Review changes that require your approval before they become part of the campaign state." defaultOpen>
        <div className="space-y-2">
          {pendingEntities.map(change => <Pending key={change.id} label={describeEntityChangeLabel(change)} detail={describeEntityChangeDetail(change, names)} onApprove={() => resolve('entity', change.id, 'approved')} onReject={() => resolve('entity', change.id, 'rejected')} />)}
          {pendingNarrative.map(item => <Pending key={item.proposal.changeSet.event.id} label={item.proposal.changeSet.event.description} detail={describeNarrativeEvent(item, names)} onApprove={() => resolve('narrative', item.proposal.changeSet.event.id, 'approved')} onReject={() => resolve('narrative', item.proposal.changeSet.event.id, 'rejected')} />)}
          {pendingScenes.map(change => <Pending key={change.id} label="Scene update" detail={describePatch(change.patch, names)} onApprove={() => resolve('scene', change.id, 'approved')} onReject={() => resolve('scene', change.id, 'rejected')} />)}
          {pendingInventory.map(change => <Pending key={change.id} label="Inventory update" detail={describeInventoryPatch(change.patch, names)} onApprove={() => resolve('inventory', change.id, 'approved')} onReject={() => resolve('inventory', change.id, 'rejected')} />)}
          {pendingResources.map(change => <Pending key={change.id} label={names.get(change.entityId) || change.entityId} detail={change.previousValue + ' → ' + change.nextValue} onApprove={() => resolve('resource', change.id, 'approved')} onReject={() => resolve('resource', change.id, 'rejected')} />)}
        </div>
      </Panel>}

      <Panel icon={Hourglass} title="Time Cost Matrix" summary={`${timeMatrix.categories.length} action ranges`} description="Optional timing rules for actions that do not state an exact duration. Explicit time in the narrative always takes priority.">
        {!timeMatrix.categories.length && <Empty text="No action ranges are configured." />}
        <div className="space-y-2">
          {timeMatrix.categories.map(category => {
            const editing = editingTimeCategoryId === category.id;
            const panelId = `${timeCategoryPanelId}-${category.id}`;
            return (
              <article key={category.id} className={`overflow-hidden rounded-card border bg-surface-panel-muted/45 transition-colors motion-reduce:transition-none ${editing ? 'border-border-strong' : 'border-border-subtle'}`}>
                <button
                  type="button"
                  aria-expanded={editing}
                  aria-controls={panelId}
                  onClick={() => setEditingTimeCategoryId(current => current === category.id ? null : category.id)}
                  className="flex min-h-14 w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold uppercase tracking-wider text-text-secondary">{category.name}</span>
                    <span className="mt-1 block truncate text-xs text-text-subtle">{category.guidance || 'No action guidance'}</span>
                  </span>
                  <span className="shrink-0 rounded-control border border-border-subtle bg-surface-input/55 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-text-secondary">{formatDurationRange(category, minutesPerDay)}</span>
                  <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-subtle transition-transform motion-reduce:transition-none ${editing ? 'rotate-180' : ''}`} />
                </button>
                {editing && (
                  <div id={panelId} className="border-t border-border-subtle p-3.5 sm:p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {category.id === 'timeskip' ? <>
                        <Field label="Minimum days" fieldLabel={fieldLabel}><NumberInput aria-label={`${category.name} minimum days`} className={inputClass} min={1} value={Math.max(1, Math.round(category.minimumMinutes / minutesPerDay))} onChange={days => updateTimeCategory(category.id, { minimumMinutes: days * minutesPerDay })} /></Field>
                        <Field label="Maximum days" fieldLabel={fieldLabel}><NumberInput aria-label={`${category.name} maximum days`} className={inputClass} min={Math.max(1, Math.round(category.minimumMinutes / minutesPerDay))} value={Math.max(1, Math.round(category.maximumMinutes / minutesPerDay))} onChange={days => updateTimeCategory(category.id, { maximumMinutes: Math.max(category.minimumMinutes, days * minutesPerDay) })} /></Field>
                      </> : <>
                        <Field label="Minimum minutes" fieldLabel={fieldLabel}><NumberInput aria-label={`${category.name} minimum minutes`} className={inputClass} min={1} value={category.minimumMinutes} onChange={minimumMinutes => updateTimeCategory(category.id, { minimumMinutes })} /></Field>
                        <Field label="Maximum minutes" fieldLabel={fieldLabel}><NumberInput aria-label={`${category.name} maximum minutes`} className={inputClass} min={category.minimumMinutes} value={category.maximumMinutes} onChange={maximumMinutes => updateTimeCategory(category.id, { maximumMinutes })} /></Field>
                      </>}
                    </div>
                    <Field label="Action guidance" fieldLabel={fieldLabel}><textarea aria-label={`${category.name} action guidance`} className={inputClass + ' custom-scrollbar mt-3 min-h-20 resize-none leading-relaxed'} value={category.guidance} onChange={event => updateTimeCategory(category.id, { guidance: event.target.value })} /></Field>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
          <p className="text-xs leading-relaxed text-text-subtle">Open one range to adjust it. Changes apply after saving the matrix.</p>
          <button type="button" onClick={saveTimeMatrix} className="inline-flex min-h-10 shrink-0 items-center rounded-control bg-accent px-4 text-xs font-bold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">Save time matrix</button>
        </div>
      </Panel>

      <Panel icon={Gauge} title="Tracked Resources" summary={`${definitions.length} configured`} description="Create reusable values such as Health, Stamina, or Mana, including how each value may change.">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-relaxed text-text-muted">Definitions describe the value and its AI policy. Assignments decide who receives it.</p>
          <button
            type="button"
            aria-expanded={Boolean(resourceDraft)}
            aria-controls={resourceEditorId}
            onClick={() => setResourceDraft(current => current ? null : { ...EMPTY_RESOURCE, updatePolicy: settings.defaultUpdatePolicy })}
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-control border border-accent/25 bg-accent/[0.06] px-3 text-xs font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {resourceDraft ? <X aria-hidden="true" className="h-4 w-4" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
            {resourceDraft ? 'Close editor' : 'Add resource'}
          </button>
        </div>
        {resourceDraft && <div id={resourceEditorId}><ResourceEditor draft={resourceDraft} setDraft={setResourceDraft} onSave={saveResource} onCancel={() => setResourceDraft(null)} inputClass={inputClass} fieldLabel={fieldLabel} /></div>}
        <div className="grid gap-3 md:grid-cols-2">{definitions.map(definition => <DefinitionCard key={definition.id} definition={definition} count={assignments.filter(item => item.definitionId === definition.id).length} onEdit={() => setResourceDraft({ ...definition })} onDelete={() => setDeletingResource(definition)} />)}</div>
        {!definitions.length && !resourceDraft && <Empty text="No tracked resources yet. Add Health, Stamina, Mana, or another numeric state." />}
      </Panel>

      <Panel icon={UserCog} title="Resource Assignments" summary={`${assignments.length} assignments`} description="Apply tracked resources to characters, races, or species. Individual values take priority over inherited defaults.">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl text-xs leading-relaxed text-text-muted">Create an explicit value only when a character, Race, or species should differ from the resource default.</p>
          <button
            type="button"
            disabled={!definitions.length}
            aria-expanded={assignmentEditorOpen}
            aria-controls={assignmentEditorId}
            onClick={() => setAssignmentEditorOpen(current => !current)}
            className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-control border border-accent/25 bg-accent/[0.06] px-3 text-xs font-semibold text-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {assignmentEditorOpen ? <X aria-hidden="true" className="h-4 w-4" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
            {assignmentEditorOpen ? 'Close editor' : 'New assignment'}
          </button>
        </div>
        {assignmentEditorOpen && (
          <div id={assignmentEditorId} className="mb-4 rounded-card border border-accent/20 bg-accent/[0.025] p-3.5 sm:p-4">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Resource" fieldLabel={fieldLabel}><SearchableSelect ariaLabel="Assigned resource" value={assignment.definitionId} onChange={definitionId => { const definition = definitions.find(item => item.id === definitionId); setAssignment(current => ({ ...current, definitionId, current: definition?.initialValue ?? 0, maximum: definition?.maximum ?? 100 })); }} options={definitionOptions} placeholder="Select a resource" /></Field>
              <Field label="Assignment level" fieldLabel={fieldLabel}><select aria-label="Resource assignment level" className={inputClass} value={assignment.targetType} onChange={event => setAssignment(current => ({ ...current, targetType: event.target.value, targetIds: [] }))}><option value="entity">Selected entities</option><option value="race">Race default</option><option value="species">Species default</option></select></Field>
              <Field label="Targets" fieldLabel={fieldLabel}><SearchableSelect ariaLabel="Resource assignment targets" multiple values={assignment.targetIds} onChange={targetIds => setAssignment(current => ({ ...current, targetIds }))} options={entityOptions(targets)} placeholder="Search and select targets" /></Field>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label="Current value" fieldLabel={fieldLabel}><input aria-label="Assigned current value" className={inputClass} type="number" value={assignment.current} onChange={event => setAssignment(current => ({ ...current, current: event.target.value }))} /></Field>
              <Field label="Maximum" fieldLabel={fieldLabel}><input aria-label="Assigned maximum value" className={inputClass} type="number" value={assignment.maximum} onChange={event => setAssignment(current => ({ ...current, maximum: event.target.value }))} /></Field>
              <button type="button" disabled={!assignment.definitionId || !assignment.targetIds.length} onClick={saveAssignment} className="mt-auto min-h-10 rounded-control bg-accent px-5 text-xs font-bold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40">Apply value</button>
            </div>
          </div>
        )}
        <AssignmentList assignments={assignments} definitions={definitions} names={names} onRemove={setRemovingAssignment} />
      </Panel>

      <Panel icon={HeartPulse} title="Entity State" summary={inspectId ? names.get(inspectId) || 'Selected entity' : 'Inspect effective values'} description="Check a character's current resources and whether each value is individual, inherited, or using its default.">
        <div className="grid gap-3 rounded-card border border-border-subtle bg-surface-panel-muted/45 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="Entity" hint="Select one character to inspect its effective state." fieldLabel={fieldLabel}><SearchableSelect ariaLabel="Entity state subject" value={inspectId} onChange={inspect} options={entityOptions(groups.actors)} placeholder="Search for an entity" /></Field>
          {inspectId && <span className="inline-flex min-h-10 items-center justify-center rounded-control border border-border-subtle bg-surface-input/55 px-3 text-xs font-semibold text-text-secondary">{resources.length} {resources.length === 1 ? 'value' : 'values'}</span>}
        </div>
        {inspectId ? (
          resources.length
            ? <div className="mt-4 grid gap-3 md:grid-cols-2">{resources.map(resource => <ResourceBar key={resource.definitionId} resource={resource} sourceName={names.get(resource.inheritedFrom)} onChange={value => changeValue(resource, value)} onRemove={resource.inheritedFromType === 'entity' ? () => setRemovingAssignment({ definitionId: resource.definitionId, definitionName: resource.name, targetType: 'entity', targetId: inspectId, targetName: names.get(inspectId) || inspectId }) : null} />)}</div>
            : <div className="mt-4"><Empty text="This entity has no tracked values yet." /></div>
        ) : <div className="mt-4"><Empty text="Select an entity to inspect its current and inherited values." /></div>}
      </Panel>

      <Panel icon={Activity} title="Narrative State Activity" summary={delayedJobs.length ? `${delayedJobs.length} need attention` : `${recentActivityCount} recent changes`} description="A compact overview of recent processing. Open diagnostics only when a turn needs investigation or recovery.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Recent turns" value={metricTotals.turns} />
          <Metric label="Deep analyses" value={metricTotals.deep} />
          <Metric label="Estimated tokens" value={metricTotals.tokens.toLocaleString()} />
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-card border border-border-subtle bg-surface-panel-muted/45 px-3.5 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-text-secondary">Record hygiene</p>
            <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-text-muted">Find statements stored more than once and momentary scene detail kept as durable canon. You see what would change before anything is applied.</p>
          </div>
          <button type="button" onClick={previewCompaction} disabled={compactionBusy} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-control border border-border-default px-3 text-[0.6875rem] font-semibold text-text-secondary hover:bg-surface-hover/60 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <AiGlyph className="h-3.5 w-3.5" />
            Check records
          </button>
        </div>

        <div className="mt-4">
          <NestedDisclosure
            id={activityPanelId}
            title="Diagnostics and recovery"
            summary={delayedJobs.length ? `${delayedJobs.length} interrupted or failed updates` : pendingNarrativeTurn ? 'Kept reply waiting for its state update' : `${recentActivityCount} recent records · No recovery needed`}
            open={activityOpen}
            onToggle={() => setActivityOpen(current => !current)}
          >
            {pendingNarrativeTurn && <div className={`${delayedJobs.length ? 'mb-2 ' : ''}flex flex-col gap-3 rounded-control border border-border-subtle bg-surface-panel-muted/45 px-3 py-3 sm:flex-row sm:items-center`}><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-text-secondary">Kept reply not analyzed yet</p><p className="mt-0.5 text-[0.6875rem] leading-relaxed text-text-muted">A switched or regenerated reply updates the story state once, when you continue. Update now to see it sooner.</p></div><button type="button" onClick={() => reprocess(pendingNarrativeTurn.originId)} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-control border border-border-subtle px-3 text-[0.6875rem] font-semibold text-text-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />Update now</button></div>}
            {delayedJobs.length > 0 && <div className="space-y-2">{delayedJobs.map(job => <div key={job.originId} className="flex flex-col gap-3 rounded-control border border-status-warning/25 bg-status-warning/[0.04] px-3 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-status-warning">{job.status === 'failed' ? 'State update failed' : 'State update interrupted'}</p><p className="mt-0.5 text-[0.6875rem] leading-relaxed text-text-muted">{job.error || 'This turn may be behind the visible narrative.'}</p></div><button type="button" onClick={() => reprocess(job.originId)} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-control border border-status-warning/25 px-3 text-[0.6875rem] font-semibold text-status-warning hover:bg-status-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-warning/40"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />Reprocess turn</button></div>)}</div>}
            {recentActivityCount > 0 ? <div className={`${delayedJobs.length || pendingNarrativeTurn ? 'mt-3' : ''} divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle`}>
              {recentEntities.map(change => <div key={change.id} className="bg-surface-panel-muted/45 px-3.5 py-3"><p className="text-xs font-semibold text-text-secondary">{describeEntityChangeLabel(change)}</p><p className="mt-1 text-[0.6875rem] leading-relaxed text-text-subtle">{describeEntityChangeDetail(change, names)}</p></div>)}
              {recentEvents.map(event => <div key={event.proposal.changeSet.event.id} className="bg-surface-panel-muted/45 px-3.5 py-3"><p className="text-xs font-semibold text-text-secondary">{event.proposal.changeSet.event.description}</p><p className="mt-1 text-[0.6875rem] leading-relaxed text-text-subtle">{describeNarrativeEvent(event, names)}</p></div>)}
            </div> : !delayedJobs.length && !pendingNarrativeTurn && <Empty text="No recent Narrative State activity or recovery issues." />}
          </NestedDisclosure>
        </div>
      </Panel>
    </div>}
    {compaction && (
      <ConfirmDialog
        title="Clean up stored records"
        message={<>
          <p><strong className="text-text-primary">{compaction.retired}</strong> of {compaction.scanned} stored records are redundant: {compaction.duplicates} repeated statement{compaction.duplicates === 1 ? '' : 's'}, {compaction.sceneState} piece{compaction.sceneState === 1 ? '' : 's'} of scene detail, {compaction.identifierContent} with unreadable content. The first copy of each statement is kept.</p>
          {compaction.samples.length > 0 && (
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs text-text-muted">
              {compaction.samples.map((sample, index) => (
                <li key={index} className="truncate"><span className="text-text-subtle">{sample.recordType}</span> · {sample.summary}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-text-subtle">Nothing is deleted. These records stop being part of the current campaign state and stay in the history.</p>
        </>}
        actions={[
          { label: 'Cancel', variant: 'ghost', onClick: () => { if (!compactionBusy) setCompaction(null); } },
          { label: 'Clean up', loading: compactionBusy, autoFocus: true, onClick: applyCompaction }
        ]}
        onClose={() => { if (!compactionBusy) setCompaction(null); }}
      />
    )}
    {deletingResource && (
      <ConfirmDialog
        title="Delete tracked resource"
        message={<>Delete <strong className="text-text-primary">“{deletingResource.name}”</strong>? Its assignments and stored values will also be removed.</>}
        actions={[
          { label: 'Cancel', variant: 'ghost', onClick: () => { if (!deletingResourceBusy) setDeletingResource(null); } },
          { label: 'Delete resource', variant: 'danger', loading: deletingResourceBusy, autoFocus: true, onClick: () => deleteResource(deletingResource.id) }
        ]}
        onClose={() => { if (!deletingResourceBusy) setDeletingResource(null); }}
      />
    )}
    {removingAssignment && (
      <ConfirmDialog
        title="Remove resource assignment"
        message={<>Remove <strong className="text-text-primary">{removingAssignment.definitionName || 'this resource'}</strong> from <strong className="text-text-primary">{removingAssignment.targetName || removingAssignment.targetId}</strong>? The target will return to its inherited or default value.</>}
        actions={[
          { label: 'Cancel', variant: 'ghost', onClick: () => { if (!removingAssignmentBusy) setRemovingAssignment(null); } },
          { label: 'Remove assignment', variant: 'danger', loading: removingAssignmentBusy, autoFocus: true, onClick: () => removeAssignment(removingAssignment) }
        ]}
        onClose={() => { if (!removingAssignmentBusy) setRemovingAssignment(null); }}
      />
    )}
  </div>;
}

// A proposed place says where it will sit, because approving it also files it there.
function describeLocationPlacement(proposal, names) {
  if (proposal?.type !== 'Locations') return '';
  const size = locationSizeLabel(proposal.size);
  const parent = proposal.insideId ? names.get(proposal.insideId) : null;
  if (size && parent) return `${size} inside ${parent}.`;
  if (parent) return `Inside ${parent}.`;
  return size ? `${size}.` : '';
}

function describeEntityChangeLabel(change) {
  const identity = change.identityUpdate;
  if (!identity) return `${change.proposal.type.replace(/s$/, '')}: ${change.proposal.name}`;
  if (identity.canonicalName) return `Rename ${identity.previousCanonicalName} to ${identity.canonicalName}`;
  return `Add aliases to ${identity.previousCanonicalName}`;
}

function describeEntityChangeDetail(change, names) {
  const identity = change.identityUpdate;
  if (!identity) {
    const text = change.status === 'conflicting'
      ? `Conflict: ${change.proposal.reason || change.proposal.description}`
      : change.proposal.description || change.proposal.reason;
    const placement = describeLocationPlacement(change.proposal, names);
    return placement ? `${placement} ${text || ''}`.trim() : text;
  }
  const details = [];
  if (identity.canonicalName) details.push(`The previous name remains as an alias.`);
  if (identity.aliases?.length) details.push(`New aliases: ${identity.aliases.join(', ')}.`);
  if (change.status === 'conflicting') details.push(`Conflict: ${identity.reason || change.proposal.reason || 'another identity uses this name.'}`);
  else if (identity.reason) details.push(identity.reason);
  return details.join(' ');
}

function Panel({ icon: Icon, title, summary, description, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  const headingId = useId();
  return (
    <section className={`overflow-hidden rounded-card border bg-surface-canvas transition-colors motion-reduce:transition-none ${open ? 'border-border-strong' : 'border-border-default'}`}>
      <button
        id={headingId}
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-controls={regionId}
        className="flex min-h-16 w-full items-center gap-3 p-3.5 text-left hover:bg-surface-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:px-4"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-accent/20 bg-accent/[0.07]"><Icon aria-hidden="true" className="h-4 w-4 text-accent" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold uppercase tracking-wider text-text-secondary">{title}</span>
          <span className={`mt-1 block text-xs leading-relaxed text-text-subtle ${open ? '' : 'truncate'}`}>{open ? description : summary || description}</span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-subtle transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div id={regionId} role="region" aria-labelledby={headingId} className="border-t border-border-subtle px-3.5 pb-4 pt-4 sm:px-5 sm:pb-5">{children}</div>}
    </section>
  );
}
function StatusSummary({ label, value, tone = 'default', divided = false }) {
  const valueClass = tone === 'warning' ? 'text-status-warning' : tone === 'info' ? 'text-status-info' : 'text-text-secondary';
  return <div className={`min-w-0 px-4 py-3 ${divided ? 'border-t border-border-subtle sm:border-l sm:border-t-0' : ''}`}><span className="block text-[0.625rem] font-bold uppercase tracking-wider text-text-subtle">{label}</span><strong className={`mt-1 block truncate text-sm ${valueClass}`}>{value}</strong></div>;
}
function NestedDisclosure({ id, title, summary, open, onToggle, children }) {
  const headingId = `${id}-heading`;
  return (
    <section className="overflow-hidden rounded-card border border-border-subtle bg-surface-panel-muted/45">
      <button
        id={headingId}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-hover/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-text-secondary">{title}</span><span className="mt-0.5 block truncate text-[0.6875rem] text-text-subtle">{summary}</span></span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-subtle transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div id={id} role="region" aria-labelledby={headingId} className="border-t border-border-subtle p-3.5">{children}</div>}
    </section>
  );
}
function Field({ label, hint, fieldLabel, children }) {
  return <div className="block" role="group" aria-label={label}><span className={fieldLabel + ' mb-1.5'}>{label}</span>{children}{hint && <span className="mt-1.5 block text-[0.6875rem] leading-relaxed text-text-subtle">{hint}</span>}</div>;
}
function Empty({ text }) { return <p className="rounded-card border border-dashed border-border-subtle px-4 py-6 text-center text-sm text-text-subtle">{text}</p>; }
function DefinitionCard({ definition, count, onEdit, onDelete }) {
  return (
    <article className="flex gap-3 rounded-card border border-border-subtle bg-surface-panel-muted/45 p-3.5 transition-colors hover:border-border-default motion-reduce:transition-none">
      <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: definition.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <h5 className="truncate text-sm font-semibold text-text-primary">{definition.name}</h5>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-muted">{definition.description || 'No AI guidance provided.'}</p>
          </div>
          <button type="button" onClick={onEdit} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-text-subtle hover:bg-surface-hover/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" aria-label={'Edit ' + definition.name}><Pencil aria-hidden="true" className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onDelete} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-text-subtle hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40" aria-label={'Delete ' + definition.name}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-text-muted">
          <span className="rounded-md border border-border-subtle px-2 py-1 tabular-nums">{definition.minimum}–{definition.maximum}</span>
          <span className="rounded-md border border-border-subtle px-2 py-1">{UPDATE_POLICY_LABEL[definition.updatePolicy] || definition.updatePolicy}</span>
          <span className="rounded-md border border-accent/20 bg-accent/[0.05] px-2 py-1 text-accent">{count} {count === 1 ? 'assignment' : 'assignments'}</span>
        </div>
      </div>
    </article>
  );
}
function ResourceEditor({ draft, setDraft, onSave, onCancel, inputClass, fieldLabel }) {
  const toggleType = type => setDraft({ ...draft, appliesTo: draft.appliesTo.includes(type) ? draft.appliesTo.filter(item => item !== type) : [...draft.appliesTo, type] });
  return (
    <div className="mb-4 rounded-card border border-accent/20 bg-accent/[0.025] p-3.5 sm:p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name" fieldLabel={fieldLabel}><input aria-label="Resource name" className={inputClass} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="Color" fieldLabel={fieldLabel}><ColorField ariaLabel="Resource color" value={draft.color} onChange={color => setDraft({ ...draft, color })} /></Field>
        <Field label="AI updates" hint={POLICY[draft.updatePolicy]} fieldLabel={fieldLabel}><select aria-label="Resource AI update policy" className={inputClass} value={draft.updatePolicy} onChange={event => setDraft({ ...draft, updatePolicy: event.target.value })}><option value="manual">Manual only</option><option value="review">Review changes</option><option value="automatic">Automatic</option></select></Field>
        <Field label="Minimum" fieldLabel={fieldLabel}><input aria-label="Resource minimum" className={inputClass} type="number" value={draft.minimum} onChange={event => setDraft({ ...draft, minimum: event.target.value })} /></Field>
        <Field label="Maximum" fieldLabel={fieldLabel}><input aria-label="Resource maximum" className={inputClass} type="number" value={draft.maximum} onChange={event => setDraft({ ...draft, maximum: event.target.value })} /></Field>
        <Field label="Initial value" fieldLabel={fieldLabel}><input aria-label="Resource initial value" className={inputClass} type="number" value={draft.initialValue} onChange={event => setDraft({ ...draft, initialValue: event.target.value })} /></Field>
      </div>
      <fieldset className="mt-4">
        <legend className={fieldLabel}>Applies to</legend>
        <div className="mt-2 flex flex-wrap gap-2">{['Characters', 'Creatures'].map(type => <button key={type} type="button" aria-pressed={draft.appliesTo.includes(type)} onClick={() => toggleType(type)} className={'min-h-9 rounded-control border px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' + (draft.appliesTo.includes(type) ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border-subtle text-text-muted hover:text-text-secondary')}>{type}</button>)}</div>
      </fieldset>
      <div className="mt-4"><Field label="Purpose and AI guidance" hint="Explain what this value means and when a narrative event should change it." fieldLabel={fieldLabel}><textarea aria-label="Resource purpose and AI guidance" className={inputClass + ' custom-scrollbar min-h-24 resize-none leading-relaxed'} value={draft.description || ''} onChange={event => setDraft({ ...draft, description: event.target.value })} /></Field></div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-9 rounded-control px-3 text-xs font-semibold text-text-muted hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Cancel</button>
        <button type="button" disabled={!draft.name.trim()} onClick={onSave} className="min-h-9 rounded-control bg-accent px-4 text-xs font-bold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40">Save resource</button>
      </div>
    </div>
  );
}
function AssignmentList({ assignments, definitions, names, onRemove }) {
  if (!assignments.length) return <Empty text="No explicit assignments. Resources currently use their default initial values." />;
  const definitionNames = new Map(definitions.map(item => [item.id, item.name]));
  return <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle">{assignments.map(item => {
    const definitionName = definitionNames.get(item.definitionId) || 'Unknown resource';
    const targetName = names.get(item.targetId) || item.targetId;
    return <div key={[item.definitionId, item.targetType, item.targetId].join(':')} className="flex items-center gap-3 bg-surface-panel-muted/45 px-3.5 py-3"><div className="min-w-0 flex-1"><span className="text-xs font-semibold text-text-secondary">{definitionName}</span><p className="truncate text-xs text-text-subtle"><span className="capitalize">{item.targetType}</span>: {targetName}</p></div><span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">{item.current} / {item.maximum}</span><button type="button" onClick={() => onRemove({ ...item, definitionName, targetName })} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-text-subtle hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40" aria-label={`Remove ${definitionName} from ${targetName}`}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button></div>;
  })}</div>;
}
function ResourceBar({ resource, sourceName, onChange, onRemove }) {
  const [draft, setDraft] = useState(String(resource.current));
  useEffect(() => setDraft(String(resource.current)), [resource.current]);
  const percentage = Math.max(0, Math.min(100, ((resource.current - resource.minimum) / Math.max(1, resource.maximum - resource.minimum)) * 100));
  const source = resource.inheritedFromType === 'entity' ? 'Individual override' : resource.inheritedFromType === 'default' ? 'Resource default' : 'Inherited from ' + (sourceName || resource.inheritedFromType);
  const commit = () => draft !== '' && draft !== '-' ? onChange(draft) : setDraft(String(resource.current));
  return <article className="rounded-card border border-border-subtle bg-surface-panel-muted/45 p-3.5"><div className="mb-3 flex justify-between gap-3"><div className="min-w-0"><h5 className="truncate text-sm font-semibold text-text-secondary">{resource.name}</h5><p className="text-[0.6875rem] text-text-subtle">{source}</p></div><label className="flex shrink-0 items-center gap-1 font-mono text-xs text-text-muted"><input type="number" min={resource.minimum} max={resource.maximum} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} aria-label={resource.name + ' current value'} className="w-16 rounded-control border border-border-default bg-surface-input px-2 py-1.5 text-right text-text-secondary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" /><span>/ {resource.maximum}</span></label></div><div className="h-2.5 overflow-hidden rounded-full bg-border-subtle" role="progressbar" aria-label={resource.name} aria-valuemin={resource.minimum} aria-valuemax={resource.maximum} aria-valuenow={resource.current}><div className="h-full rounded-full transition-[width] motion-reduce:transition-none" style={{ width: percentage + '%', backgroundColor: resource.color }} /></div>{onRemove && <button type="button" onClick={onRemove} className="mt-3 min-h-8 rounded-md px-2 text-[0.6875rem] font-semibold text-text-muted hover:bg-surface-hover/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Use inherited value</button>}</article>;
}
function Pending({ label, detail, onApprove, onReject }) {
  return <div className="flex items-center gap-3 rounded-card border border-status-warning/20 bg-status-warning/5 p-3"><Activity className="h-4 w-4 text-status-warning" /><div className="min-w-0 flex-1 text-xs text-text-secondary"><strong>{label}</strong><p className="truncate text-text-subtle">{detail}</p></div><button type="button" onClick={onApprove} className="p-1.5 text-status-success" aria-label="Approve change"><Check className="h-4 w-4" /></button><button type="button" onClick={onReject} className="p-1.5 text-status-danger" aria-label="Reject change"><X className="h-4 w-4" /></button></div>;
}
function Metric({ label, value }) {
  return <div className="rounded-card border border-border-subtle bg-surface-panel-muted/45 p-3.5"><span className="text-[0.625rem] font-bold uppercase tracking-wider text-text-subtle">{label}</span><strong className="mt-1 block text-lg tabular-nums text-text-secondary">{value}</strong></div>;
}
function formatDurationRange(category, minutesPerDay) {
  if (category.id === 'timeskip') {
    const minimumDays = Math.max(1, Math.round(category.minimumMinutes / minutesPerDay));
    const maximumDays = Math.max(minimumDays, Math.round(category.maximumMinutes / minutesPerDay));
    return `${minimumDays}–${maximumDays} days`;
  }
  return `${category.minimumMinutes}–${category.maximumMinutes} min`;
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

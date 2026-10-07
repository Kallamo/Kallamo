import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Drama, Scale } from 'lucide-react';
import Button from './ui/Button';
import Toggle from './ui/Toggle';
import { locationPresenceOptions, meta } from '../features/worldbuild/worldbuildConfig';
import { ConfigSection } from '../features/configuration/ConfigParts';
import SceneBlock from '../features/configuration/roleplay/SceneBlock';
import NarrativeStateSection from '../features/configuration/roleplay/NarrativeStateSection';
import CleanupDialog from '../features/configuration/roleplay/CleanupDialog';

const EMPTY_SETTINGS = { playerEntityId: null, locationEntityId: null, activeSceneId: null, scenarioName: '', scenarioSummary: '', defaultUpdatePolicy: 'review' };
const EMPTY_SCENE = { locationId: null, participantIds: [], possibleObserverIds: [], nearbyIds: [], objectIds: [] };
const EMPTY_PROGRESSION = { mode: 'off', members: [], progressingIds: [], playerEntityId: null, config: { policy: 'review', xp: { firstGoal: 1000, growth: 'add', growthAmount: 500, maxLevel: null, guidance: '', aiOnlyAdds: true }, attributes: { aiRaises: true, aiLowers: false, guidance: '' }, rewards: [] } };
const JOB_STALE_AFTER = 120000;

const RESOLVERS = {
  entity: 'resolveRoleplayEntityChange',
  narrative: 'resolveNarrativeStateEvent',
  scene: 'resolveRoleplaySceneChange',
  inventory: 'resolveRoleplayInventoryChange',
  resource: 'resolveRoleplayResourceChange',
  progress: 'resolveRoleplayProgressChange'
};

const isPending = change => change.status === 'pending' || change.status === 'proposed' || change.status === 'conflicting';
const eventTime = record => Date.parse(record.resolvedAt || record.proposal?.provenance?.createdAt || '') || 0;

/**
 * Roleplay in Configuration: the switch, the live scene and Narrative State. The world's rules
 * (resources, progression, time costs) live in Worldbuild and are only summarised here.
 */
export default function RoleplayModeSection({ workspaceId, api, showToast, registerSection, onStatusChange, onScrollTo }) {
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState(null);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [scene, setScene] = useState(EMPTY_SCENE);
  const [entities, setEntities] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [compaction, setCompaction] = useState(null);
  const [compactionBusy, setCompactionBusy] = useState(false);
  const loadRef = useRef(0);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

  const load = useCallback(async () => {
    const request = ++loadRef.current;
    const [mode, result, worldbuild] = await Promise.all([
      api.getWorkspaceExperienceMode(workspaceId),
      api.getRoleplayConfiguration(workspaceId),
      api.listEntities(workspaceId)
    ]);
    if (request !== loadRef.current || workspaceRef.current !== workspaceId) return;
    if (!mode?.success) throw new Error(mode?.error || 'Could not load the workspace mode.');
    if (!result?.success) throw new Error(result?.error || 'Could not load Roleplay.');
    setEnabled(mode.mode === 'roleplay');
    setConfig(result);
    setSettings(result.settings || EMPTY_SETTINGS);
    setScene(result.scene || EMPTY_SCENE);
    setEntities(((worldbuild?.success ? worldbuild.entities : []) || []).filter(entity => entity.status !== 'proposed'));
  }, [api, workspaceId]);

  useEffect(() => {
    setConfig(null);
    setCompaction(null);
    load().catch(error => showToast(error.message, 'error'));
  }, [load, showToast]);

  useEffect(() => {
    const refresh = event => {
      if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) load().catch(error => showToast(error.message, 'error'));
    };
    window.addEventListener('roleplay-state-change', refresh);
    const unsubscribe = api.onRoleplayResourceChanges?.(payload => {
      if (payload?.workspaceId === workspaceId) load().catch(error => showToast(error.message, 'error'));
    });
    return () => {
      window.removeEventListener('roleplay-state-change', refresh);
      unsubscribe?.();
      loadRef.current += 1;
    };
  }, [api, load, showToast, workspaceId]);

  const jobs = config?.narrativeJobs || [];
  useEffect(() => {
    if (!jobs.some(job => job.status === 'processing')) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(interval);
  }, [jobs]);

  const groups = useMemo(() => ({
    actors: entities.filter(entity => entity.type === 'Characters' || (entity.type === 'Creatures' && (entity.data?.scope || 'individual') !== 'group')),
    locations: entities.filter(entity => entity.type === 'Locations'),
    items: entities.filter(entity => entity.type === 'Items'),
    races: entities.filter(entity => entity.type === 'Races'),
    species: entities.filter(entity => entity.type === 'Creatures' && entity.data?.scope === 'group')
  }), [entities]);
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);
  const locationOptions = useMemo(() => locationPresenceOptions(groups.locations), [groups.locations]);
  const definitions = config?.definitions || [];
  const traits = config?.traits || [];
  const progression = config?.progression || EMPTY_PROGRESSION;

  const { pending, recent } = useMemo(() => {
    if (!config) return { pending: [], recent: [] };
    const definitionNames = new Map(definitions.map(definition => [definition.id, definition.name]));
    const traitNames = new Map(traits.map(trait => [trait.id, trait.name]));
    const all = [
      ...(config.entityChanges || []).map(change => ({ ...change, kind: 'entity' })),
      ...(config.narrativeEvents || []).map(record => ({ id: record.proposal.changeSet.event.id, kind: 'narrative', status: record.status, record, createdAt: eventTime(record) })),
      ...(config.sceneChanges || []).map(change => ({ ...change, kind: 'scene' })),
      ...(config.inventoryChanges || []).map(change => ({ ...change, kind: 'inventory' })),
      ...(config.changes || []).map(change => ({ ...change, kind: 'resource', definitionName: definitionNames.get(change.definitionId) })),
      ...(config.progressChanges || []).map(change => ({ ...change, kind: 'progress', progressKind: change.kind, traitName: traitNames.get(change.traitId) }))
    ];
    const done = all.filter(change => {
      if (change.kind === 'narrative') return change.status === 'approved';
      if (change.status !== 'applied') return false;
      if (change.kind === 'scene') return change.source === 'ai' && Object.hasOwn(change.patch || {}, 'locationId');
      if (change.kind === 'resource') return change.source === 'ai';
      if (change.kind === 'progress') return change.source === 'ai' || change.source === 'level';
      if (change.kind === 'inventory') return change.source === 'ai';
      return true;
    });
    return {
      pending: all.filter(isPending).sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0)),
      recent: done.sort((left, right) => (right.resolvedAt || right.createdAt || 0) - (left.resolvedAt || left.createdAt || 0)).slice(0, 40)
    };
  }, [config, definitions, traits]);

  const updating = jobs.some(job => job.status === 'processing' && now - job.updatedAt <= JOB_STALE_AFTER);
  const delayedJobs = jobs.filter(job => job.status === 'failed' || (job.status === 'processing' && now - job.updatedAt > JOB_STALE_AFTER));

  useEffect(() => { onStatusChange?.({ enabled, pendingCount: pending.length }); }, [enabled, onStatusChange, pending.length]);

  const toggle = async next => {
    setEnabled(next);
    window.dispatchEvent(new CustomEvent('roleplay-mode-change', { detail: { workspaceId, enabled: next } }));
    const result = await api.setWorkspaceExperienceMode(workspaceId, next ? 'roleplay' : 'standard');
    if (!result?.success) {
      setEnabled(!next);
      window.dispatchEvent(new CustomEvent('roleplay-mode-change', { detail: { workspaceId, enabled: !next } }));
      showToast(result?.error || 'Could not turn Roleplay on or off.', 'error');
    }
  };

  const announce = () => window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  const saveSettings = async patch => {
    const next = { ...settings, ...patch };
    setSettings(next);
    const result = await api.saveRoleplaySettings(workspaceId, next);
    if (!result?.success) {
      showToast(result?.error || 'Could not save.', 'error');
      await load();
      return;
    }
    setSettings(result.settings);
    announce();
  };
  const saveScene = async patch => {
    setScene(current => ({ ...current, ...patch }));
    const result = await api.saveRoleplayScene(workspaceId, patch);
    if (!result?.success) {
      showToast(result?.error || 'Could not save the scene.', 'error');
      await load();
      return;
    }
    setScene(result.scene);
    announce();
  };

  const resolve = async (item, decision) => {
    const method = api[RESOLVERS[item.kind]];
    if (!method) return;
    const result = await method(workspaceId, item.id, decision);
    if (!result?.success) {
      showToast(result?.error || 'Could not resolve the change.', 'error');
      return;
    }
    await load();
    announce();
  };
  const resolveMany = async (items, decision) => {
    let failed = 0;
    for (const item of items) {
      const result = await api[RESOLVERS[item.kind]]?.(workspaceId, item.id, decision);
      if (!result?.success) failed += 1;
    }
    if (failed) showToast(`${failed} ${failed === 1 ? 'change' : 'changes'} could not be resolved.`, 'error');
    await load();
    announce();
  };
  const reprocess = async originId => {
    const result = await api.reprocessNarrativeStateTurn(workspaceId, originId);
    if (!result?.success) return showToast(result?.error || 'Could not read the turn again.', 'error');
    showToast('The turn was read again.', 'success');
    await load();
  };

  const previewCompaction = async () => {
    setCompactionBusy(true);
    try {
      const result = await api.compactNarrativeState(workspaceId, false);
      if (!result?.success) throw new Error(result?.error || 'Could not check the records.');
      if (!result.report.retired) showToast('Nothing to tidy. Every stored record is unique and current.', 'success');
      else setCompaction(result.report);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setCompactionBusy(false);
    }
  };
  const applyCompaction = async () => {
    setCompactionBusy(true);
    try {
      const result = await api.compactNarrativeState(workspaceId, true);
      if (!result?.success) throw new Error(result?.error || 'Could not tidy the records.');
      setCompaction(null);
      showToast(`${result.report.retired} ${result.report.retired === 1 ? 'record' : 'records'} retired.`, 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setCompactionBusy(false);
    }
  };

  const problems = [
    ...delayedJobs.map(job => ({
      key: `job:${job.originId}`,
      tone: 'warning',
      title: job.status === 'failed' ? 'A turn failed to update' : 'A turn stopped while updating',
      detail: `${job.error ? `${job.error} ` : ''}The record may be behind the chat until this turn is read again.`,
      action: 'Try again',
      onFix: () => reprocess(job.originId)
    })),
    ...(config?.pendingNarrativeTurn ? [{
      key: 'kept-reply',
      tone: 'info',
      title: "The reply you kept isn't in the record yet",
      detail: 'A switched or regenerated reply is read once, when you continue. Update now to see it sooner.',
      action: 'Update now',
      onFix: () => reprocess(config.pendingNarrativeTurn.originId)
    }] : [])
  ];

  const player = entities.find(entity => entity.id === settings.playerEntityId);
  const location = entities.find(entity => entity.id === scene.locationId);
  const narrativeSummary = updating
    ? { text: 'Reading the last reply', className: 'text-status-info' }
    : pending.length
      ? { text: `${pending.length} ${pending.length === 1 ? 'change' : 'changes'} to review`, className: 'text-status-warning' }
      : { text: 'Up to date', className: 'text-text-primary' };

  return (
    <>
      <ConfigSection
        id="roleplay"
        sectionRef={registerSection?.('roleplay')}
        icon={Drama}
        title="Roleplay"
        description={enabled
          ? 'Turning it off keeps every scene, value and history entry for later.'
          : 'Play inside the story. The AI keeps track of the scene, the clock, resources such as Health, and what each character knows.'}
        action={<Toggle checked={enabled} onChange={toggle} ariaLabel="Roleplay" />}
      >
        {enabled && config && (
          <div className="flex flex-col gap-5">
            <div className="grid overflow-hidden rounded-card border border-border-subtle bg-surface-inset sm:grid-cols-3">
              <StatusCell label="Playing as" value={player?.canonicalName || 'No one yet'} dot={player ? meta(player.type).dot : null} />
              <StatusCell label="Location" value={location?.canonicalName || 'Not set'} dot={location ? meta('Locations').dot : null} divided />
              <div className="flex min-w-0 items-center gap-2.5 border-t border-border-subtle px-4 py-3 sm:border-l sm:border-t-0">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-xs text-text-subtle">Narrative State</span>
                  <span className={`truncate text-sm font-semibold ${narrativeSummary.className}`}>{narrativeSummary.text}</span>
                </span>
                {pending.length > 0 && <Button variant="ghost" size="sm" onClick={() => onScrollTo?.('narrative-state')}>Review</Button>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3.5 rounded-card border border-border-subtle bg-surface-inset px-4 py-3.5">
              <Scale aria-hidden="true" className="h-4.5 w-4.5 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] font-semibold text-text-secondary">World rules</span>
                <span className="block text-xs leading-relaxed text-text-subtle">{describeRules(definitions, progression, config.timeMatrix)} They belong to the world, in Worldbuild.</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('open-worldbuild-surface', { detail: { surface: 'rules' } }))}>Open in Worldbuild</Button>
            </div>
            <SceneBlock
              sectionRef={registerSection?.('roleplay-scene')}
              settings={settings}
              scene={scene}
              groups={groups}
              locationOptions={locationOptions}
              onSaveSettings={saveSettings}
              onDraftSettings={patch => setSettings(current => ({ ...current, ...patch }))}
              onSaveScene={saveScene}
            />
          </div>
        )}
      </ConfigSection>

      {enabled && config && (
        <>
          <NarrativeStateSection
            sectionRef={registerSection?.('narrative-state')}
            policy={settings.defaultUpdatePolicy}
            onPolicy={policy => saveSettings({ defaultUpdatePolicy: policy })}
            pending={pending}
            recent={recent}
            problems={problems}
            updating={updating}
            metrics={config.narrativeMetrics || []}
            names={names}
            onResolve={resolve}
            onResolveMany={resolveMany}
            onReprocess={reprocess}
            onTidy={previewCompaction}
            tidyBusy={compactionBusy && !compaction}
          />
        </>
      )}

      {compaction && <CleanupDialog report={compaction} busy={compactionBusy} onCancel={() => setCompaction(null)} onApply={applyCompaction} />}
    </>
  );
}

function describeRules(definitions, progression, timeMatrix) {
  const style = progression?.mode === 'levels' ? 'Levels and attributes' : null;
  const ranges = timeMatrix?.categories?.length || 0;
  const parts = [
    `${definitions.length} ${definitions.length === 1 ? 'resource' : 'resources'}`,
    style || 'no progression',
    `${ranges} time ${ranges === 1 ? 'range' : 'ranges'}`
  ];
  return `${parts.join(' · ')}.`;
}

function StatusCell({ label, value, dot, divided = false }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 px-4 py-3 ${divided ? 'border-t border-border-subtle sm:border-l sm:border-t-0' : ''}`}>
      <span className="text-xs text-text-subtle">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-primary">
        {dot && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

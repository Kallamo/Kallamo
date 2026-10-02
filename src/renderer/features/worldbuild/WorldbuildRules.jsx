import { useCallback, useEffect, useMemo, useState } from 'react';
import SegmentedControl from '../../components/ui/SegmentedControl';
import ResourcesSection from '../configuration/roleplay/ResourcesSection';
import ProgressionSection from '../configuration/roleplay/ProgressionSection';
import TimeCostsSection from '../configuration/roleplay/TimeCostsSection';

const EMPTY_PROGRESSION = { mode: 'off', members: [], progressingIds: [], playerEntityId: null, config: { policy: 'review', xp: { firstGoal: 1000, growth: 'add', growthAmount: 500, maxLevel: null, guidance: '', aiOnlyAdds: true }, attributes: { aiRaises: true, aiLowers: false, guidance: '' }, rewards: [] } };

/**
 * How this world works in roleplay: its resources, how characters grow, and what time costs.
 * The rules belong to the world, so they live here and travel with its export.
 */
export default function WorldbuildRules({ workspaceId, api, showToast, entities, worldName, onOpenCalendar }) {
  const [tab, setTab] = useState('resources');
  const [config, setConfig] = useState(null);

  const load = useCallback(async () => {
    const result = await api.getRoleplayConfiguration(workspaceId);
    if (!result?.success) return showToast(result?.error || 'Could not load the rules.', 'error');
    setConfig(result);
  }, [api, showToast, workspaceId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) load(); };
    window.addEventListener('roleplay-state-change', refresh);
    return () => window.removeEventListener('roleplay-state-change', refresh);
  }, [load, workspaceId]);

  const confirmed = useMemo(() => entities.filter(entity => entity.status !== 'proposed'), [entities]);
  const groups = useMemo(() => ({
    actors: confirmed.filter(entity => entity.type === 'Characters' || (entity.type === 'Creatures' && (entity.data?.scope || 'individual') !== 'group')),
    races: confirmed.filter(entity => entity.type === 'Races'),
    species: confirmed.filter(entity => entity.type === 'Creatures' && entity.data?.scope === 'group')
  }), [confirmed]);
  const names = useMemo(() => new Map(confirmed.map(entity => [entity.id, entity.canonicalName])), [confirmed]);

  const changed = async () => {
    await load();
    window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  };
  const saveTimeMatrix = async matrix => {
    const result = await api.saveRoleplayTimeMatrix(workspaceId, matrix);
    if (!result?.success) return showToast(result?.error || 'Could not save the time costs.', 'error');
    showToast('Time costs saved.', 'success');
    await changed();
  };

  const definitions = config?.definitions || [];
  const progression = config?.progression || EMPTY_PROGRESSION;

  return (
    <div className="flex flex-col gap-5 px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.75rem] font-bold leading-tight text-text-primary">{worldName ? `${worldName} rules` : 'Rules'}</h1>
          <p className="mt-1 text-[0.8125rem] text-text-secondary">How this world works in roleplay. They travel with the world when you export it.</p>
        </div>
        <SegmentedControl
          className="glass-panel"
          label="Rules"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'resources', label: 'Resources', count: definitions.length },
            { value: 'progression', label: 'Progression' },
            { value: 'time', label: 'Time costs' }
          ]}
        />
      </div>

      <div className="glass-panel rounded-surface border border-border-subtle bg-surface-panel/75 p-5 sm:p-6">
        {!config ? (
          <p className="text-[0.8125rem] text-text-muted">Loading the rules…</p>
        ) : tab === 'resources' ? (
          <ResourcesSection
            embedded
            workspaceId={workspaceId}
            api={api}
            showToast={showToast}
            definitions={definitions}
            assignments={config.assignments || []}
            groups={groups}
            names={names}
            defaultPolicy={config.settings?.defaultUpdatePolicy || 'review'}
            onChanged={changed}
          />
        ) : tab === 'progression' ? (
          <ProgressionSection
            embedded
            workspaceId={workspaceId}
            api={api}
            showToast={showToast}
            progression={progression}
            traits={config.traits || []}
            definitions={definitions}
            groups={groups}
            names={names}
            onChanged={changed}
          />
        ) : (
          <TimeCostsSection
            embedded
            matrix={config.timeMatrix || { categories: [] }}
            calendar={config.calendar}
            onSave={saveTimeMatrix}
            onOpenCalendar={onOpenCalendar}
          />
        )}
      </div>
    </div>
  );
}

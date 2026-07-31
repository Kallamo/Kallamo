import React, { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';

export default function WorldbuildRoleplayResources({ workspaceId, entity, api, showToast }) {
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

  return <div className="rounded-2xl border border-white/10 bg-[#07151b]/70 p-4 backdrop-blur-md">
    <div className="mb-4 flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /><div><h3 className="text-xs font-bold uppercase tracking-wider text-gray-200">Roleplay State</h3><p className="caption mt-0.5">Live values inherited from Race or species, with entity overrides.</p></div></div>
    <div className="grid gap-3 sm:grid-cols-2">{resources.map(resource => {
      const percentage = Math.max(0, Math.min(100, ((resource.current - resource.minimum) / (resource.maximum - resource.minimum)) * 100));
      return <ResourceCard key={resource.definitionId} resource={resource} percentage={percentage} onCommit={value => update(resource, value)} />;
    })}</div>
  </div>;
}

function ResourceCard({ resource, percentage, onCommit }) {
  const [draft, setDraft] = useState(String(resource.current));
  useEffect(() => setDraft(String(resource.current)), [resource.current]);
  const commit = () => { if (draft !== '' && draft !== '-') onCommit(draft); else setDraft(String(resource.current)); };
  return <div className="rounded-lg border border-white/10 bg-[#06121a]/70 p-3"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs font-semibold text-gray-200">{resource.name}</span><label className="flex items-center gap-1 font-mono text-[0.7rem] text-gray-400"><input type="number" min={resource.minimum} max={resource.maximum} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} aria-label={`${resource.name} current value`} className="w-16 rounded border border-white/10 bg-[#011419] px-2 py-1 text-right focus:border-accent focus:outline-none" /><span>/ {resource.maximum}</span></label></div><div className="h-2 overflow-hidden rounded-full bg-gray-800" role="progressbar" aria-label={resource.name} aria-valuemin={resource.minimum} aria-valuemax={resource.maximum} aria-valuenow={resource.current}><div className="h-full rounded-full transition-[width]" style={{ width: `${percentage}%`, backgroundColor: resource.color }} /></div>{resource.inheritedFrom && <p className="mt-1.5 text-[0.65rem] text-gray-600">Using inherited default until edited.</p>}</div>;
}

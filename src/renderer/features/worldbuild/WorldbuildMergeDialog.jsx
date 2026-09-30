import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Merge, Search } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import SegmentedControl from '../../components/ui/SegmentedControl';
import { entityMeta } from './worldbuildConfig';

const Medal = ({ entity }) => {
  const m = entityMeta(entity);
  const Icon = m.icon;
  return <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${m.medallion}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>;
};

// What each side brings, in a few words: a proposal by its passages, a sheet by what is filled.
const summarize = (entity, links) => {
  if (entity.status === 'proposed') {
    const passages = Array.isArray(entity.data?.proposalEvidence) ? entity.data.proposalEvidence.length : 0;
    return passages ? `Proposed · ${passages} ${passages === 1 ? 'passage' : 'passages'}` : 'Proposed';
  }
  const filled = (value) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
  const own = Object.entries(entity.data || {}).filter(([key, value]) => !key.startsWith('_') && key !== 'customFields' && key !== 'loreDocumentIds' && key !== 'aiPolicy' && filled(value)).length;
  const custom = Object.values(entity.data?.customFields || {}).filter(filled).length;
  const fields = own + custom + (String(entity.lore || '').trim() ? 1 : 0);
  const parts = [fields ? `${fields} ${fields === 1 ? 'field' : 'fields'}` : 'Nothing filled yet'];
  if (links) parts.push(`${links} ${links === 1 ? 'connection' : 'connections'}`);
  return parts.join(' · ');
};

// Folding one entity into another: pick the target, see both sides, say which value wins.
export default function WorldbuildMergeDialog({ source, targets, suggestedId = null, saving = false, api, onMerge, onClose }) {
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState(suggestedId);
  const [prefer, setPrefer] = useState('target');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = targets.filter(entity => !q || [entity.canonicalName, ...(entity.aliases || [])].join(' ').toLowerCase().includes(q));
    return matches.sort((a, b) => (b.id === suggestedId) - (a.id === suggestedId) || (a.type === source.type ? -1 : 0) - (b.type === source.type ? -1 : 0) || a.canonicalName.localeCompare(b.canonicalName)).slice(0, 40);
  }, [query, targets, suggestedId, source.type]);
  const target = targets.find(entity => entity.id === targetId) || null;
  const [linkCounts, setLinkCounts] = useState({});
  useEffect(() => {
    let live = true;
    const ids = [source.id, target?.id].filter(id => id && linkCounts[id] === undefined);
    Promise.all(ids.map(async id => {
      const [from, to] = await Promise.all([api?.getEntityLinks?.(id, 'from'), api?.getEntityLinks?.(id, 'to')].map(call => Promise.resolve(call).catch(() => null)));
      return [id, (from?.links?.length || 0) + (to?.links?.length || 0)];
    })).then(entries => { if (live && entries.length) setLinkCounts(current => ({ ...current, ...Object.fromEntries(entries) })); });
    return () => { live = false; };
  }, [api, source.id, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal onClose={onClose} size="lg" title={`Merge ${source.canonicalName} into…`} icon={Merge} iconClassName="text-text-muted">
      <div className="space-y-4 p-5">
        <label className="relative block">
          <span className="sr-only">Search entities</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search entities"
            className="wb-input min-h-10 w-full rounded-control border border-border-default bg-surface-input pl-9 pr-3 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20" />
        </label>
        <div role="listbox" aria-label="Merge target" className="max-h-56 space-y-0.5 overflow-y-auto custom-scrollbar">
          {list.length === 0 && <p className="caption py-4 text-center">No entity matches.</p>}
          {list.map(entity => (
            <button key={entity.id} type="button" role="option" aria-selected={entity.id === targetId} onClick={() => setTargetId(entity.id)}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-control px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${entity.id === targetId ? 'bg-surface-hover' : 'hover:bg-surface-hover/60'}`}>
              <Medal entity={entity} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{entity.canonicalName}</span>
              {entity.id === suggestedId && <span className="shrink-0 text-xs text-text-subtle">Same passages</span>}
            </button>
          ))}
        </div>
        {target && (
          <>
            <div className="flex items-center gap-2.5">
              <div className="min-w-0 flex-1 rounded-control border border-border-subtle p-3">
                <div className="text-xs text-text-muted">Merging</div>
                <div className="mt-1.5 flex items-center gap-2"><Medal entity={source} /><span className="truncate text-sm font-semibold text-text-primary">{source.canonicalName}</span></div>
                <div className="mt-1.5 text-xs text-text-subtle">{summarize(source, linkCounts[source.id])}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
              <div className="min-w-0 flex-1 rounded-control border border-border-subtle p-3">
                <div className="text-xs text-text-muted">Into</div>
                <div className="mt-1.5 flex items-center gap-2"><Medal entity={target} /><span className="truncate text-sm font-semibold text-text-primary">{target.canonicalName}</span></div>
                <div className="mt-1.5 text-xs text-text-subtle">{summarize(target, linkCounts[target.id])}</div>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-text-muted">When both have a value, keep</div>
              <SegmentedControl label="Which value wins" value={prefer} onChange={setPrefer}
                options={[{ value: 'target', label: `${target.canonicalName}'s` }, { value: 'source', label: `${source.canonicalName}'s` }]} />
              <p className="caption mt-1.5">{source.canonicalName} becomes another name of {target.canonicalName}. Links and story tags move over.</p>
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button icon={Merge} disabled={!target} loading={saving} onClick={() => onMerge(target.id, prefer)}>{target ? `Merge into ${target.canonicalName}` : 'Merge'}</Button>
      </div>
    </Modal>
  );
}

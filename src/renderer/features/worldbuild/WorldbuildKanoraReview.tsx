import { useMemo, useState } from 'react';
import { AlertTriangle, BookCheck, Check, Eye, Link2, Sparkles, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import type { Toast, WorldbuildApi, WorldbuildEntity } from './worldbuildTypes';

interface ReviewOperation {
  id: string;
  kind: string;
  subjectId?: string;
  targetId?: string;
  title?: string;
  summary: string;
  method?: string;
  confidence?: number;
}

interface ReviewProposal {
  eventId: string;
  description: string;
  excerpt: string;
  createdAt: string;
  legacy?: boolean;
  operations: ReviewOperation[];
}

export default function WorldbuildKanoraReview({
  workspaceId, proposals, entities, api, showToast, onChanged,
}: {
  workspaceId: string;
  proposals: ReviewProposal[];
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
  onChanged(): Promise<void> | void;
}) {
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected'>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const decide = (operationId: string, decision: 'approved' | 'rejected') => {
    setDecisions(current => ({ ...current, [operationId]: decision }));
  };

  const decideAll = (proposal: ReviewProposal, decision: 'approved' | 'rejected') => {
    setDecisions(current => {
      const next = { ...current };
      proposal.operations.forEach(operation => { next[operation.id] = decision; });
      return next;
    });
  };

  const submit = async (proposal: ReviewProposal) => {
    const approved = proposal.operations.filter(operation => decisions[operation.id] === 'approved').map(operation => operation.id);
    const rejected = proposal.operations.filter(operation => decisions[operation.id] === 'rejected').map(operation => operation.id);
    if (approved.length + rejected.length !== proposal.operations.length) {
      showToast('Review every suggestion before finishing this Kanora update.', 'error');
      return;
    }
    setSaving(proposal.eventId);
    try {
      const result = await api.resolveNarrativeStateOperations(workspaceId, proposal.eventId, approved, rejected);
      if (!result.success) throw new Error(result.error || 'Could not resolve the Kanora update.');
      setDecisions(current => {
        const next = { ...current };
        proposal.operations.forEach(operation => delete next[operation.id]);
        return next;
      });
      await onChanged();
      showToast(approved.length ? `${approved.length} Kanora suggestion${approved.length === 1 ? '' : 's'} applied.` : 'Kanora suggestions rejected.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not resolve the Kanora update.', 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      {proposals.map(proposal => {
        const reviewed = proposal.operations.filter(operation => decisions[operation.id]).length;
        return (
          <section key={proposal.eventId} className="overflow-hidden rounded-xl border border-violet-300/20 bg-[#0a1721]/70 backdrop-blur-md">
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-4 py-3.5">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                  <Sparkles className="h-4 w-4 text-violet-300" />
                  Kanora perspective suggestions
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{proposal.description}</p>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-gray-400">{reviewed}/{proposal.operations.length} reviewed</span>
            </header>

            {proposal.legacy && (
              <div className="flex gap-2 border-b border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-xs leading-relaxed text-amber-100/80">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This proposal was created by the previous extraction model. Review ownership and direction carefully. Applying it is disabled; reject it and run Update Entities again.
              </div>
            )}

            <div className="space-y-2.5 p-4">
              {proposal.operations.map(operation => {
                const decision = decisions[operation.id];
                const source = names.get(operation.subjectId || '') || 'Unknown subject';
                const target = names.get(operation.targetId || '');
                const scope = operation.kind === 'fact'
                  ? `Global canon${target ? ` · About ${target}` : ''}`
                  : `${source}${target ? ` → ${target}` : ''}`;
                return (
                  <article key={operation.id} className={`rounded-xl border px-4 py-3.5 transition-colors ${decision === 'approved' ? 'border-emerald-300/30 bg-emerald-300/[0.06]' : decision === 'rejected' ? 'border-rose-300/25 bg-rose-300/[0.05]' : 'border-white/[0.09] bg-black/10'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-violet-300/20 bg-violet-300/[0.08] px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-violet-200">{operation.kind}</span>
                          <span className="text-xs text-gray-400">{scope}</span>
                        </div>
                        {operation.title && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">{operation.title}</p>}
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">{operation.summary || 'No usable content was extracted.'}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                          {operation.method && <span className="inline-flex items-center gap-1 capitalize"><Eye className="h-3 w-3" />{operation.method}</span>}
                          {operation.confidence !== undefined && <span>{Math.round(operation.confidence * 100)}% confidence</span>}
                          {operation.kind === 'relationship' && <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />Directional perspective</span>}
                          {operation.kind === 'fact' && <span className="inline-flex items-center gap-1"><BookCheck className="h-3 w-3" />Saved to Facts when approved</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button type="button" disabled={proposal.legacy || saving === proposal.eventId} onClick={() => decide(operation.id, 'approved')} data-tooltip="Apply suggestion" className={`rounded-md p-2 transition-colors ${decision === 'approved' ? 'bg-emerald-300 text-[#041912]' : 'text-gray-500 hover:bg-emerald-300/10 hover:text-emerald-300'}`}><Check className="h-4 w-4" /></button>
                        <button type="button" disabled={saving === proposal.eventId} onClick={() => decide(operation.id, 'rejected')} data-tooltip="Reject suggestion" className={`rounded-md p-2 transition-colors ${decision === 'rejected' ? 'bg-rose-300 text-[#21080d]' : 'text-gray-500 hover:bg-rose-300/10 hover:text-rose-300'}`}><X className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {proposal.excerpt && <p className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2 text-xs italic leading-relaxed text-gray-500">{proposal.excerpt}</p>}
            </div>
            <footer className="flex flex-col gap-3 border-t border-white/[0.08] px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
              <p className="text-xs text-gray-500">Each suggestion has its own decision. Only approved operations are written.</p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button size="sm" variant="ghost" disabled={proposal.legacy || saving === proposal.eventId} onClick={() => decideAll(proposal, 'approved')}>Approve all</Button>
                <Button size="sm" variant="ghost" disabled={saving === proposal.eventId} onClick={() => decideAll(proposal, 'rejected')}>Reject all</Button>
                <Button size="sm" loading={saving === proposal.eventId} disabled={reviewed !== proposal.operations.length} onClick={() => submit(proposal)}>Finish review</Button>
              </div>
            </footer>
          </section>
        );
      })}
    </div>
  );
}

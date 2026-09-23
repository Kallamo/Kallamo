import { useMemo, useState } from 'react';
import { AlertTriangle, BookCheck, Check, Eye, Link2, Sparkles, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import {
  KNOWLEDGE_CATEGORY_LABELS,
  MEMORY_CATEGORY_LABELS,
  RELATIONSHIP_CAUSE_LABELS,
  normalizeKnowledgeCategory,
  normalizeMemoryCategory,
  normalizeRelationshipCause
} from '../../../narrative/narrative-taxonomy';
import type { Toast, WorldbuildApi, WorldbuildEntity } from './worldbuildTypes';

interface ReviewOperation {
  id: string;
  kind: string;
  subjectId?: string;
  targetId?: string;
  title?: string;
  summary: string;
  method?: string;
  category?: string | null;
  cause?: string | null;
  confidence?: number;
}

/**
 * What kind of durable record this is, in the reviewer's words. It is the fastest way to see
 * whether a suggestion belongs in the campaign at all: a secret and a piece of world lore read
 * the same as bare sentences and are worth very different amounts of attention.
 */
function operationTag(operation: ReviewOperation): string | null {
  const cause = normalizeRelationshipCause(operation.cause);
  if (cause) return RELATIONSHIP_CAUSE_LABELS[cause];
  const knowledge = normalizeKnowledgeCategory(operation.category);
  if (knowledge) return KNOWLEDGE_CATEGORY_LABELS[knowledge];
  const memory = normalizeMemoryCategory(operation.category);
  return memory ? MEMORY_CATEGORY_LABELS[memory] : null;
}

interface ReviewProposal {
  eventId: string;
  description: string;
  excerpt: string;
  createdAt: string;
  legacy?: boolean;
  operations: ReviewOperation[];
}

export default function WorldbuildNarrativeReview({
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
      showToast('Review every suggestion before finishing this Narrative state update.', 'error');
      return;
    }
    setSaving(proposal.eventId);
    try {
      const result = await api.resolveNarrativeStateOperations(workspaceId, proposal.eventId, approved, rejected);
      if (!result.success) throw new Error(result.error || 'Could not resolve the Narrative state update.');
      setDecisions(current => {
        const next = { ...current };
        proposal.operations.forEach(operation => delete next[operation.id]);
        return next;
      });
      await onChanged();
      showToast(approved.length ? `${approved.length} Narrative state suggestion${approved.length === 1 ? '' : 's'} applied.` : 'Narrative state suggestions rejected.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not resolve the Narrative state update.', 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4">
      {proposals.map(proposal => {
        const reviewed = proposal.operations.filter(operation => decisions[operation.id]).length;
        return (
          <section key={proposal.eventId} className="overflow-hidden rounded-card border border-entity-event/20 bg-surface-panel-muted/70 backdrop-blur-md">
            <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-4 py-3.5">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Sparkles className="h-4 w-4 text-entity-event" />
                  Narrative state suggestions
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-text-subtle">{proposal.description}</p>
              </div>
              <span className="shrink-0 rounded-full border border-border-subtle bg-surface-hover/40 px-2 py-1 text-xs text-text-muted">{reviewed}/{proposal.operations.length} reviewed</span>
            </header>

            {proposal.legacy && (
              <div className="flex gap-2 border-b border-status-warning/20 bg-status-warning/[0.07] px-4 py-3 text-xs leading-relaxed text-status-warning/80">
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
                const tag = operationTag(operation);
                return (
                  <article key={operation.id} className={`rounded-card border px-4 py-3.5 transition-colors ${decision === 'approved' ? 'border-status-success/30 bg-status-success/[0.06]' : decision === 'rejected' ? 'border-status-danger/25 bg-status-danger/[0.05]' : 'border-border-subtle bg-surface-canvas/30'}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-entity-event/20 bg-entity-event/[0.08] px-2 py-0.5 eyebrow text-entity-event">{operation.kind}</span>
                          {tag && <span className="rounded-full border border-border-subtle bg-surface-hover/50 px-2 py-0.5 eyebrow text-text-secondary">{tag}</span>}
                          <span className="text-xs text-text-muted">{scope}</span>
                        </div>
                        {operation.title && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{operation.title}</p>}
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{operation.summary || 'No usable content was extracted.'}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-subtle">
                          {operation.method && <span className="inline-flex items-center gap-1 capitalize"><Eye className="h-3 w-3" />{operation.method}</span>}
                          {operation.confidence !== undefined && <span>{Math.round(operation.confidence * 100)}% confidence</span>}
                          {operation.kind === 'relationship' && <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />Directional perspective</span>}
                          {operation.kind === 'fact' && <span className="inline-flex items-center gap-1"><BookCheck className="h-3 w-3" />Saved to Facts when approved</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button type="button" disabled={proposal.legacy || saving === proposal.eventId} onClick={() => decide(operation.id, 'approved')} data-tooltip="Apply suggestion" className={`rounded-md p-2 transition-colors ${decision === 'approved' ? 'bg-status-success text-on-accent' : 'text-text-subtle hover:bg-status-success/10 hover:text-status-success'}`}><Check className="h-4 w-4" /></button>
                        <button type="button" disabled={saving === proposal.eventId} onClick={() => decide(operation.id, 'rejected')} data-tooltip="Reject suggestion" className={`rounded-md p-2 transition-colors ${decision === 'rejected' ? 'bg-status-danger text-on-danger' : 'text-text-subtle hover:bg-status-danger/10 hover:text-status-danger'}`}><X className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {proposal.excerpt && <p className="rounded-control border border-border-subtle bg-surface-canvas/30 px-3 py-2 text-xs italic leading-relaxed text-text-subtle">{proposal.excerpt}</p>}
            </div>
            <footer className="flex flex-col gap-3 border-t border-border-subtle px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
              <p className="text-xs text-text-subtle">Each suggestion has its own decision. Only approved operations are written.</p>
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

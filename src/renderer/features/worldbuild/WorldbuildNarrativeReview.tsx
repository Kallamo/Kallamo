import React, { useMemo, useState } from 'react';
import { AlertTriangle, BookCheck, Check, Eye, X, ArrowRightLeft } from 'lucide-react';
import { AiGlyph } from '../../components/ui/glyphs';
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
  /** Relationships only: the proposed score and what the relationship says now, when it exists. */
  value?: number;
  current?: { title: string; value: number } | null;
}

/** A secret and world lore read the same as bare sentences; the tag says which deserves attention. */
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
  workspaceId, proposals, entities, api, showToast, onChanged, switcher = null,
}: {
  workspaceId: string;
  proposals: ReviewProposal[];
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
  onChanged(): Promise<void> | void;
  /** Switches between sheet updates and Narrative state; it replaces the first card's title. */
  switcher?: React.ReactNode;
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
      {proposals.map((proposal, index) => {
        const reviewed = proposal.operations.filter(operation => decisions[operation.id]).length;
        const busy = saving === proposal.eventId;
        return (
          <section key={proposal.eventId} className="ws-card rounded-card border border-border-default bg-surface-panel-muted/60 px-4 pb-2 pt-3.5 backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-2">
              {index === 0 && switcher ? switcher : <><AiGlyph className="h-4 w-4 shrink-0 text-entity-event" /><h2 className="text-sm font-semibold text-text-primary">Narrative state</h2></>}
              <span className="text-xs tabular-nums text-text-subtle">{reviewed} of {proposal.operations.length} reviewed</span>
              <span className="flex-1" />
              <Button size="sm" variant="subtle" disabled={busy} onClick={() => decideAll(proposal, 'rejected')}>Reject all</Button>
              <Button size="sm" variant="ghost" icon={Check} disabled={proposal.legacy || busy} onClick={() => decideAll(proposal, 'approved')}>Accept all</Button>
            </div>
            {proposal.description && <p className="caption mt-1.5">{proposal.description}</p>}

            {proposal.legacy && (
              <div className="mt-3 flex gap-2 rounded-control border border-status-warning/25 bg-status-warning/[0.07] px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" aria-hidden="true" />
                An older version of the AI made this suggestion, so it cannot be applied. Reject it and update entities again.
              </div>
            )}

            <div className="mt-2 divide-y divide-border-subtle">
              {proposal.operations.map(operation => {
                const decision = decisions[operation.id];
                const source = names.get(operation.subjectId || '') || 'Unknown';
                const target = names.get(operation.targetId || '');
                const scope = operation.kind === 'fact'
                  ? `World fact${target ? ` about ${target}` : ''}`
                  : `${source}${target ? ` → ${target}` : ''}`;
                const tag = operationTag(operation);
                return (
                  <div key={operation.id} className="flex items-start gap-4 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="font-medium text-text-muted">{kindLabel(operation.kind)}</span>
                        {tag && <><span className="text-text-disabled" aria-hidden="true">·</span><span className="text-text-secondary">{tag}</span></>}
                        <span className="text-text-disabled" aria-hidden="true">·</span>
                        <span className="text-text-subtle">{scope}</span>
                      </div>
                      {operation.kind === 'relationship' ? <RelationshipChange operation={operation} /> : operation.title && <p className="mt-1 text-sm font-semibold text-text-primary">{operation.title}</p>}
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{operation.summary || 'Nothing usable was read from the story.'}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-subtle">
                        {operation.method && <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" aria-hidden="true" />{sentence(operation.method)}</span>}
                        {operation.confidence !== undefined && <span>{Math.round(operation.confidence * 100)}% sure</span>}
                        {operation.kind === 'relationship' && <span className="inline-flex items-center gap-1"><ArrowRightLeft className="h-3 w-3" aria-hidden="true" />As {source} sees it</span>}
                        {operation.kind === 'fact' && <span className="inline-flex items-center gap-1"><BookCheck className="h-3 w-3" aria-hidden="true" />Goes to Facts when accepted</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-start gap-1.5">
                      <Button size="sm" variant="subtle" icon={X} aria-pressed={decision === 'rejected'} disabled={busy} onClick={() => decide(operation.id, 'rejected')}
                        className={decision === 'rejected' ? '!bg-status-danger/10 !text-status-danger' : ''}>Reject</Button>
                      <Button size="sm" variant="ghost" icon={Check} aria-pressed={decision === 'approved'} disabled={proposal.legacy || busy} onClick={() => decide(operation.id, 'approved')}
                        className={`!border-status-success/35 !text-status-success ${decision === 'approved' ? '!bg-status-success/15' : ''}`}>Accept</Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {proposal.excerpt && (
              <div className="border-t border-border-subtle py-3">
                <p className="text-xs font-medium text-text-muted">From the story</p>
                <p className="mt-1 border-l-2 border-border-strong pl-3 text-sm italic leading-relaxed text-text-subtle">{proposal.excerpt}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle py-3">
              <p className="min-w-0 flex-1 text-xs text-text-subtle">Decide each one. Only what you accept is written.</p>
              <Button size="sm" loading={busy} disabled={reviewed !== proposal.operations.length} onClick={() => submit(proposal)}>Finish review</Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A relationship that already exists is shown as an edit: the role it keeps or changes, and where the score goes. */
function RelationshipChange({ operation }: { operation: ReviewOperation }) {
  const { current } = operation;
  const title = operation.title || '';
  const kept = Boolean(current) && current!.title.trim() === title.trim();
  const score = operation.value;
  return (
    <div className="mt-1 space-y-0.5">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        {current && !kept && current.title && <><span className="text-text-subtle line-through">{current.title}</span><span className="text-text-subtle" aria-hidden="true">→</span></>}
        <span className="font-semibold text-text-primary">{title}</span>
        {kept && <span className="text-xs text-text-subtle">kept</span>}
      </p>
      {score !== undefined && Number.isFinite(score) && (
        <p className="text-xs tabular-nums text-text-muted">
          {current ? <>Score {current.value} → <span className="font-semibold text-text-secondary">{score}</span></> : <>Score <span className="font-semibold text-text-secondary">{score}</span>, new relationship</>}
        </p>
      )}
    </div>
  );
}

const sentence = (text: string) => text ? text.charAt(0).toUpperCase() + text.slice(1).replace(/[_-]+/g, ' ') : text;
const kindLabel = (kind: string) => sentence(kind || 'Change');

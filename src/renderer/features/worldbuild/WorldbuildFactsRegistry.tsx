import { useEffect, useMemo, useState } from 'react';
import { BookCheck, Lock, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import type { Toast, WorldbuildApi, WorldbuildEntity, WorldbuildFact } from './worldbuildTypes';

const INPUT = 'wb-input field-input px-3 py-2 text-sm';

type SourceFilter = 'all' | 'manual' | 'narrative' | 'managed';

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'manual', label: 'Authored' },
  { id: 'narrative', label: 'Narrative' },
  { id: 'managed', label: 'Event records' },
];

function matchesFilter(fact: WorldbuildFact, filter: SourceFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'managed') return Boolean(fact.managed);
  return !fact.managed && fact.source === filter;
}

export default function WorldbuildFactsRegistry({
  workspaceId, entities, api, showToast, onCountChanged,
}: {
  workspaceId: string;
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
  onCountChanged?(count: number): void;
}) {
  const [facts, setFacts] = useState<WorldbuildFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{
    existing?: WorldbuildFact;
    title: string;
    statement: string;
    relatedEntityIds: string[];
  } | null>(null);
  const [deleting, setDeleting] = useState<WorldbuildFact | null>(null);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.listWorldbuildFacts(workspaceId);
      if (!result.success) throw new Error(result.error || 'Could not load Facts.');
      const next = result.facts || [];
      setFacts(next);
      onCountChanged?.(next.length);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load Facts.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workspaceId]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return [...facts]
      .reverse()
      .filter(fact => matchesFilter(fact, filter))
      .filter(fact => !normalized || [
        fact.title,
        fact.statement,
        ...fact.relatedEntityIds.map(id => names.get(id) || ''),
      ].some(value => value.toLocaleLowerCase().includes(normalized)));
  }, [facts, filter, names, query]);

  const counts = useMemo(() => ({
    all: facts.length,
    manual: facts.filter(fact => matchesFilter(fact, 'manual')).length,
    narrative: facts.filter(fact => matchesFilter(fact, 'narrative')).length,
    managed: facts.filter(fact => matchesFilter(fact, 'managed')).length,
  }), [facts]);

  const entityOptions = useMemo(() => entities
    .filter(entity => entity.status !== 'proposed')
    .map(entity => ({
      id: entity.id,
      label: entity.canonicalName,
      aliases: entity.aliases,
      group: entity.type.replace(/s$/, ''),
    })), [entities]);

  const startAdd = () => setEditor({ title: '', statement: '', relatedEntityIds: [] });
  const startEdit = (fact: WorldbuildFact) => setEditor({
    existing: fact,
    title: fact.title,
    statement: fact.statement,
    relatedEntityIds: fact.relatedEntityIds,
  });

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const result = await api.saveWorldbuildFact({
        workspaceId,
        existingId: editor.existing?.id,
        entry: {
          title: editor.title.trim(),
          statement: editor.statement.trim(),
          relatedEntityIds: editor.relatedEntityIds,
        },
      });
      if (!result.success) throw new Error(result.error || 'Could not save the Fact.');
      const next = result.facts || [];
      setFacts(next);
      onCountChanged?.(next.length);
      setEditor(null);
      showToast('Canonical Fact saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the Fact.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      const result = await api.deleteWorldbuildFact({ workspaceId, factId: deleting.id });
      if (!result.success) throw new Error(result.error || 'Could not remove the Fact.');
      const next = result.facts || [];
      setFacts(next);
      onCountChanged?.(next.length);
      setDeleting(null);
      showToast('Canonical Fact retracted.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove the Fact.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <section className="overflow-hidden rounded-surface border border-border-subtle bg-surface-panel/70 shadow-panel backdrop-blur-md">
        <header className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-accent/25 bg-accent/[0.08] text-accent">
              <BookCheck aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-text-primary">Canonical Facts</h1>
              <p className="caption mt-1 max-w-xl">Objective truths of this world. Characters may observe, know, or interpret them differently without changing the canon.</p>
            </div>
          </div>
          <Button icon={Plus} onClick={startAdd}>Add Fact</Button>
        </header>

        <div className="flex flex-col gap-2.5 border-y border-border-subtle bg-surface-canvas/30 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
            <input value={query} onChange={event => setQuery(event.target.value)} aria-label="Search canonical facts" placeholder="Search canonical facts..." className={`${INPUT} pl-9 ${query ? 'pr-9' : ''}`} />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-subtle transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
            )}
          </div>
          <div role="group" aria-label="Filter Facts by source" className="flex shrink-0 flex-wrap gap-1">
            {SOURCE_FILTERS.map(option => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={`inline-flex min-h-8 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${filter === option.id ? 'bg-accent/12 text-accent' : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary'}`}
              >
                {option.label}
                <span className="tabular-nums opacity-60">{counts[option.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 p-5">
          {loading && <><div className="h-24 animate-pulse rounded-card bg-surface-panel-muted/60" /><div className="h-20 animate-pulse rounded-card bg-surface-panel-muted/40" /></>}
          {!loading && !facts.length && (
            <button type="button" onClick={startAdd} className="flex w-full flex-col items-center justify-center rounded-card border border-dashed border-border-subtle px-6 py-12 text-center transition-colors duration-200 ease-standard hover:border-accent/30 hover:bg-accent/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <Plus aria-hidden="true" className="mb-2 h-5 w-5 text-text-disabled" />
              <span className="text-sm font-semibold text-text-secondary">Add the first canonical Fact</span>
              <span className="caption mt-1 max-w-md">Facts are workspace-wide truths. They are not memories, beliefs, or knowledge owned by a character.</span>
            </button>
          )}
          {!loading && facts.length > 0 && !visible.length && (
            <p className="py-10 text-center text-sm text-text-subtle">No Facts match this search.</p>
          )}
          {visible.map(fact => (
            <FactCard
              key={fact.id}
              fact={fact}
              names={names}
              onEdit={() => startEdit(fact)}
              onDelete={() => setDeleting(fact)}
            />
          ))}
        </div>
      </section>

      {editor && (
        <Modal onClose={() => setEditor(null)} size="lg" title={`${editor.existing ? 'Edit' : 'Add'} canonical Fact`} icon={BookCheck} closeOnOverlay={!saving} closeOnEsc={!saving}>
          <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5 custom-scrollbar">
            <p className="rounded-control border border-accent/15 bg-accent/[0.04] px-3.5 py-3 text-xs leading-relaxed text-text-muted">Write only an objective truth of the world. A character's interpretation belongs in Observed, Known, or Beliefs.</p>
            <Field label="Fact title" hint="A stable, concise label used to identify this canonical truth.">
              <input autoFocus className={INPUT} value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} placeholder="e.g. Northern gate status" />
            </Field>
            <Field label="Canonical statement">
              <textarea className={`${INPUT} min-h-32 resize-y`} value={editor.statement} onChange={event => setEditor({ ...editor, statement: event.target.value })} placeholder="State what is objectively true." />
            </Field>
            <Field label="Related entities" hint="Optional references for organization. The Fact remains global and is not owned by these entities.">
              <SearchableSelect
                multiple
                values={editor.relatedEntityIds}
                onChange={(relatedEntityIds: string[]) => setEditor({ ...editor, relatedEntityIds })}
                options={entityOptions}
                placeholder="Search and add related entities"
              />
            </Field>
          </div>
          <footer className="flex justify-end gap-2 border-t border-border-subtle px-5 py-4">
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!editor.title.trim() || !editor.statement.trim()}>Save Fact</Button>
          </footer>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          tone="danger"
          title="Retract canonical Fact"
          message={<>Retract <strong className="text-text-primary">“{deleting.title}”</strong> from the current canon? Its prior record remains in narrative history.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
            { label: 'Retract', variant: 'danger', loading: saving, autoFocus: true, onClick: remove },
          ]}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function FactCard({ fact, names, onEdit, onDelete }: {
  fact: WorldbuildFact;
  names: Map<string, string>;
  onEdit(): void;
  onDelete(): void;
}) {
  const origin = fact.managed
    ? { label: 'Event record', icon: Lock, tone: 'text-entity-event' }
    : fact.source === 'narrative'
      ? { label: 'Narrative State', icon: Sparkles, tone: 'text-entity-event' }
      : { label: 'Authored', icon: null, tone: 'text-text-subtle' };
  const OriginIcon = origin.icon;
  return (
    <article className="group relative rounded-card border border-border-subtle bg-surface-canvas/25 px-4 py-3.5 transition-colors duration-200 ease-standard hover:border-border-default hover:bg-surface-panel-muted/40">
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 eyebrow ${origin.tone}`}>
          {OriginIcon && <OriginIcon aria-hidden="true" className="h-3 w-3" />}
          {origin.label}
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
        <span className="shrink-0 text-[0.6875rem] tabular-nums text-text-subtle">{formatDate(fact.appliedAt || fact.position.timestamp)}</span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 flex-1 text-sm font-bold leading-snug text-text-primary">{fact.title}</h2>
        {!fact.managed && (
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-200 ease-standard focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" onClick={onEdit} aria-label={`Edit ${fact.title}`} data-tooltip="Edit" className="rounded p-1.5 text-text-subtle transition-colors hover:bg-surface-hover/60 hover:text-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Pencil aria-hidden="true" className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onDelete} aria-label={`Retract ${fact.title}`} data-tooltip="Retract" className="rounded p-1.5 text-text-subtle transition-colors hover:bg-status-danger/10 hover:text-status-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40"><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>

      {fact.statement && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{fact.statement}</p>
      )}

      {fact.relatedEntityIds.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {fact.relatedEntityIds.map(id => (
            <span key={id} className="rounded-full border border-border-subtle bg-surface-panel-muted/60 px-2 py-0.5 text-[0.6875rem] font-medium text-text-muted">
              {names.get(id) || 'Unknown entity'}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="eyebrow mb-1.5 block">{label}</span>{children}{hint && <span className="caption mt-1.5 block">{hint}</span>}</label>;
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

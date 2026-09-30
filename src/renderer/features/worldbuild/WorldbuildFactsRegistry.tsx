import { useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import { BookCheck, Lock, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import Menu, { MenuItem, MenuSeparator } from '../../components/ui/Menu';
import IconButton from '../../components/ui/IconButton';
import { meta } from './worldbuildConfig';
import { AiGlyph } from '../../components/ui/glyphs';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import type { Toast, WorldbuildApi, WorldbuildEntity, WorldbuildFact } from './worldbuildTypes';

const INPUT = 'wb-input field-input px-3 py-2 text-sm';

type SourceFilter = 'all' | 'manual' | 'narrative' | 'managed';

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'manual', label: 'By you' },
  { id: 'narrative', label: 'From the story' },
  { id: 'managed', label: 'From events' },
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
  const types = useMemo(() => new Map(entities.map(entity => [entity.id, entity.type])), [entities]);

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
      showToast('Fact saved.', 'success');
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
      showToast('Fact retracted.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove the Fact.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-text-primary">Facts <span className="text-base font-medium tabular-nums text-text-subtle">{facts.length || ''}</span></h1>
          <p className="caption mt-1 max-w-xl">What is objectively true in this world. Characters may not know it, or believe otherwise.</p>
        </div>
        <Button icon={Plus} onClick={startAdd} className="self-start sm:self-auto">Add fact</Button>
      </header>
      <section className="overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
        <div className="flex flex-col gap-2.5 border-b border-border-subtle px-4 py-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
            <input value={query} onChange={event => setQuery(event.target.value)} aria-label="Search facts" placeholder="Search facts" className={`${INPUT} pl-9 ${query ? 'pr-9' : ''}`} />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-subtle transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
            )}
          </div>
          <div role="group" aria-label="Filter facts by source" className="inline-flex shrink-0 flex-wrap gap-1 rounded-control border border-border-default bg-surface-input p-1">
            {SOURCE_FILTERS.map(option => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={`inline-flex min-h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${filter === option.id ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : counts[option.id] ? 'text-text-muted hover:text-text-primary' : 'text-text-disabled hover:text-text-muted'}`}
              >
                {option.label}
                <span className="tabular-nums opacity-60">{counts[option.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-border-subtle px-4">
          {loading && <><div className="my-4 h-24 animate-pulse rounded-card bg-surface-panel-muted/60" /></>}
          {!loading && !facts.length && (
            <button type="button" onClick={startAdd} className="my-4 flex w-full flex-col items-center justify-center rounded-card border border-dashed border-border-subtle px-6 py-12 text-center transition-colors duration-200 ease-standard hover:border-border-strong hover:bg-surface-hover/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <Plus aria-hidden="true" className="mb-2 h-5 w-5 text-text-disabled" />
              <span className="text-sm font-semibold text-text-secondary">Add the first fact</span>
              <span className="caption mt-1 max-w-md">Facts are workspace-wide truths. They are not memories, beliefs, or knowledge owned by a character.</span>
            </button>
          )}
          {!loading && facts.length > 0 && !visible.length && (
            <p className="py-10 text-center text-sm text-text-subtle">No facts match this search.</p>
          )}
          {visible.map(fact => (
            <FactCard
              key={fact.id}
              fact={fact}
              names={names}
              types={types}
              onEdit={() => startEdit(fact)}
              onDelete={() => setDeleting(fact)}
            />
          ))}
        </div>
      </section>

      {editor && (
        <Modal onClose={() => setEditor(null)} size="lg" title={`${editor.existing ? 'Edit' : 'Add'} fact`} icon={BookCheck} iconClassName="text-text-muted" closeOnOverlay={!saving} closeOnEsc={!saving}>
          <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5 custom-scrollbar">
            <p className="caption text-sm">Only what is objectively true. What a character believes belongs on their Knowledge tab.</p>
            <Field label="Title" hint="A short label that names this truth.">
              <input autoFocus className={INPUT} value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} placeholder="e.g. The northern gate is sealed" />
            </Field>
            <Field label="Statement">
              <textarea className={`${INPUT} min-h-32 resize-y`} value={editor.statement} onChange={event => setEditor({ ...editor, statement: event.target.value })} placeholder="State what is true." />
            </Field>
            <Field label="About" hint="For finding it later. The fact stays global.">
              <SearchableSelect
                multiple
                values={editor.relatedEntityIds}
                onChange={(relatedEntityIds: string[]) => setEditor({ ...editor, relatedEntityIds })}
                options={entityOptions}
                placeholder="Search entities"
              />
            </Field>
          </div>
          <footer className="flex justify-end gap-2 border-t border-border-subtle px-5 py-4">
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!editor.title.trim() || !editor.statement.trim()}>{editor.existing ? 'Save changes' : 'Add fact'}</Button>
          </footer>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          tone="danger"
          title="Retract fact"
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

function FactCard({ fact, names, types, onEdit, onDelete }: {
  fact: WorldbuildFact;
  names: Map<string, string>;
  types: Map<string, string>;
  onEdit(): void;
  onDelete(): void;
}) {
  const origin = fact.managed
    ? { label: 'From an event', icon: Lock, tone: 'text-entity-event' }
    : fact.source === 'narrative'
      ? { label: 'From the story', icon: AiGlyph, tone: 'text-entity-event' }
      : { label: 'Written by you', icon: Pencil, tone: 'text-text-subtle' };
  const OriginIcon = origin.icon;
  return (
    <article className="py-4">
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-[0.9375rem] font-semibold leading-snug text-text-primary">{fact.title}</h2>
        <span className={`inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-xs ${origin.tone}`}>
          {OriginIcon && <OriginIcon aria-hidden="true" className="h-3 w-3" />}
          {origin.label}
          <span className="text-text-disabled" aria-hidden="true">·</span>
          <span className="tabular-nums text-text-subtle">{formatDate(fact.appliedAt || fact.position.timestamp)}</span>
        </span>
        {!fact.managed ? <FactActions title={fact.title} onEdit={onEdit} onDelete={onDelete} /> : <span className="w-8" />}
      </div>

      {fact.statement && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{fact.statement}</p>
      )}

      {fact.relatedEntityIds.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {fact.relatedEntityIds.map(id => (
            <span key={id} className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-hover/35 px-2.5 py-0.5 text-xs font-medium text-text-secondary">
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta(types.get(id) || '').dot || 'bg-text-subtle'}`} />
              {names.get(id) || 'Unknown entity'}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function FactActions({ title, onEdit, onDelete }: { title: string; onEdit(): void; onDelete(): void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <IconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label={`Actions for ${title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} className="-mt-1" />
    <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Fact actions" className="w-44">
      <MenuItem icon={Pencil} label="Edit" onSelect={() => { setOpen(false); onEdit(); }} />
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Retract" danger onSelect={() => { setOpen(false); onDelete(); }} />
    </Menu>
  </>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>{children}{hint && <span className="caption mt-1.5 block">{hint}</span>}</label>;
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

import { useEffect, useMemo, useState } from 'react';
import { BookCheck, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import type { Toast, WorldbuildApi, WorldbuildEntity, WorldbuildFact } from './worldbuildTypes';

const INPUT = 'wb-input w-full rounded-lg border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/15';

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
      .filter(fact => !normalized || [
        fact.title,
        fact.statement,
        ...fact.relatedEntityIds.map(id => names.get(id) || ''),
      ].some(value => value.toLocaleLowerCase().includes(normalized)));
  }, [facts, names, query]);

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
      <section className="overflow-hidden rounded-2xl border border-amber-300/20 bg-[#0a1721]/70 backdrop-blur-md">
        <header className="flex flex-col gap-4 border-b border-white/[0.08] p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-300/[0.08] text-amber-200">
              <BookCheck className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-white">Canonical Facts</h1>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-gray-400">Objective truths of this world. Characters may observe, know, or interpret them differently without changing the canon.</p>
            </div>
          </div>
          <Button icon={Plus} onClick={startAdd}>Add Fact</Button>
        </header>

        <div className="border-b border-white/[0.08] px-5 py-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search canonical facts..." className={`${INPUT} pl-9`} />
          </div>
        </div>

        <div className="space-y-2.5 p-5">
          {loading && <><div className="h-28 animate-pulse rounded-xl bg-white/[0.04]" /><div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" /></>}
          {!loading && !facts.length && (
            <button type="button" onClick={startAdd} className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-6 py-12 text-center transition-colors hover:border-amber-300/30 hover:bg-amber-300/[0.03]">
              <Plus className="mb-2 h-5 w-5 text-gray-600" />
              <span className="text-sm font-semibold text-gray-300">Add the first canonical Fact</span>
              <span className="mt-1 max-w-md text-xs leading-relaxed text-gray-500">Facts are workspace-wide truths. They are not memories, beliefs, or knowledge owned by a character.</span>
            </button>
          )}
          {!loading && facts.length > 0 && !visible.length && (
            <p className="py-10 text-center text-sm text-gray-500">No Facts match this search.</p>
          )}
          {visible.map(fact => (
            <article key={fact.id} className="group rounded-xl border border-white/[0.08] bg-black/10 px-4 py-4 transition-colors hover:border-white/15 hover:bg-white/[0.025]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-amber-100">{fact.title}</h2>
                    {fact.relatedEntityIds.map(id => <span key={id} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-gray-400">About {names.get(id) || 'Unknown entity'}</span>)}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">{fact.statement}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    {fact.source === 'narrative' ? <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3 text-violet-300" />Narrative State</span> : <span>Added manually</span>}
                    <span>{formatDate(fact.appliedAt || fact.position.timestamp)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                  <button type="button" onClick={() => startEdit(fact)} aria-label="Edit Fact" data-tooltip="Edit" className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => setDeleting(fact)} aria-label="Retract Fact" data-tooltip="Retract" className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {editor && (
        <Modal onClose={() => setEditor(null)} size="lg" title={`${editor.existing ? 'Edit' : 'Add'} canonical Fact`} icon={BookCheck} closeOnOverlay={!saving} closeOnEsc={!saving}>
          <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5 custom-scrollbar">
            <p className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3.5 py-3 text-xs leading-relaxed text-gray-400">Write only an objective truth of the world. A character's interpretation belongs in Observed, Known, or Beliefs.</p>
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
          <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!editor.title.trim() || !editor.statement.trim()}>Save Fact</Button>
          </footer>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          tone="danger"
          title="Retract canonical Fact"
          message={<>Retract <strong className="text-gray-200">“{deleting.title}”</strong> from the current canon? Its prior record remains in narrative history.</>}
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-400">{label}</span>{children}{hint && <span className="mt-1 block text-xs leading-relaxed text-gray-500">{hint}</span>}</label>;
}

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck, Brain, Eye, EyeOff, Lightbulb, LockKeyhole,
  Pencil, Plus, Sparkles, Trash2,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import type {
  KnowledgeEntryKind, Toast, WorldbuildApi, WorldbuildEntity,
  WorldbuildKnowledgeEntry, WorldbuildKnowledgeProjection,
} from './worldbuildTypes';

const INPUT = 'wb-input w-full rounded-lg border border-white/15 bg-[#06121a]/80 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent/70 focus:outline-none';
type View = 'known' | 'beliefs' | 'memories';

const VIEWS: Array<{ id: View; label: string; icon: typeof BookOpenCheck }> = [
  { id: 'known', label: 'Known', icon: BookOpenCheck },
  { id: 'beliefs', label: 'Beliefs', icon: Lightbulb },
  { id: 'memories', label: 'Memories', icon: Brain },
];

interface Props {
  workspaceId: string;
  entity: WorldbuildEntity;
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
}

interface EntryDraft {
  kind: KnowledgeEntryKind;
  existing?: WorldbuildKnowledgeEntry;
  aboutId: string;
  statement: string;
  summary: string;
  confidence: number;
  acquisition: 'participant' | 'witness' | 'reported' | 'inferred';
  accessibility: 'available' | 'suppressed' | 'inaccessible';
}

export default function WorldbuildKnowledgeTab({ workspaceId, entity, entities, api, showToast }: Props) {
  const [view, setView] = useState<View>('known');
  const [projection, setProjection] = useState<WorldbuildKnowledgeProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EntryDraft | null>(null);
  const [deleting, setDeleting] = useState<WorldbuildKnowledgeEntry | null>(null);
  const names = useMemo(() => new Map(entities.map(item => [item.id, item.canonicalName])), [entities]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getWorldbuildSubjectKnowledge(workspaceId, entity.id).then(result => {
      if (!active) return;
      if (result.success && result.projection) setProjection(result.projection);
      else showToast(`Could not load Knowledge: ${result.error || 'unknown error'}`, 'error');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api, entity.id, showToast, workspaceId]);

  const entries = projection?.[view] ?? [];
  const startAdd = () => setEditor(emptyDraft(toKind(view), entity.id));
  const startEdit = (entry: WorldbuildKnowledgeEntry) => setEditor({
    kind: entry.kind,
    existing: entry,
    aboutId: entry.aboutId ?? entity.id,
    statement: entry.statement ?? '',
    summary: entry.summary ?? '',
    confidence: Math.round((entry.confidence ?? 0.5) * 100),
    acquisition: entry.acquisition ?? 'reported',
    accessibility: entry.accessibility,
  });

  const save = async () => {
    if (!editor) return;
    setSaving(true);
    try {
      const entry = editor.kind === 'memory'
        ? { summary: editor.summary.trim(), accessibility: editor.accessibility }
        : {
            aboutId: editor.aboutId,
            statement: editor.statement.trim(),
            confidence: editor.confidence / 100,
            accessibility: editor.accessibility,
            ...(editor.kind === 'knowledge' ? { acquisition: editor.acquisition } : {}),
          };
      const result = await api.saveWorldbuildSubjectEntry({
        workspaceId,
        subjectId: entity.id,
        kind: editor.kind,
        existingId: editor.existing?.id,
        entry,
      });
      if (!result.success || !result.projection) throw new Error(result.error || 'Could not save the entry.');
      setProjection(result.projection);
      setEditor(null);
      showToast(`${entryLabel(editor.kind)} saved.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the Knowledge entry.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      const result = await api.deleteWorldbuildSubjectEntry({
        workspaceId, subjectId: entity.id, kind: deleting.kind, entryId: deleting.id,
      });
      if (!result.success || !result.projection) throw new Error(result.error || 'Could not delete the entry.');
      setProjection(result.projection);
      setDeleting(null);
      showToast(`${entryLabel(deleting.kind)} removed.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not delete the Knowledge entry.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isFaction = entity.type === 'Factions';
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-[#0a1721]/60 p-1.5 backdrop-blur-md">
        <div className="grid grid-cols-3 gap-1">
          {VIEWS.map(item => {
            const Icon = item.icon;
            const active = view === item.id;
            const count = projection?.[item.id].length ?? 0;
            return (
              <button key={item.id} type="button" onClick={() => setView(item.id)}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${active ? 'bg-accent text-[#011419]' : 'text-gray-500 hover:bg-white/5 hover:text-gray-200'}`}>
                <Icon className="h-3.5 w-3.5" /> {item.label}
                {count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-xs ${active ? 'bg-black/15' : 'bg-white/[0.07] text-gray-400'}`}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0a1721]/60 backdrop-blur-md">
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-4 py-3.5">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{viewTitle(view, isFaction)}</h3>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">{viewDescription(view, isFaction)}</p>
          </div>
          <button type="button" onClick={startAdd} aria-label={`Add ${entryLabel(toKind(view))}`} data-tooltip={`Add ${entryLabel(toKind(view)).toLowerCase()}`}
            className="shrink-0 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-accent">
            <Plus className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-2.5 p-4">
          {loading && <KnowledgeSkeleton />}
          {!loading && !entries.length && (
            <button type="button" onClick={startAdd}
              className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-white/10 px-5 py-9 text-center transition-colors hover:border-accent/30 hover:bg-accent/5">
              <Plus className="mb-2 h-5 w-5 text-gray-600" />
              <span className="text-sm font-medium text-gray-400">Add the first {entryLabel(toKind(view)).toLowerCase()}</span>
              <span className="mt-1 max-w-md text-xs text-gray-600">Entries remain tied to this sheet and preserve their narrative history.</span>
            </button>
          )}
          {entries.map(entry => (
            <KnowledgeCard key={entry.id} entry={entry} names={names} onEdit={() => startEdit(entry)} onDelete={() => setDeleting(entry)} />
          ))}
        </div>
      </section>

      {editor && (
        <KnowledgeEditor state={editor} onChange={setEditor} onClose={() => setEditor(null)} onSave={save} saving={saving} entities={entities} subject={entity} />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${entryLabel(deleting.kind).toLowerCase()}`}
          message={`Remove this ${entryLabel(deleting.kind).toLowerCase()} from ${entity.canonicalName}'s Knowledge? Its prior narrative record will remain in history.`}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
            { label: 'Delete', variant: 'danger', loading: saving, autoFocus: true, onClick: remove },
          ]}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function KnowledgeCard({ entry, names, onEdit, onDelete }: {
  entry: WorldbuildKnowledgeEntry;
  names: Map<string, string>;
  onEdit(): void;
  onDelete(): void;
}) {
  const AccessibilityIcon = entry.accessibility === 'available' ? Eye : entry.accessibility === 'suppressed' ? EyeOff : LockKeyhole;
  const statement = entry.kind === 'memory' ? entry.summary : entry.statement;
  return (
    <article className="group rounded-xl border border-white/[0.08] bg-black/10 px-4 py-3.5 transition-colors hover:border-white/15 hover:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {entry.kind !== 'memory' && (
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-accent/75">About {names.get(entry.aboutId ?? '') ?? 'Unknown entity'}</p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">{statement}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={onEdit} aria-label="Edit entry" data-tooltip="Edit"
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-accent"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onDelete} aria-label="Delete entry" data-tooltip="Delete"
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        {entry.confidence !== undefined && (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">{Math.round(entry.confidence * 100)}% {entry.kind === 'belief' ? 'conviction' : 'confidence'}</span>
        )}
        {entry.acquisition && <span className="capitalize">{entry.acquisition}</span>}
        {entry.kind === 'belief' && entry.relationToCanon && <CanonTag value={entry.relationToCanon} />}
        <span className="inline-flex items-center gap-1 capitalize"><AccessibilityIcon className="h-3 w-3" />{entry.accessibility}</span>
        <span>Sequence {entry.position.sequence}</span>
      </div>
    </article>
  );
}

function KnowledgeEditor({ state, onChange, onClose, onSave, saving, entities, subject }: {
  state: EntryDraft;
  onChange(state: EntryDraft): void;
  onClose(): void;
  onSave(): void;
  saving: boolean;
  entities: WorldbuildEntity[];
  subject: WorldbuildEntity;
}) {
  const update = (patch: Partial<EntryDraft>) => onChange({ ...state, ...patch });
  const isMemory = state.kind === 'memory';
  const valid = isMemory ? state.summary.trim() : state.statement.trim() && state.aboutId;
  return (
    <Modal onClose={onClose} size="lg" title={`${state.existing ? 'Edit' : 'Add'} ${entryLabel(state.kind).toLowerCase()}`} icon={state.kind === 'memory' ? Brain : state.kind === 'belief' ? Lightbulb : BookOpenCheck} closeOnOverlay={!saving} closeOnEsc={!saving}>
      <div className="max-h-[72vh] space-y-5 overflow-y-auto p-5 custom-scrollbar">
        <div className="rounded-lg border border-accent/15 bg-accent/[0.04] px-3.5 py-3 text-xs leading-relaxed text-gray-400">
          This entry belongs to <span className="font-semibold text-gray-200">{subject.canonicalName}</span>. Manual changes apply immediately and remain traceable in narrative history.
        </div>
        {isMemory ? (
          <Field label="Memory">
            <textarea className={`${INPUT} min-h-32 resize-y`} value={state.summary} onChange={event => update({ summary: event.target.value })} placeholder="What does this subject remember?" autoFocus />
          </Field>
        ) : (
          <>
            <Field label="About">
              <select className={INPUT} value={state.aboutId} onChange={event => update({ aboutId: event.target.value })}>
                {entities.map(entity => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}
              </select>
            </Field>
            <Field label={state.kind === 'belief' ? 'Belief' : 'Known information'}>
              <textarea className={`${INPUT} min-h-28 resize-y`} value={state.statement} onChange={event => update({ statement: event.target.value })}
                placeholder={state.kind === 'belief' ? 'What does this subject believe?' : 'What does this subject know?'} autoFocus />
            </Field>
            <Field label={state.kind === 'belief' ? `Conviction · ${state.confidence}%` : `Confidence · ${state.confidence}%`}>
              <input type="range" min="0" max="100" value={state.confidence} onChange={event => update({ confidence: Number(event.target.value) })} className="w-full accent-accent" />
            </Field>
            {state.kind === 'knowledge' && (
              <Field label="How it was learned">
                <select className={INPUT} value={state.acquisition} onChange={event => update({ acquisition: event.target.value as EntryDraft['acquisition'] })}>
                  <option value="participant">Direct participation</option>
                  <option value="witness">Witnessed</option>
                  <option value="reported">Reported</option>
                  <option value="inferred">Inferred</option>
                </select>
              </Field>
            )}
          </>
        )}
        {state.kind !== 'belief' && (
          <Field label="Accessibility" hint="Controls whether this subject's perspective can currently retrieve the entry.">
            <select className={INPUT} value={state.accessibility} onChange={event => update({ accessibility: event.target.value as EntryDraft['accessibility'] })}>
              <option value="available">Available</option>
              <option value="suppressed">Suppressed</option>
              <option value="inaccessible">Inaccessible</option>
            </select>
          </Field>
        )}
      </div>
      <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={onSave} loading={saving} disabled={!valid}>Save</Button>
      </footer>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-400">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}</label>;
}

function CanonTag({ value }: { value: string }) {
  const styles = value === 'aligned' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
    : value === 'contradicted' ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
      : 'border-white/10 bg-white/[0.04] text-gray-500';
  return <span className={`rounded-full border px-2 py-0.5 capitalize ${styles}`}>{value}</span>;
}

function KnowledgeSkeleton() {
  return <div className="space-y-2.5" aria-label="Loading Knowledge"><div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" /><div className="h-20 animate-pulse rounded-xl bg-white/[0.03]" /></div>;
}

function emptyDraft(kind: KnowledgeEntryKind, subjectId: string): EntryDraft {
  return { kind, aboutId: subjectId, statement: '', summary: '', confidence: 50, acquisition: 'reported', accessibility: 'available' };
}

function toKind(view: View): KnowledgeEntryKind {
  return view === 'known' ? 'knowledge' : view === 'beliefs' ? 'belief' : 'memory';
}

function entryLabel(kind: KnowledgeEntryKind): string {
  return kind === 'knowledge' ? 'Known entry' : kind === 'belief' ? 'Belief' : 'Memory';
}

function viewTitle(view: View, faction: boolean): string {
  if (view === 'known') return faction ? 'Collective knowledge' : 'What this subject knows';
  if (view === 'beliefs') return faction ? 'Official beliefs' : 'What this subject believes';
  return faction ? 'Institutional memory' : 'Personal memories';
}

function viewDescription(view: View, faction: boolean): string {
  if (view === 'known') return faction ? 'Information explicitly held by the faction, not the automatic sum of its members.' : 'Information this subject has explicitly acquired.';
  if (view === 'beliefs') return faction ? 'Doctrine, official interpretations, and institutional assumptions.' : 'Convictions that may align with or diverge from canon.';
  return faction ? 'Events and experiences preserved by the organization.' : 'Consequential experiences this subject continues to carry.';
}

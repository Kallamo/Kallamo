import { useEffect, useMemo, useState } from 'react';
import { Check, Package, Pencil, Plus, Trash2, Users } from 'lucide-react';
import Button from '../../components/ui/Button';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import { itemMeta } from './worldbuildConfig';
import type { Toast, WorldbuildEntity } from './worldbuildTypes';

const INPUT = 'wb-input min-h-10 w-full rounded-lg border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';

export interface EntityLink {
  linkId: string;
  relType: string;
  label?: string | null;
  metadata?: Record<string, unknown>;
  direction?: 'outgoing' | 'incoming';
  entity: Pick<WorldbuildEntity, 'id' | 'type' | 'canonicalName' | 'data'>;
}

interface LinkApi {
  setEntityLink(payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  setInventoryItem(payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  updateEntityLink(linkId: string, fields: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  removeEntityLink(linkId: string): Promise<{ success: boolean; error?: string }>;
}

interface CommonProps {
  workspaceId: string;
  subject: WorldbuildEntity;
  links: EntityLink[];
  api: LinkApi;
  showToast: Toast;
  onChanged(): Promise<void> | void;
}

interface RelationshipProps extends CommonProps {
  options: WorldbuildEntity[];
}

interface RelationshipDraft {
  link?: EntityLink;
  targetId: string;
  targetQuery: string;
  label: string;
  value: number;
  description: string;
}

export function WorldbuildRelationships({ workspaceId, subject, links, options, api, showToast, onChanged }: RelationshipProps) {
  const [editor, setEditor] = useState<RelationshipDraft | null>(null);
  const [deleting, setDeleting] = useState<EntityLink | null>(null);
  const [saving, setSaving] = useState(false);
  const linkedIds = useMemo(() => new Set(links.filter(link => link.direction !== 'incoming').map(link => link.entity.id)), [links]);
  const available = options.filter(option => option.id !== subject.id && !linkedIds.has(option.id));

  const startAdd = () => setEditor({ targetId: '', targetQuery: '', label: '', value: 0, description: '' });
  const startEdit = (link: EntityLink) => {
    if (link.direction === 'incoming') return;
    setEditor({
      link,
      targetId: link.entity.id,
      targetQuery: link.entity.canonicalName,
      label: link.label ?? '',
      value: clampRelationship(link.metadata?.value),
      description: String(link.metadata?.description ?? ''),
    });
  };

  const save = async () => {
    if (!editor?.targetId) return;
    setSaving(true);
    try {
      const fields = { toId: editor.targetId, label: editor.label.trim(), metadata: { value: editor.value, description: editor.description.trim() } };
      const result = editor.link
        ? await api.updateEntityLink(editor.link.linkId, fields)
        : await api.setEntityLink({ workspaceId, fromId: subject.id, relType: 'related_to', single: false, ...fields });
      if (!result.success) throw new Error(result.error || 'Could not save the relationship.');
      await onChanged();
      setEditor(null);
      showToast('Relationship saved.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the relationship.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      const result = await api.removeEntityLink(deleting.linkId);
      if (!result.success) throw new Error(result.error || 'Could not delete the relationship.');
      await onChanged();
      setDeleting(null);
      showToast('Relationship deleted.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not delete the relationship.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollectionShell icon={Users} title="Relationships" onAdd={available.length ? startAdd : undefined}>
      {!links.length && <EmptyCollection icon={Users} title="No relationships yet" detail="Add only relationships this subject has formed or explicitly knows." onAdd={available.length ? startAdd : undefined} />}
      <div className="space-y-3">
        {links.map(link => editor?.link?.linkId === link.linkId
          ? <RelationshipEditor key={link.linkId} draft={editor} setDraft={setEditor} options={[link.entity as WorldbuildEntity, ...available]} onSave={save} onClose={() => setEditor(null)} saving={saving} compact />
          : <RelationshipCard key={link.linkId} link={link} subjectName={subject.canonicalName} api={api} showToast={showToast} onChanged={onChanged} onEdit={() => startEdit(link)} onDelete={() => setDeleting(link)} readOnly={link.direction === 'incoming'} />)}
        {editor && !editor.link && <RelationshipEditor draft={editor} setDraft={setEditor} options={available} onSave={save} onClose={() => setEditor(null)} saving={saving} />}
      </div>
      {deleting && <ConfirmDialog title="Delete relationship" message={`Delete ${subject.canonicalName}'s relationship with ${deleting.entity.canonicalName}? This removes only this direction and cannot be undone.`} actions={[
        { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
        { label: 'Delete', variant: 'danger', loading: saving, autoFocus: true, onClick: remove },
      ]} onClose={() => setDeleting(null)} />}
    </CollectionShell>
  );
}

function RelationshipCard({ link, subjectName, api, showToast, onChanged, onEdit, onDelete, readOnly = false }: { link: EntityLink; subjectName: string; api: LinkApi; showToast: Toast; onChanged(): Promise<void> | void; onEdit(): void; onDelete(): void; readOnly?: boolean }) {
  const [value, setValue] = useState(() => clampRelationship(link.metadata?.value));
  const [description, setDescription] = useState(() => String(link.metadata?.description ?? ''));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValue(clampRelationship(link.metadata?.value)); setDescription(String(link.metadata?.description ?? '')); }, [link]);
  const persist = async (nextValue = value) => {
    setSaving(true);
    try {
      const result = await api.updateEntityLink(link.linkId, { metadata: { ...(link.metadata || {}), value: nextValue, description: description.trim() } });
      if (!result.success) throw new Error(result.error || 'Could not save the relationship.');
      await onChanged();
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save the relationship.', 'error'); }
    finally { setSaving(false); }
  };
  return (
    <article className={`group rounded-xl border bg-black/15 px-4 py-3.5 transition-colors ${saving ? 'border-accent/20' : 'border-white/[0.09]'}`}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h4 className="text-sm font-semibold text-gray-100">{link.entity.canonicalName}</h4>
            <span className="text-xs font-semibold text-accent/85">{link.label || 'Unlabeled relationship'}</span>
            {readOnly && <span className="text-[11px] font-medium text-text-subtle">Incoming perspective</span>}
          </div>
          {readOnly && <p className="mt-1 text-xs text-text-subtle">How {link.entity.canonicalName} sees {subjectName}.</p>}
          <RelationshipScale value={value} onChange={setValue} onCommit={persist} readOnly={readOnly} />
          <textarea readOnly={readOnly} aria-label={`Relationship description for ${link.entity.canonicalName}`} className="mt-3 min-h-20 w-full resize-y rounded-lg border border-border-subtle bg-surface-input/85 px-3 py-2.5 text-sm leading-relaxed text-text-secondary placeholder:italic placeholder:text-text-subtle focus:border-accent/45 focus:outline-none focus:ring-2 focus:ring-accent/15 read-only:cursor-default read-only:opacity-80" value={description} onChange={event => setDescription(event.target.value)} onBlur={() => { if (!readOnly) persist(); }} placeholder="Describe this relationship from this subject’s perspective." />
        </div>
        {!readOnly && <RowActions onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </article>
  );
}

function RelationshipScale({ value, onChange, onCommit, readOnly = false }: { value: number; onChange(value: number): void; onCommit(value: number): void; readOnly?: boolean }) {
  const [inputValue, setInputValue] = useState(String(value));
  useEffect(() => setInputValue(String(value)), [value]);
  const commitInput = () => {
    if (readOnly) return;
    const nextValue = clampRelationship(inputValue);
    setInputValue(String(nextValue));
    onChange(nextValue);
    onCommit(nextValue);
  };
  const changeInput = (nextValue: string) => {
    if (readOnly) return;
    if (!/^-?\d{0,3}$/.test(nextValue)) return;
    setInputValue(nextValue);
    if (nextValue !== '' && nextValue !== '-') onChange(clampRelationship(nextValue));
  };
  return <div className={`mt-3 flex items-center gap-3 ${readOnly ? 'opacity-80' : ''}`}><input disabled={readOnly} aria-label="Relationship value" type="range" min="-100" max="100" step="1" value={value} onChange={event => onChange(clampRelationship(event.target.value))} onPointerUp={() => onCommit(value)} onKeyUp={() => onCommit(value)} className="relationship-range min-w-0 flex-1" /><input readOnly={readOnly} aria-label="Relationship numeric value" className={`${INPUT} !w-20 shrink-0 text-center tabular-nums`} type="text" inputMode="numeric" value={inputValue} onChange={event => changeInput(event.target.value)} onBlur={commitInput} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></div>;
}

function RelationshipEditor({ draft, setDraft, options, onSave, onClose, saving, compact = false }: {
  draft: RelationshipDraft; setDraft(draft: RelationshipDraft): void; options: WorldbuildEntity[]; onSave(): void; onClose(): void; saving: boolean; compact?: boolean;
}) {
  const update = (patch: Partial<RelationshipDraft>) => setDraft({ ...draft, ...patch });
  return <div className="rounded-xl border border-accent/25 bg-[#071820]/95 p-4 shadow-lg shadow-black/10">
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Subject">
          <EntityCombobox options={options} value={draft.targetId} query={draft.targetQuery} onChange={(targetId, targetQuery) => update({ targetId, targetQuery })} autoFocus={!draft.link} />
        </Field>
        <Field label="Relationship type">
          <input className={INPUT} value={draft.label} onChange={event => update({ label: event.target.value })} placeholder="Friend, rival, mentor…" autoFocus={Boolean(draft.link)} />
        </Field>
      </div>
      {!compact && <><Field label="Relationship value" hint="−100 is intense hostility, 0 is neutral, and 100 is deep closeness.">
        <div className="flex items-center gap-3"><input type="range" min="-100" max="100" step="1" value={draft.value} onChange={event => update({ value: Number(event.target.value) })} className="relationship-range min-w-0 flex-1" /><input className={`${INPUT} !w-20 shrink-0 text-center tabular-nums`} type="number" min="-100" max="100" value={draft.value} onChange={event => update({ value: clampRelationship(event.target.value) })} /></div>
      </Field>
      <Field label="Subjective description" hint="Always written from the perspective of the open sheet.">
        <textarea className={`${INPUT} min-h-32 resize-y`} value={draft.description} onChange={event => update({ description: event.target.value })} placeholder="How does this subject see and feel about the other entity?" />
      </Field></>}
      <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button><Button icon={Check} size="sm" onClick={onSave} loading={saving} disabled={!draft.targetId}>Save relationship</Button></div>
    </div>
  </div>;
}

function EntityCombobox({ options, value, query, onChange, autoFocus }: { options: WorldbuildEntity[]; value: string; query: string; onChange(value: string, query: string): void; autoFocus?: boolean }) {
  void query;
  void autoFocus;
  return <SearchableSelect
    value={value}
    onChange={(targetId: string) => {
      const selected = options.find(option => option.id === targetId);
      onChange(targetId, selected?.canonicalName || '');
    }}
    options={options.map(option => ({
      id: option.id,
      label: option.canonicalName,
      aliases: option.aliases,
      group: option.type === 'Characters' ? 'Character' : 'Entity',
    }))}
    placeholder="Search characters or entities"
  />;
}

interface InventoryProps extends CommonProps { options: WorldbuildEntity[]; }
interface InventoryDraft { link?: EntityLink; itemId: string; quantity: number; condition: string; notes: string; }

export function WorldbuildInventory({ workspaceId, subject, links, options, api, showToast, onChanged }: InventoryProps) {
  const [editor, setEditor] = useState<InventoryDraft | null>(null);
  const [deleting, setDeleting] = useState<EntityLink | null>(null);
  const [saving, setSaving] = useState(false);
  const linkedIds = new Set(links.map(link => link.entity.id));
  const available = options.filter(option => !linkedIds.has(option.id));
  const startAdd = () => setEditor({ itemId: available[0]?.id ?? '', quantity: 1, condition: '', notes: '' });
  const startEdit = (link: EntityLink) => setEditor({ link, itemId: link.entity.id, quantity: positiveQuantity(link.metadata?.quantity), condition: String(link.metadata?.condition ?? ''), notes: String(link.metadata?.notes ?? '') });

  const save = async () => {
    if (!editor?.itemId) return;
    setSaving(true);
    try {
      const item = options.find(option => option.id === editor.itemId) ?? editor.link?.entity;
      const metadata = { quantity: isUniqueItem(item) ? 1 : positiveQuantity(editor.quantity), condition: editor.condition.trim(), notes: editor.notes.trim() };
      const result = editor.link
        ? await api.updateEntityLink(editor.link.linkId, { metadata })
        : await api.setInventoryItem({ workspaceId, itemId: editor.itemId, holderId: subject.id, metadata });
      if (!result.success) throw new Error(result.error || 'Could not save the inventory item.');
      await onChanged(); setEditor(null); showToast('Inventory updated.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not update the inventory.', 'error'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      const result = await api.removeEntityLink(deleting.linkId);
      if (!result.success) throw new Error(result.error || 'Could not remove the item.');
      await onChanged(); setDeleting(null); showToast('Item removed from inventory.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not remove the item.', 'error'); }
    finally { setSaving(false); }
  };
  return <CollectionShell icon={Package} title="Inventory" onAdd={available.length ? startAdd : undefined}>
    {!links.length && <EmptyCollection icon={Package} title="Inventory is empty" detail="Add an existing Worldbuild item and describe how this subject carries it." onAdd={available.length ? startAdd : undefined} />}
    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">{links.map(link => <InventoryCard key={link.linkId} link={link} onEdit={() => startEdit(link)} onDelete={() => setDeleting(link)} />)}</div>
    {editor && <InventoryEditor draft={editor} setDraft={setEditor} options={editor.link ? [editor.link.entity as WorldbuildEntity] : available} onSave={save} onClose={() => setEditor(null)} saving={saving} />}
    {deleting && <ConfirmDialog title="Remove inventory item" message={`Remove ${deleting.entity.canonicalName} from ${subject.canonicalName}'s inventory? The Worldbuild item itself will not be deleted.`} actions={[
      { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
      { label: 'Remove', variant: 'danger', loading: saving, autoFocus: true, onClick: remove },
    ]} onClose={() => setDeleting(null)} />}
  </CollectionShell>;
}

function InventoryCard({ link, onEdit, onDelete }: { link: EntityLink; onEdit(): void; onDelete(): void }) {
  const quantity = positiveQuantity(link.metadata?.quantity);
  const isUnique = isUniqueItem(link.entity);
  const condition = String(link.metadata?.condition ?? '');
  const notes = String(link.metadata?.notes ?? '');
  const ItemIcon = itemMeta(link.entity.data?.itemType).icon;
  return <article className="group flex items-start gap-3 rounded-xl border border-white/[0.09] bg-black/15 px-3.5 py-3">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-entity-item/20 bg-entity-item/[0.06] text-entity-item"><ItemIcon className="h-4 w-4" /></div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><h4 className="truncate text-sm font-semibold text-gray-100">{link.entity.canonicalName}</h4>{!isUnique && <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-300">×{quantity}</span>}{isUnique && <span className="text-xs font-medium text-accent/70">Unique</span>}</div>
      {condition && <p className="mt-1 text-xs font-medium text-accent/75">{condition}</p>}
      {notes && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500">{notes}</p>}
    </div>
    <RowActions onEdit={onEdit} onDelete={onDelete} />
  </article>;
}

function InventoryEditor({ draft, setDraft, options, onSave, onClose, saving }: { draft: InventoryDraft; setDraft(draft: InventoryDraft): void; options: WorldbuildEntity[]; onSave(): void; onClose(): void; saving: boolean }) {
  const update = (patch: Partial<InventoryDraft>) => setDraft({ ...draft, ...patch });
  const isUnique = isUniqueItem(options.find(option => option.id === draft.itemId));
  return <Modal size="lg" title={draft.link ? 'Edit inventory item' : 'Add inventory item'} icon={Package} onClose={onClose} closeOnEsc={!saving} closeOnOverlay={!saving}>
    <div className="space-y-5 p-5">
      <div className={`grid gap-4 ${isUnique ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_8rem]'}`}>
        <Field label="Item"><SearchableSelect value={draft.itemId} disabled={Boolean(draft.link)} onChange={(itemId: string) => update({ itemId })} options={options.map(option => ({ id: option.id, label: option.canonicalName, aliases: option.aliases, group: itemMeta(option.data?.itemType).label, icon: itemMeta(option.data?.itemType).icon }))} placeholder="Search for an item" /></Field>
        {!isUnique && <Field label="Quantity"><input className={INPUT} type="number" min="1" step="1" value={draft.quantity} onChange={event => update({ quantity: Number(event.target.value) })} /></Field>}
      </div>
      <Field label="Condition"><input className={INPUT} value={draft.condition} onChange={event => update({ condition: event.target.value })} placeholder="Worn, pristine, damaged…" /></Field>
      <Field label="Notes"><textarea className={`${INPUT} min-h-28 resize-y`} value={draft.notes} onChange={event => update({ notes: event.target.value })} placeholder="How it is carried, used, or distinguished…" /></Field>
    </div>
    <ModalFooter saving={saving} valid={Boolean(draft.itemId) && draft.quantity >= 1} onClose={onClose} onSave={onSave} label="Save item" />
  </Modal>;
}

function CollectionShell({ icon: Icon, title, onAdd, children }: { icon: typeof Users; title: string; onAdd?: () => void; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0a1721]/60 backdrop-blur-md">
    <header className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5"><div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-accent" /><h3 className="text-xs font-bold uppercase tracking-wider text-gray-300">{title}</h3></div>{onAdd && <button type="button" onClick={onAdd} aria-label={`Add ${title.toLowerCase()}`} className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Plus className="h-4 w-4" /></button>}</header>
    <div className="p-4">{children}</div>
  </section>;
}

function EmptyCollection({ icon: Icon, title, detail, onAdd }: { icon: typeof Users; title: string; detail: string; onAdd?: () => void }) {
  return <button type="button" onClick={onAdd} disabled={!onAdd} className="flex w-full flex-col items-center rounded-lg border border-dashed border-white/10 px-5 py-8 text-center transition-colors enabled:hover:border-accent/30 enabled:hover:bg-accent/[0.04]"><Icon className="mb-2 h-5 w-5 text-gray-600" /><span className="text-sm font-medium text-gray-400">{title}</span><span className="mt-1 max-w-md text-xs leading-relaxed text-gray-600">{detail}</span></button>;
}

function RowActions({ onEdit, onDelete }: { onEdit(): void; onDelete(): void }) {
  return <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100"><button type="button" onClick={onEdit} aria-label="Edit" className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-white/5 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={onDelete} aria-label="Delete" className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"><Trash2 className="h-3.5 w-3.5" /></button></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-400">{label}</span>{children}{hint && <span className="mt-1 block text-xs leading-relaxed text-gray-500">{hint}</span>}</label>; }
function ModalFooter({ saving, valid, onClose, onSave, label }: { saving: boolean; valid: boolean; onClose(): void; onSave(): void; label: string }) { return <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4"><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button icon={Check} onClick={onSave} loading={saving} disabled={!valid}>{label}</Button></footer>; }
function clampRelationship(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? Math.max(-100, Math.min(100, Math.round(number))) : 0; }
function positiveQuantity(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? Math.max(1, Math.round(number)) : 1; }
function isUniqueItem(item?: Pick<WorldbuildEntity, 'data'>): boolean { return item?.data?.itemNature === 'unique'; }

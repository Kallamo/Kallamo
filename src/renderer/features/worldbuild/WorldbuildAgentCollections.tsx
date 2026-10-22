import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2, Users, Backpack } from 'lucide-react';
import { useRef } from 'react';
import Menu, { MenuItem, MenuSeparator } from '../../components/ui/Menu';
import IconButton from '../../components/ui/IconButton';
import NumberInput from '../../components/ui/NumberInput';
import { ConnectionsGlyph } from '../../components/ui/glyphs';
import Button from '../../components/ui/Button';
import SearchableSelect from '../../components/ui/SearchableSelect';
import RelationshipSlider from './RelationshipSlider';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import { itemFamily, itemMeta, meta } from './worldbuildConfig';
import type { Toast, WorldbuildEntity } from './worldbuildTypes';
import { FieldEye, SpoilerCover, SpoilerMenuItem, SpoilerText } from './Spoilers';

// Each row of a list is hidden on its own, under the link it shows.
const linkKey = (link: { linkId: string }) => `link:${link.linkId}`;

// A faction's stance is the body's own position, which is not the sum of what its
// members feel. The wording says so, so the two never get recorded in the same voice.
const RELATION_COPY = {
  subject: {
    emptyTitle: 'No relationships yet',
    emptyDetail: 'Add only relationships this subject has formed or explicitly knows.',
    party: 'With',
    search: 'Search characters or entities',
    type: 'What they are',
    typePlaceholder: 'Friend, rival, mentor',
    value: 'How they feel',
    valueHint: '−100 is intense hostility, 0 is neutral, and 100 is deep closeness.',
    description: 'In their words',
    descriptionHint: 'Always from the open sheet\'s side. The other view lives on the other sheet.',
    descriptionPlaceholder: 'How does this subject see and feel about the other entity?',
  },
  faction: {
    emptyTitle: 'No relations yet',
    emptyDetail: 'Record where this faction stands with another group, character or entity.',
    party: 'Other party',
    search: 'Search factions, characters or entities',
    type: 'Classification',
    typePlaceholder: 'Ally, rival, enemy, patron',
    value: 'Standing',
    valueHint: '−100 is open hostility, 0 is indifference, and 100 is a close alliance.',
    description: 'The faction’s position',
    descriptionHint: 'This is the group’s official stance. Individual members may feel otherwise, and that belongs on their own sheets.',
    descriptionPlaceholder: 'How does this faction, as a body, regard them?',
  },
};
type RelationCopy = typeof RELATION_COPY.subject;

const INPUT = 'wb-input min-h-10 w-full rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';

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
  /** Card heading. Factions call these "Relations" rather than "Relationships". */
  title?: string;
}

interface RelationshipDraft {
  link?: EntityLink;
  targetId: string;
  targetQuery: string;
  label: string;
  value: number;
  description: string;
}

export function WorldbuildRelationships({ workspaceId, subject, links, options, api, showToast, onChanged, title = 'Relationships' }: RelationshipProps) {
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

  const copy = subject.type === 'Factions' ? RELATION_COPY.faction : RELATION_COPY.subject;
  const outgoing = links.filter(link => link.direction !== 'incoming');
  const incoming = links.filter(link => link.direction === 'incoming');
  const [showIncoming, setShowIncoming] = useState(false);
  return (
    <CollectionShell icon={ConnectionsGlyph} title={title} count={outgoing.length || undefined} empty={!links.length && !editor} emptyVerb="Add" onAdd={available.length ? startAdd : undefined}>
      <div className="divide-y divide-border-subtle">
        {editor && !editor.link && <div className="pb-3"><RelationshipEditor subjectName={subject.canonicalName} draft={editor} setDraft={setEditor} options={available} copy={copy} onSave={save} onClose={() => setEditor(null)} saving={saving} /></div>}
        {outgoing.map(link => editor?.link?.linkId === link.linkId
          ? <div key={link.linkId} className="py-3"><SpoilerCover field={linkKey(link)}><RelationshipEditor subjectName={subject.canonicalName} draft={editor} setDraft={setEditor} options={[link.entity as WorldbuildEntity, ...available]} copy={copy} onSave={save} onClose={() => setEditor(null)} saving={saving} /></SpoilerCover></div>
          : <div key={link.linkId}><SpoilerCover field={linkKey(link)} className="my-2.5"><RelationshipRow link={link} onEdit={() => startEdit(link)} onDelete={() => setDeleting(link)} /></SpoilerCover></div>)}
        {!outgoing.length && !editor && <p className="py-3 text-sm text-text-disabled">{copy.emptyDetail}</p>}
      </div>
      {incoming.length > 0 && (
        <div className="mt-1 border-t border-border-subtle pt-3">
          <button type="button" aria-expanded={showIncoming} onClick={() => setShowIncoming(v => !v)}
            className="flex w-full items-center gap-2 rounded text-left text-sm font-medium text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showIncoming ? 'rotate-90' : ''}`} aria-hidden="true" />
            How others see {subject.canonicalName}
            <span className="text-xs tabular-nums text-text-subtle">{incoming.length}</span>
            <span className="flex-1" />
            <span className="text-xs font-normal text-text-subtle">Written on their sheets</span>
          </button>
          {showIncoming && <div className="mt-1 divide-y divide-border-subtle">{incoming.map(link => <div key={link.linkId}><SpoilerCover field={linkKey(link)} className="my-2.5"><RelationshipRow link={link} readOnly /></SpoilerCover></div>)}</div>}
        </div>
      )}
      {deleting && <ConfirmDialog title="Delete relationship" message={`Delete ${subject.canonicalName}'s relationship with ${deleting.entity.canonicalName}? This removes only this direction and cannot be undone.`} actions={[
        { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
        { label: 'Delete', variant: 'danger', loading: saving, autoFocus: true, onClick: remove },
      ]} onClose={() => setDeleting(null)} />}
    </CollectionShell>
  );
}

// A relationship read at a glance: who, what they are, how it leans, and why.
function RelationshipRow({ link, onEdit, onDelete, readOnly = false }: { link: EntityLink; onEdit?(): void; onDelete?(): void; readOnly?: boolean }) {
  const value = clampRelationship(link.metadata?.value);
  const description = String(link.metadata?.description ?? '').trim();
  const positive = value >= 0;
  const Icon = meta(link.entity.type).icon;
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_9.5rem_auto] items-start gap-4 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${meta(link.entity.type).medallion}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
          <h4 className="text-sm font-semibold text-text-primary">{link.entity.canonicalName}</h4>
          {link.label ? <span className="text-sm font-medium text-accent"><SpoilerText text={link.label} /></span> : <span className="text-sm text-text-disabled">No label</span>}
        </div>
        {description && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted"><SpoilerText text={description} /></p>}
      </div>
      <div className="pt-1" aria-label={`Feeling ${value > 0 ? '+' : ''}${value} out of 100`}>
        <div className="flex justify-between text-xs text-text-subtle"><span>Hostile</span><span className={`font-semibold tabular-nums ${value === 0 ? 'text-text-muted' : positive ? 'text-status-success' : 'text-status-danger'}`}>{value > 0 ? '+' : ''}{value}</span><span>Close</span></div>
        <div className="relative mt-1.5 h-1.5 rounded-full bg-surface-hover">
          <span aria-hidden="true" className="absolute left-1/2 -top-0.5 h-2.5 w-px bg-border-strong" />
          <span aria-hidden="true" className={`absolute top-0 bottom-0 rounded-full ${positive ? 'left-1/2 bg-status-success' : 'right-1/2 bg-status-danger'}`} style={{ width: `${Math.abs(value) / 2}%` }} />
        </div>
      </div>
      {readOnly ? <FieldEye field={linkKey(link)} className="mt-0.5" /> : <RowActions spoiler={linkKey(link)} onEdit={onEdit!} onDelete={onDelete!} />}
    </article>
  );
}

function RelationshipEditor({ draft, setDraft, options, copy, onSave, onClose, saving, subjectName = '' }: {
  draft: RelationshipDraft; setDraft(draft: RelationshipDraft): void; options: WorldbuildEntity[]; copy: RelationCopy; onSave(): void; onClose(): void; saving: boolean; subjectName?: string;
}) {
  const update = (patch: Partial<RelationshipDraft>) => setDraft({ ...draft, ...patch });
  // Named on both sides, so the direction of the relationship cannot be read backwards.
  const subject = firstName(subjectName);
  const target = firstName(options.find(option => option.id === draft.targetId)?.canonicalName || draft.link?.entity.canonicalName || '');
  const personal = copy === RELATION_COPY.subject && Boolean(subject);
  const typeLabel = personal ? `What ${target || 'they'} ${target ? 'is' : 'are'} to ${subject}` : copy.type;
  const valueLabel = personal ? `How ${subject} feels` : copy.value;
  const descriptionLabel = personal ? `In ${subject}'s words` : copy.description;
  const descriptionHint = personal ? `Always from ${subject}'s side.${target ? ` ${target}'s view lives on ${target}'s sheet.` : ' The other view lives on the other sheet.'}` : copy.descriptionHint;
  return <section className="overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/80">
    <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle px-4">
      <ConnectionsGlyph className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
      <h4 className="text-sm font-semibold text-text-primary">{draft.link ? `Edit relationship with ${draft.link.entity.canonicalName}` : 'New relationship'}</h4>
    </header>
    <div className="space-y-4 p-4">
      {/* items-end keeps both inputs on one baseline when a label wraps to two lines. */}
      <div className="grid grid-cols-2 items-end gap-4">
        <Field label={copy.party}>
          <EntityCombobox options={options} value={draft.targetId} query={draft.targetQuery} placeholder={copy.search} onChange={(targetId, targetQuery) => update({ targetId, targetQuery })} autoFocus={!draft.link} />
        </Field>
        <Field label={typeLabel}>
          <input className={INPUT} value={draft.label} onChange={event => update({ label: event.target.value })} placeholder={copy.typePlaceholder} autoFocus={Boolean(draft.link)} />
        </Field>
      </div>
      <Field label={valueLabel} hint={personal ? undefined : copy.valueHint}>
        <RelationshipSlider label={valueLabel} value={draft.value} onChange={value => update({ value })} ends={personal} />
      </Field>
      <Field label={descriptionLabel} hint={descriptionHint}>
        <textarea className={`${INPUT} min-h-20 resize-y`} value={draft.description} onChange={event => update({ description: event.target.value })} placeholder={personal ? `How ${subject} sees ${target || 'them'}, in their own terms` : copy.descriptionPlaceholder} />
      </Field>
      <div className="flex justify-end gap-2"><Button variant="subtle" size="sm" onClick={onClose} disabled={saving}>Cancel</Button><Button icon={Check} size="sm" onClick={onSave} loading={saving} disabled={!draft.targetId}>Save relationship</Button></div>
    </div>
  </section>;
}

function EntityCombobox({ options, value, query, onChange, autoFocus, placeholder = 'Search characters or entities' }: { options: WorldbuildEntity[]; value: string; query: string; onChange(value: string, query: string): void; autoFocus?: boolean; placeholder?: string }) {
  void query;
  void autoFocus;
  return <SearchableSelect
    value={value}
    onChange={(targetId: string) => {
      const selected = options.find(option => option.id === targetId);
      onChange(targetId, selected?.canonicalName || '');
    }}
    // Group by the type's own name, trimmed to its first word so the tag stays short.
    options={options.map(option => ({
      id: option.id,
      label: option.canonicalName,
      aliases: option.aliases,
      group: meta(option.type).label.split(' / ')[0],
      dotClassName: meta(option.type).dot,
    }))}
    placeholder={placeholder}
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
  return <CollectionShell icon={Backpack} title="Carried" count={links.length || undefined} empty={!links.length && !editor} emptyVerb="Add item" onAdd={available.length ? startAdd : undefined}>
    {editor && <div className="pt-2"><InventoryEditor spoiler={editor.link ? linkKey(editor.link) : null} draft={editor} setDraft={setEditor} options={editor.link ? [editor.link.entity as WorldbuildEntity] : available} onSave={save} onClose={() => setEditor(null)} saving={saving} /></div>}
    <div className="grid grid-cols-1 gap-2.5 py-2 sm:grid-cols-2">{links.map(link => <SpoilerCover key={link.linkId} field={linkKey(link)} className="w-full justify-center py-3"><InventoryCard link={link} onEdit={() => startEdit(link)} onDelete={() => setDeleting(link)} /></SpoilerCover>)}</div>
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
  const family = itemFamily(String(link.entity.data?.itemType ?? ''));
  return <article className={`group flex items-center gap-3 rounded-card border bg-gradient-to-br to-transparent px-3 py-3 ${family.wash}`}>
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control border ${family.tile}`}><ItemIcon className="h-5 w-5" /></div>
    <div className="min-w-0 flex-1">
      <h4 className="text-sm font-semibold leading-snug text-text-primary">{link.entity.canonicalName}</h4>
      <p className="mt-0.5 text-xs text-text-muted">{[
        isUnique ? `Unique ${link.entity.data?.itemType ? String(link.entity.data.itemType).toLowerCase() : 'item'}` : itemMeta(link.entity.data?.itemType).label,
        !isUnique && quantity > 1 ? `×${quantity}` : null,
        condition || null,
      ].filter(Boolean).join(' · ')}{link.metadata?.equipped ? <span className="text-text-secondary"> · Equipped</span> : null}</p>
      {notes && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-subtle"><SpoilerText text={notes} /></p>}
    </div>
    <RowActions spoiler={linkKey(link)} onEdit={onEdit} onDelete={onDelete} />
  </article>;
}

function InventoryEditor({ draft, setDraft, options, onSave, onClose, saving, spoiler = null }: { draft: InventoryDraft; setDraft(draft: InventoryDraft): void; options: WorldbuildEntity[]; onSave(): void; onClose(): void; saving: boolean; spoiler?: string | null }) {
  const update = (patch: Partial<InventoryDraft>) => setDraft({ ...draft, ...patch });
  const isUnique = isUniqueItem(options.find(option => option.id === draft.itemId));
  return <Modal size="lg" title={draft.link ? 'Edit inventory item' : 'Add inventory item'} icon={Backpack} iconClassName="text-text-muted" onClose={onClose} closeOnEsc={!saving} closeOnOverlay={!saving}>
    <SpoilerCover field={spoiler}><div className="space-y-5 p-5">
      <div className={`grid gap-4 ${isUnique ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_8rem]'}`}>
        <Field label="Item"><SearchableSelect value={draft.itemId} disabled={Boolean(draft.link)} onChange={(itemId: string) => update({ itemId })} options={options.map(option => ({ id: option.id, label: option.canonicalName, aliases: option.aliases, group: itemMeta(option.data?.itemType).label, icon: itemMeta(option.data?.itemType).icon }))} placeholder="Search for an item" /></Field>
        {!isUnique && <Field label="Quantity"><NumberInput className={INPUT} min={1} value={Number(draft.quantity)} onChange={quantity => update({ quantity: quantity ?? undefined })} /></Field>}
      </div>
      <Field label="Condition"><input className={INPUT} value={draft.condition} onChange={event => update({ condition: event.target.value })} placeholder="Worn, pristine, damaged…" /></Field>
      <Field label="Notes"><textarea className={`${INPUT} min-h-28 resize-y`} value={draft.notes} onChange={event => update({ notes: event.target.value })} placeholder="How it is carried, used, or distinguished…" /></Field>
    </div></SpoilerCover>
    <ModalFooter saving={saving} valid={Boolean(draft.itemId) && draft.quantity >= 1} onClose={onClose} onSave={onSave} label="Save item" />
  </Modal>;
}

// Same card as a sheet section, so a relational tab reads like the rest of the sheet.
function CollectionShell({ icon: Icon, title, count, empty = false, emptyVerb = 'Add', onAdd, children }: { icon: typeof Users; title: string; count?: number; empty?: boolean; emptyVerb?: string; onAdd?: () => void; children: React.ReactNode }) {
  if (empty) {
    return <section className="flex min-h-12 items-center gap-2.5 rounded-card border border-border-subtle bg-surface-panel-muted/45 py-1.5 pl-4 pr-2 backdrop-blur-md">
      <Icon className="h-4 w-4 shrink-0 text-text-disabled" aria-hidden="true" />
      <h3 className="text-sm font-semibold text-text-secondary">{title}</h3>
      <span className="min-w-0 flex-1 truncate text-sm text-text-disabled">None yet</span>
      {onAdd && <button type="button" onClick={onAdd} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Plus className="h-3.5 w-3.5" aria-hidden="true" />{emptyVerb}</button>}
    </section>;
  }
  return <section className="ws-card overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
    <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle pl-4 pr-2">
      <Icon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
      <h3 className="min-w-0 truncate text-sm font-semibold text-text-primary">{title}</h3>
      {count != null && <span className="text-xs tabular-nums text-text-subtle">{count}</span>}
      <span className="flex-1" />
      {onAdd && <button type="button" onClick={onAdd} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Plus className="h-3.5 w-3.5" aria-hidden="true" />{emptyVerb}</button>}
    </header>
    <div className="px-4 py-2">{children}</div>
  </section>;
}

function RowActions({ onEdit, onDelete, spoiler = null }: { onEdit(): void; onDelete(): void; spoiler?: string | null }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <IconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label="Actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} />
    <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Actions" className="w-44">
      <MenuItem icon={Pencil} label="Edit" onSelect={() => { setOpen(false); onEdit(); }} />
      <SpoilerMenuItem field={spoiler} onDone={() => setOpen(false)} />
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Delete" danger onSelect={() => { setOpen(false); onDelete(); }} />
    </Menu>
  </>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>{children}{hint && <span className="mt-1 block text-xs leading-relaxed text-text-subtle">{hint}</span>}</label>; }
function ModalFooter({ saving, valid, onClose, onSave, label }: { saving: boolean; valid: boolean; onClose(): void; onSave(): void; label: string }) { return <footer className="flex justify-end gap-2 border-t border-border-subtle px-5 py-4"><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button icon={Check} onClick={onSave} loading={saving} disabled={!valid}>{label}</Button></footer>; }
function clampRelationship(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? Math.max(-100, Math.min(100, Math.round(number))) : 0; }
const firstName = (name: string) => String(name || '').trim().split(/\s+/)[0] || '';
function positiveQuantity(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? Math.max(1, Math.round(number)) : 1; }
function isUniqueItem(item?: Pick<WorldbuildEntity, 'data'>): boolean { return item?.data?.itemNature === 'unique'; }

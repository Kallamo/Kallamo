import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CornerDownRight, Eye, EyeOff, GripVertical, LayoutTemplate, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Menu, { MenuItem, MenuSeparator } from '../../components/ui/Menu';
import UiIconButton from '../../components/ui/IconButton';
import type { EntityFieldDefinition, EntityFieldType } from '../../../narrative/contracts';
import Button from '../../components/ui/Button';
import Checkbox from '../../components/ui/Checkbox';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import SelectMenuBase from '../../components/ui/SelectMenu';

const SelectMenu = SelectMenuBase as unknown as React.ComponentType<Record<string, unknown>>;
import type { Toast, WorldbuildApi, WorldbuildEntity, WorldbuildEntityTemplate, WorldbuildTemplateSection } from './worldbuildTypes';
import { FieldInput } from './WorldbuildCustomFields';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { meta, TYPE_ORDER } from './worldbuildConfig';
import { LOOSE_FIELDS_SECTION, normalizeFieldSections, normalizeTemplateSections, sectionOfField, templateSections as templatableSections, VARIANT_LABELS, variantsOf } from './worldbuildSections';

const INPUT = 'wb-input w-full rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/15';

interface Props { workspaceId: string; api: WorldbuildApi; templates: WorldbuildEntityTemplate[]; entities?: WorldbuildEntity[]; showToast: Toast; onClose(): void; onSaved(template: WorldbuildEntityTemplate): void; onFieldsChanged?(typeId: string, change: { valuesChanged: boolean }): void; }
type FieldDraft = { definition?: EntityFieldDefinition; sectionId: string; label: string; valueType: EntityFieldType; optionsText: string; required: boolean; aiAccess: EntityFieldDefinition['aiAccess']; aiGuidance: string; defaultValue: unknown; carryDefault?: boolean };
type DeleteTarget = { kind: 'field'; field: EntityFieldDefinition } | { kind: 'section'; section: WorldbuildTemplateSection; fields: EntityFieldDefinition[] };

export default function WorldbuildTemplateManager({ workspaceId, api, templates, entities = [], showToast, onClose, onSaved, onFieldsChanged }: Props) {
  const [typeId, setTypeId] = useState('Characters');
  const [draft, setDraft] = useState<WorldbuildEntityTemplate>(() => templateFor('Characters', templates));
  const [fields, setFields] = useState<EntityFieldDefinition[]>([]);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [typeChange, setTypeChange] = useState<{ kept: number; lost: Array<{ id: string; name: string }>; defaultLost: boolean } | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [saving, setSaving] = useState(false);

  const saved = useMemo(() => templateFor(typeId, templates), [templates, typeId]);
  useEffect(() => { setDraft(saved); setFieldDraft(null); }, [saved]);
  useEffect(() => { api.listWorldbuildFieldDefinitions(workspaceId, typeId).then(result => setFields(result.fields || [])).catch(() => setFields([])); }, [api, typeId, workspaceId]);
  const sections = draft.layout.sections ?? [];
  // Field edits persist immediately and carry the draft with them, since a field's section lives
  // in the template.
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const variants = variantsOf(typeId);
  const variantOf = (section: WorldbuildTemplateSection) => templatableSections(typeId).find(item => item.id === section.id)?.variant;

  const updateSections = (next: WorldbuildTemplateSection[]) => setDraft(current => ({ ...current, layout: { ...current.layout, sections: next } }));
  const updateSection = (id: string, patch: Partial<WorldbuildTemplateSection>) => updateSections(sections.map(section => section.id === id ? { ...section, ...patch } : section));
  const moveSection = (index: number, direction: -1 | 1) => placeSection(index, index + direction);
  // Dragging and the menu's Move up/down share one reorder, so both paths behave the same.
  const placeSection = (from: number, to: number) => {
    if (from === to || to < 0 || to >= sections.length) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateSections(next);
  };
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const startField = (sectionId: string, definition?: EntityFieldDefinition) => setFieldDraft({
    definition, sectionId,
    label: definition?.label ?? '',
    valueType: definition?.valueType ?? 'short-text',
    optionsText: definition?.options?.map(option => option.label).join('\n') ?? '',
    required: definition?.required ?? false,
    aiAccess: definition?.aiAccess ?? 'read-write',
    aiGuidance: definition?.aiGuidance ?? '',
    defaultValue: definition?.defaultValue ?? null,
  });

  const persistTemplate = async (next: WorldbuildEntityTemplate) => {
    const fieldSections = normalizeFieldSections(typeId, next, Object.keys(next.layout.fieldSections || {}));
    const result = await api.saveWorldbuildEntityTemplate({ ...next, layout: { ...next.layout, fieldSections }, workspaceId });
    if (!result.success || !result.template) throw new Error(result.error || 'Could not save the template.');
    onSaved(result.template);
    setDraft(templateFor(typeId, [result.template]));
    return result.template;
  };

  const fieldPayload = (draftField: FieldDraft) => {
    const isChoice = draftField.valueType === 'single-choice' || draftField.valueType === 'multiple-choice';
    return {
      id: draftField.definition?.id, key: draftField.definition?.key,
      projectId: workspaceId, typeId, label: draftField.label.trim(), valueType: draftField.valueType,
      options: isChoice ? optionsFromText(draftField.optionsText, draftField.definition?.options) : undefined,
      required: draftField.required, position: draftField.definition?.position ?? fields.length,
      aiAccess: draftField.aiAccess, aiGuidance: draftField.aiGuidance,
      defaultValue: draftField.defaultValue ?? null,
      carryDefault: Boolean(draftField.carryDefault),
    };
  };

  const saveField = async (confirmTypeChange = false) => {
    if (!fieldDraft?.label.trim()) return;
    const hasTypeChange = Boolean(fieldDraft.definition && fieldDraft.definition.valueType !== fieldDraft.valueType);
    setSaving(true);
    try {
      if (hasTypeChange && !confirmTypeChange) {
        const preview = await api.previewWorldbuildFieldTypeChange(fieldPayload(fieldDraft));
        if (!preview.success) throw new Error(preview.error || 'Could not check the stored values.');
        setTypeChange({ kept: preview.kept ?? 0, lost: preview.lost ?? [], defaultLost: Boolean(preview.defaultLost) });
        return;
      }
      const result = await api.saveWorldbuildFieldDefinition({ ...fieldPayload(fieldDraft), confirmTypeChange });
      if (!result.success || !result.field) throw new Error(result.error || 'Could not save the custom field.');
      setFields(current => [...current.filter(field => field.id !== result.field!.id), result.field!].sort((a, b) => a.position - b.position));
      await persistTemplate({
        ...draft,
        layout: { ...draft.layout, fieldSections: { ...(draft.layout.fieldSections || {}), [result.field.id]: fieldDraft.sectionId } },
      });
      onFieldsChanged?.(typeId, { valuesChanged: hasTypeChange });
      showToast(fieldDraft.definition ? 'Custom field updated.' : 'Custom field added.', 'success');
      setFieldDraft(null);
      setTypeChange(null);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save the custom field.', 'error'); }
    finally { setSaving(false); }
  };

  const removeCustomContent = async () => {
    if (!deleting) return;
    setSaving(true);
    try {
      const targets = deleting.kind === 'field' ? [deleting.field] : deleting.fields;
      for (const field of targets) {
        const result = await api.deleteWorldbuildFieldDefinition(workspaceId, field.id);
        if (!result.success) throw new Error(result.error || `Could not delete ${field.label}.`);
      }
      const deletedIds = new Set(targets.map(field => field.id));
      const fieldSections = Object.fromEntries(Object.entries(draft.layout.fieldSections || {}).filter(([fieldId]) => !deletedIds.has(fieldId)));
      const nextSections = deleting.kind === 'section' ? sections.filter(section => section.id !== deleting.section.id) : sections;
      setFields(current => current.filter(field => !deletedIds.has(field.id)));
      await persistTemplate({ ...draft, layout: { ...draft.layout, sections: nextSections, fieldSections } });
      onFieldsChanged?.(typeId, { valuesChanged: true });
      setDeleting(null);
      showToast(deleting.kind === 'section' ? 'Custom section deleted.' : 'Custom field deleted.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not delete the custom content.', 'error'); }
    finally { setSaving(false); }
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      await persistTemplate(draft);
      showToast('Entity type saved.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save the template.', 'error'); }
    finally { setSaving(false); }
  };

  const moveField = async (field: EntityFieldDefinition, sectionId: string) => {
    setSaving(true);
    try {
      await persistTemplate({ ...draft, layout: { ...draft.layout, fieldSections: { ...(draft.layout.fieldSections || {}), [field.id]: sectionId } } });
      onFieldsChanged?.(typeId, { valuesChanged: false });
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not move the field.', 'error'); }
    finally { setSaving(false); }
  };
  const sectionOf = (field: EntityFieldDefinition) => sectionOfField(typeId, draft, field.id);
  const looseFields = fields.filter(field => sectionOf(field) === LOOSE_FIELDS_SECTION.id);
  const moveTargets = sections.map(section => ({ id: section.id, label: section.label }));
  const fieldRow = (field: EntityFieldDefinition, sectionId: string) => (
    <div key={field.id} className="flex items-center gap-2 rounded-md py-0.5 pl-6 text-sm">
      <span className="min-w-0 flex-1 truncate text-text-secondary">{field.label.replace(/\s*:\s*$/, '')}</span>
      <span className="shrink-0 text-xs text-text-subtle">{VALUE_TYPE_LABELS[field.valueType]}</span>
      <FieldMenu label={field.label} moveTargets={moveTargets.filter(target => target.id !== sectionId)} onMove={target => moveField(field, target)} onEdit={() => startField(sectionId, field)} onDelete={() => setDeleting({ kind: 'field', field })} />
    </div>
  );

  const fillEmptyWithDefault = async (field: EntityFieldDefinition) => {
    setSaving(true);
    try {
      const result = await api.applyWorldbuildFieldDefault(workspaceId, field.id);
      if (!result.success) throw new Error(result.error || 'Could not fill the empty entries.');
      onFieldsChanged?.(typeId, { valuesChanged: true });
      showToast(result.updated ? `Filled ${result.updated} empty entr${result.updated === 1 ? 'y' : 'ies'}.` : 'No entry had this field empty.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not fill the empty entries.', 'error'); }
    finally { setSaving(false); }
  };
  const races = entities.filter(entity => entity.type === 'Races' && entity.status !== 'proposed');
  const defaultRace = (draft.layout as { nativeDefaults?: { race?: string } }).nativeDefaults?.race ?? '';
  const setDefaultRace = (race: string) => setDraft(current => {
    const { race: _previous, ...others } = (current.layout as { nativeDefaults?: Record<string, string> }).nativeDefaults ?? {};
    const nativeDefaults = race ? { ...others, race } : others;
    return { ...current, layout: { ...current.layout, nativeDefaults } };
  });

  const requestClose = () => { if (dirty) setConfirmingClose(true); else onClose(); };

  return <Modal size="2xl" title="Entity types" icon={LayoutTemplate} iconClassName="text-text-muted" onClose={requestClose} closeOnOverlay={!saving && !dirty} closeOnEsc={!saving && !dirty}>
    <div className="grid h-[min(42rem,calc(100vh-9rem))] min-h-0 grid-cols-[13rem_minmax(0,1fr)_20rem] overflow-hidden">
      <TypeList typeId={typeId} templates={templates} onSelect={setTypeId} />
      <TemplatePreview typeId={typeId} draft={draft} fields={fields} looseFields={looseFields} sectionOf={sectionOf} variantOf={variantOf} variants={variants} />
      <aside className="min-h-0 overflow-y-auto border-l border-border-subtle p-4 custom-scrollbar">
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-text-muted">Name in Worldbuild</span><input className={INPUT} value={draft.displayName} onChange={event => setDraft(current => ({ ...current, displayName: event.target.value }))} placeholder={typeId} /></label>
        <p className="caption mt-1">The plural shown in lists and filters.</p>
        <div className="my-4 border-t border-border-subtle" />
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">Sections</span>
          <button type="button" onClick={() => updateSections([...sections, { id: `custom-${crypto.randomUUID()}`, label: 'New section', kind: 'custom' }])} aria-label="Add a section" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted hover:bg-surface-hover/60 hover:text-text-primary"><Plus className="h-3.5 w-3.5" />Add section</button>
        </div>
        <p className="caption mb-3">Drag to reorder. Inventory, connections, knowledge and occurrences are fixed tabs.</p>
        <div className="space-y-2">{sections.map((section, index) => {
          const sectionFields = fields.filter(field => sectionOf(field) === section.id);
          const variant = variantOf(section);
          return <div key={section.id}
            draggable
            onDragStart={event => { setDragIndex(index); event.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={event => { if (dragIndex !== null) event.preventDefault(); }}
            onDrop={event => { event.preventDefault(); if (dragIndex !== null) placeSection(dragIndex, index); setDragIndex(null); }}
            onDragEnd={() => setDragIndex(null)}
            className={`rounded-card border transition-colors ${dragIndex === index ? 'opacity-50' : ''} ${section.hidden ? 'border-border-subtle bg-surface-canvas/15' : 'border-border-default bg-surface-canvas/30'}`}>
            <div className="flex items-center gap-1.5 py-1.5 pl-1.5 pr-1">
              <span aria-hidden="true" className="cursor-grab text-text-disabled active:cursor-grabbing"><GripVertical className="h-4 w-4" /></span>
              <input aria-label="Section name" className={`min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-semibold outline-none focus:bg-surface-input/60 ${section.hidden ? 'text-text-muted' : 'text-text-primary'}`} value={section.label} onChange={event => updateSection(section.id, { label: event.target.value })} />
              {section.kind === 'custom' && <Tag>Custom</Tag>}
              {variant && <Tag tone="variant">{VARIANT_LABELS[variant as keyof typeof VARIANT_LABELS]} only</Tag>}
              <IconButton label={section.hidden ? 'Show section' : 'Hide section'} onClick={() => updateSection(section.id, { hidden: !section.hidden })}>{section.hidden ? <EyeOff /> : <Eye />}</IconButton>
              <SectionMenu
                label={section.label}
                canMoveUp={index > 0}
                canMoveDown={index < sections.length - 1}
                onMoveUp={() => moveSection(index, -1)}
                onMoveDown={() => moveSection(index, 1)}
                onAddField={() => startField(section.id)}
                onDelete={section.kind === 'custom' ? () => setDeleting({ kind: 'section', section, fields: sectionFields }) : undefined}
              />
            </div>
            {!section.hidden && typeId === 'Characters' && section.id === 'identity' && <div className="border-t border-border-subtle px-3 py-2">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">Default race</span>
              <SearchableSelect value={defaultRace} onChange={(race: string) => setDefaultRace(race)} options={[{ id: '', label: 'None' }, ...races.map(race => ({ id: race.id, label: race.canonicalName }))]} placeholder="None" searchPlaceholder="Filter races…" />
              <span className="caption mt-1 block">New characters start as this race. Existing ones keep theirs.</span>
            </div>}
            {!section.hidden && (sectionFields.length > 0 || fieldDraft?.sectionId === section.id) && <div className="border-t border-border-subtle px-2 pb-1.5 pt-1">
              {sectionFields.map(field => fieldRow(field, section.id))}
              {fieldDraft?.sectionId === section.id
                ? <FieldEditor draft={fieldDraft} saving={saving} sectionLabel="" entities={entities} onChange={setFieldDraft} onCancel={() => setFieldDraft(null)} onSave={() => saveField()} onFillEmpty={fieldDraft.definition && Object.hasOwn(fieldDraft.definition, 'defaultValue') ? () => fillEmptyWithDefault(fieldDraft.definition!) : undefined} />
                : sectionFields.length > 0 && <button type="button" onClick={() => startField(section.id)} className="ml-5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-semibold text-text-muted hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add field</button>}
            </div>}
          </div>;
        })}
        {looseFields.length > 0 && <div className="rounded-card border border-dashed border-border-default bg-surface-canvas/20">
          <div className="px-3 pb-1 pt-2">
            <span className="text-sm font-semibold text-text-primary">{LOOSE_FIELDS_SECTION.label}</span>
            <p className="caption mt-0.5">Fields without a section. The sheet shows them last. Move them into a section from their menu.</p>
          </div>
          <div className="border-t border-border-subtle px-2 pb-1.5 pt-1">
            {looseFields.map(field => fieldRow(field, LOOSE_FIELDS_SECTION.id))}
            {fieldDraft?.sectionId === LOOSE_FIELDS_SECTION.id && <FieldEditor draft={fieldDraft} saving={saving} sectionLabel="" entities={entities} onChange={setFieldDraft} onCancel={() => setFieldDraft(null)} onSave={() => saveField()} onFillEmpty={fieldDraft.definition && Object.hasOwn(fieldDraft.definition, 'defaultValue') ? () => fillEmptyWithDefault(fieldDraft.definition!) : undefined} />}
          </div>
        </div>}
        </div>
      </aside>
    </div>
    <footer className="flex items-center justify-end gap-3 border-t border-border-subtle px-5 py-4">
      {dirty && <span className="caption mr-auto">Section changes are not saved yet.</span>}
      <Button variant="subtle" onClick={requestClose} disabled={saving}>Close</Button>
      <Button onClick={saveTemplate} loading={saving} disabled={!dirty}>Save changes</Button>
    </footer>
    {deleting && <ConfirmDialog title={deleting.kind === 'section' ? 'Delete custom section' : 'Delete custom field'} message={deleting.kind === 'section' ? `Delete “${deleting.section.label}”? ${deleting.fields.length ? `Its ${deleting.fields.length} custom field${deleting.fields.length === 1 ? '' : 's'} and all stored values will also be permanently deleted.` : 'This section will be permanently removed.'}` : `Delete “${deleting.field.label}” from every ${typeId.toLowerCase()} entry? All stored values will be permanently removed.`} actions={[{ label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) }, { label: 'Delete', variant: 'danger', loading: saving, autoFocus: true, onClick: removeCustomContent }]} onClose={() => setDeleting(null)} />}
    {typeChange && fieldDraft?.definition && <ConfirmDialog tone="warning" title="Change field type" message={typeChangeMessage(fieldDraft.definition.label, VALUE_TYPE_LABELS[fieldDraft.valueType], typeChange)} actions={[{ label: 'Cancel', variant: 'ghost', onClick: () => setTypeChange(null) }, { label: 'Change type', variant: typeChange.lost.length ? 'danger' : 'primary', loading: saving, autoFocus: true, onClick: () => saveField(true) }]} onClose={() => setTypeChange(null)} />}
    {confirmingClose && <ConfirmDialog tone="warning" title="Discard section changes" message="The renames, order and visibility you changed have not been saved. Close anyway?" actions={[{ label: 'Keep editing', variant: 'ghost', onClick: () => setConfirmingClose(false) }, { label: 'Discard', variant: 'danger', autoFocus: true, onClick: onClose }]} onClose={() => setConfirmingClose(false)} />}
  </Modal>;
}

// Names the entries that lose a value, so a type change never empties a field unannounced.
function typeChangeMessage(label: string, typeLabel: string, change: { kept: number; lost: Array<{ name: string }>; defaultLost: boolean }) {
  const head = `Change “${label}” to ${typeLabel.toLowerCase()}?`;
  const lostDefault = change.defaultLost ? ' Its default value cannot become this type and will be removed.' : '';
  const kept = change.kept ? ` ${change.kept} stored value${change.kept === 1 ? '' : 's'} will be converted.` : '';
  if (!change.lost.length) return `${head}${kept || ' No entry holds a value yet.'}${lostDefault}`;
  const names = change.lost.slice(0, 5).map(entry => entry.name).join(', ');
  const more = change.lost.length > 5 ? ` and ${change.lost.length - 5} more` : '';
  return `${head}${kept} ${change.lost.length} value${change.lost.length === 1 ? '' : 's'} cannot become ${typeLabel.toLowerCase()} and will be cleared: ${names}${more}.${lostDefault}`;
}

// Stored values point at option ids, so an edited line keeps its id: by label first, then a line
// changed in place is a rename. Any other line is a new option.
function optionsFromText(text: string, previous: Array<{ id: string; label: string }> = []) {
  const labels = text.split('\n').map(label => label.trim()).filter(Boolean);
  const byLabel = new Map(previous.map(option => [option.label.trim().toLocaleLowerCase(), option.id]));
  const kept = new Set(labels.flatMap(label => byLabel.get(label.toLocaleLowerCase()) ?? []));
  const used = new Set<string>();
  return labels.map((label, index) => {
    const renamed = previous[index] && !kept.has(previous[index].id) ? previous[index].id : undefined;
    const id = [byLabel.get(label.toLocaleLowerCase()), renamed].find(candidate => candidate && !used.has(candidate));
    if (id) used.add(id);
    return id ? { id, label } : { label };
  });
}

// How each value type reads to a person, shown beside every field.
const VALUE_TYPE_LABELS: Record<EntityFieldType, string> = {
  'short-text': 'Short text', 'long-text': 'Long text', number: 'Number', range: 'Number range', boolean: 'Yes or no',
  'single-choice': 'One choice', 'multiple-choice': 'Several choices', 'entity-reference': 'An entity', 'entity-reference-list': 'Several entities',
};

function Tag({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'variant' | 'muted' }) {
  const tones = {
    default: 'border-border-default bg-surface-hover/60 text-text-secondary',
    variant: 'border-entity-creature/25 bg-entity-creature/10 text-entity-creature',
    muted: 'border-border-subtle bg-surface-hover/40 text-text-subtle',
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function TypeList({ typeId, templates, onSelect }: { typeId: string; templates: WorldbuildEntityTemplate[]; onSelect(typeId: string): void }) {
  return <aside className="min-h-0 overflow-y-auto border-r border-border-subtle bg-surface-canvas/30 p-3 custom-scrollbar">

    <div className="space-y-1">{TYPE_ORDER.map(id => {
      const type = meta(id);
      const Icon = type.icon;
      const active = typeId === id;
      return <button key={id} type="button" onClick={() => onSelect(id)} className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm transition-colors ${active ? 'bg-accent/[0.13] font-semibold text-accent' : 'text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary'}`}>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${type.medallion}`}><Icon className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1 truncate">{templates.find(template => template.typeId === id)?.displayName || type.plural || type.label}</span>
      </button>;
    })}</div>
  </aside>;
}

// The short fields a native section draws in its grid, so the preview reads like the sheet.
const NATIVE_GRID: Record<string, Record<string, string[]>> = {
  Characters: { identity: ['Race', 'Age', 'Born'] },
  Locations: { overview: ['Size', 'Type', 'Inside'] },
  Items: { details: ['Nature', 'Category', 'Owner'] },
  Creatures: { details: ['Nature', 'Disposition', 'Habitat'] },
  Events: { overview: ['How often', 'Date', 'Where'] },
};

function TemplatePreview({ typeId, draft, fields, looseFields, sectionOf, variantOf, variants }: {
  typeId: string; draft: WorldbuildEntityTemplate; fields: EntityFieldDefinition[]; looseFields: EntityFieldDefinition[];
  sectionOf(field: EntityFieldDefinition): string;
  variantOf(section: WorldbuildTemplateSection): string | undefined;
  variants: string[];
}) {
  const visible = (draft.layout.sections || []).filter(section => !section.hidden);
  return <main className="min-h-0 min-w-0 overflow-y-auto bg-surface-panel-muted/55 p-5 custom-scrollbar">
    <div className="mb-5">
      <p className="text-xs font-medium text-text-muted">Preview of the Data tab</p>
      {variants.length > 0 && (
        <p className="caption mt-1.5">This type has two shapes. A section marked <span className="text-entity-creature">{VARIANT_LABELS.individual} only</span> appears on that shape alone.</p>
      )}
    </div>
    <div className="space-y-3">{visible.map(section => {
      const sectionFields = fields.filter(field => sectionOf(field) === section.id);
      const variant = variantOf(section);
      return <div key={section.id} className="overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/70">
        <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-2.5">
          <span className="truncate text-sm font-semibold text-text-primary">{section.label}</span>
          {variant && <Tag tone="variant">{VARIANT_LABELS[variant as keyof typeof VARIANT_LABELS]}</Tag>}
        </div>
        <div className="p-4">
          <SectionPreview grid={section.kind === 'native' ? NATIVE_GRID[typeId]?.[section.id] || [] : []} native={section.kind === 'native'} fields={sectionFields} />
        </div>
      </div>;
    })}
    {looseFields.length > 0 && <div className="overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/70">
      <div className="border-b border-border-subtle px-4 py-2.5"><span className="truncate text-sm font-semibold text-text-primary">{LOOSE_FIELDS_SECTION.label}</span></div>
      <div className="p-4"><SectionPreview grid={[]} native={false} fields={looseFields} /></div>
    </div>}
    {!visible.length && !looseFields.length && <p className="rounded-card border border-dashed border-border-subtle px-4 py-6 text-center text-sm text-text-disabled">Every section is hidden.</p>}
    </div>
  </main>;
}

// Short fields share the section's grid, native ones first; long fields take the full width below.
function SectionPreview({ grid, native, fields }: { grid: string[]; native: boolean; fields: EntityFieldDefinition[] }) {
  const isLong = (field: EntityFieldDefinition) => ['long-text', 'multiple-choice', 'entity-reference-list'].includes(field.valueType);
  const name = (field: EntityFieldDefinition) => field.label.replace(/\s*:\s*$/, '');
  const cells = [...grid, ...fields.filter(field => !isLong(field)).map(name)];
  const long = fields.filter(isLong).map(name);
  const cell = (label: string, key: string, wide = false) => <div key={key} className={wide ? 'col-span-3' : ''}>
    <p className="truncate text-xs font-medium text-text-muted">{label}</p>
    <div className={`mt-1.5 h-2 rounded bg-surface-hover/50 ${wide ? 'w-5/6' : 'w-2/3'}`} />
  </div>;
  const prose = native && !grid.length;
  return <>
    {prose && <><div className="h-2 w-5/6 rounded bg-surface-hover/55" /><div className="mt-2 h-2 w-1/2 rounded bg-surface-hover/40" /></>}
    {!native && !fields.length && <p className="text-xs text-text-disabled">No fields yet</p>}
    {(cells.length > 0 || long.length > 0) && <div className={`grid grid-cols-3 gap-x-4 gap-y-3 ${prose ? 'mt-4' : ''}`}>
      {cells.map((label, index) => cell(label, `cell-${index}`))}
      {long.map((label, index) => cell(label, `long-${index}`, true))}
    </div>}
  </>;
}

function FieldEditor({ draft, saving, sectionLabel, entities, onChange, onCancel, onSave, onFillEmpty }: { draft: FieldDraft; saving: boolean; sectionLabel: string; entities: WorldbuildEntity[]; onChange(draft: FieldDraft): void; onCancel(): void; onSave(): void; onFillEmpty?(): void }) {
  const update = (patch: Partial<FieldDraft>) => onChange({ ...draft, ...patch });
  const isChoice = draft.valueType === 'single-choice' || draft.valueType === 'multiple-choice';
  // An option typed but not saved yet has no id; its label stands in, and the main maps it on save.
  const preview = {
    id: draft.definition?.id ?? 'draft', projectId: '', typeId: '', key: draft.definition?.key ?? 'draft', position: 0,
    label: 'Default', valueType: draft.valueType, required: false, aiAccess: draft.aiAccess,
    constraints: draft.definition?.valueType === draft.valueType ? draft.definition?.constraints : undefined,
    options: isChoice ? optionsFromText(draft.optionsText, draft.definition?.options).map(option => ({ id: option.id ?? option.label, label: option.label })) : undefined,
  } as EntityFieldDefinition;
  const savedDefault = draft.definition && Object.hasOwn(draft.definition, 'defaultValue') && draft.definition.valueType === draft.valueType;
  return <div className="my-2 space-y-2 rounded-control border border-border-strong bg-surface-hover/30 p-3">
    <p className="text-sm font-semibold text-text-primary">{draft.definition ? 'Edit field' : 'New field'}{sectionLabel ? ` · ${sectionLabel}` : ''}</p>
    <input aria-label="Field name" className={INPUT} value={draft.label} onChange={event => update({ label: event.target.value })} placeholder="Field name" autoFocus />
    <SelectMenu ariaLabel="Field type" value={draft.valueType} onChange={(valueType: EntityFieldType) => update({ valueType, optionsText: '', defaultValue: null, carryDefault: true })} options={Object.entries(VALUE_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
    {isChoice && <textarea aria-label="Available options" className={`${INPUT} min-h-20 resize-y`} value={draft.optionsText} onChange={event => update({ optionsText: event.target.value })} placeholder="One option per line" />}
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-muted">Default</span>
        {draft.defaultValue != null && draft.defaultValue !== '' && <button type="button" onClick={() => update({ defaultValue: null, carryDefault: false })} className="rounded px-1 text-xs font-semibold text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Clear</button>}
      </div>
      <FieldInput definition={preview} value={draft.defaultValue ?? (draft.valueType === 'multiple-choice' || draft.valueType === 'entity-reference-list' ? [] : '')} onChange={defaultValue => update({ defaultValue, carryDefault: false })} entities={entities} />
      <span className="caption mt-1 block">{draft.carryDefault && draft.definition && Object.hasOwn(draft.definition, 'defaultValue') && draft.defaultValue == null
        ? 'The current default is converted to the new type when you save.'
        : 'Optional. New entries start with this value.'}</span>
      {onFillEmpty && savedDefault && <button type="button" disabled={saving} onClick={onFillEmpty} className="mt-1.5 inline-flex h-7 items-center rounded-md px-1.5 text-xs font-semibold text-text-muted hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40">Fill empty entries with the default</button>}
    </div>
    <SelectMenu ariaLabel="AI access" value={draft.aiAccess} onChange={(aiAccess: FieldDraft['aiAccess']) => update({ aiAccess })} options={[{ value: 'read-write', label: 'The AI reads it and suggests edits' }, { value: 'read-only', label: 'The AI reads it only' }, { value: 'hidden', label: 'Hidden from the AI' }]} />
    {draft.aiAccess !== 'hidden' && <label className="block"><span className="mb-1.5 block text-xs font-medium text-text-muted">AI guidance</span><textarea className={`${INPUT} min-h-20 resize-y`} value={draft.aiGuidance} onChange={event => update({ aiGuidance: event.target.value })} placeholder="How the AI should read or fill this field" /><span className="caption mt-1 block">Optional. Describe the field's purpose and what the AI should not infer.</span></label>}
    <div className="flex items-center gap-2.5 rounded-control border border-border-subtle px-3 py-2.5"><Checkbox checked={draft.required} onChange={required => update({ required })} ariaLabel="Required field" /><span className="text-xs text-text-secondary">Required</span></div>
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button><Button size="sm" onClick={onSave} disabled={!draft.label.trim()} loading={saving}>{draft.definition ? 'Save field' : 'Add field'}</Button></div>
  </div>;
}

function SectionMenu({ label, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onAddField, onDelete }: {
  label: string; canMoveUp: boolean; canMoveDown: boolean; onMoveUp(): void; onMoveDown(): void; onAddField(): void; onDelete?(): void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => { setOpen(false); action(); };
  return <>
    <UiIconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label={`${label} actions`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} />
    <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label={`${label} actions`} className="w-52" align="right">
      <MenuItem icon={Plus} label="Add field" onSelect={run(onAddField)} />
      <MenuItem icon={ArrowUp} label="Move up" disabled={!canMoveUp} onSelect={run(onMoveUp)} />
      <MenuItem icon={ArrowDown} label="Move down" disabled={!canMoveDown} onSelect={run(onMoveDown)} />
      {onDelete && <><MenuSeparator /><MenuItem icon={Trash2} label="Delete section" danger onSelect={run(onDelete)} /></>}
    </Menu>
  </>;
}

function FieldMenu({ label, moveTargets, onMove, onEdit, onDelete }: { label: string; moveTargets: Array<{ id: string; label: string }>; onMove(sectionId: string): void; onEdit(): void; onDelete(): void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <UiIconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label={`${label} actions`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} />
    <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label={`${label} actions`} className="w-52" align="right">
      <MenuItem icon={Pencil} label="Edit field" onSelect={() => { setOpen(false); onEdit(); }} />
      {moveTargets.length > 0 && <><MenuSeparator />{moveTargets.map(target => <MenuItem key={target.id} icon={CornerDownRight} label={`Move to ${target.label}`} onSelect={() => { setOpen(false); onMove(target.id); }} />)}</>}
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Delete field" danger onSelect={() => { setOpen(false); onDelete(); }} />
    </Menu>
  </>;
}

function IconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick(): void; children: React.ReactElement<{ className?: string }> }) {
  return <button type="button" onClick={onClick} aria-label={label} data-tooltip={label} className={`rounded p-1 text-text-disabled ${danger ? 'hover:bg-status-danger/10 hover:text-status-danger' : 'hover:bg-surface-hover/60 hover:text-text-primary'}`}>{children && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{children}</span>}</button>;
}

function templateFor(typeId: string, templates: WorldbuildEntityTemplate[]): WorldbuildEntityTemplate {
  const saved = templates.find(template => template.typeId === typeId);
  const defaults = templatableSections(typeId).map(item => ({ id: item.id, label: item.label, kind: 'native' as const }));
  if (!saved) return { typeId, displayName: '', layout: { sections: defaults, fieldSections: {} } };
  const savedSections = normalizeTemplateSections(typeId, saved.layout.sections ?? []);
  const missing = defaults.filter(section => !savedSections.some(savedSection => savedSection.id === section.id));
  return { ...saved, layout: { ...saved.layout, sections: [...savedSections, ...missing] } };
}

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import type { EntityFieldDefinition, EntityFieldType } from '../../../narrative/contracts';
import Button from '../../components/ui/Button';
import Checkbox from '../../components/ui/Checkbox';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import type { Toast, WorldbuildApi, WorldbuildEntityTemplate, WorldbuildTemplateSection } from './worldbuildTypes';
import { meta, TYPE_ORDER } from './worldbuildConfig';
import { normalizeTemplateSections, templateSections as templatableSections, VARIANT_LABELS, variantsOf } from './worldbuildSections';

const INPUT = 'wb-input w-full rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/15';

interface Props { workspaceId: string; api: WorldbuildApi; templates: WorldbuildEntityTemplate[]; showToast: Toast; onClose(): void; onSaved(template: WorldbuildEntityTemplate): void; }
type FieldDraft = { definition?: EntityFieldDefinition; sectionId: string; label: string; valueType: EntityFieldType; optionsText: string; required: boolean; aiAccess: EntityFieldDefinition['aiAccess']; aiGuidance: string };
type DeleteTarget = { kind: 'field'; field: EntityFieldDefinition } | { kind: 'section'; section: WorldbuildTemplateSection; fields: EntityFieldDefinition[] };

export default function WorldbuildTemplateManager({ workspaceId, api, templates, showToast, onClose, onSaved }: Props) {
  const [typeId, setTypeId] = useState('Characters');
  const [draft, setDraft] = useState<WorldbuildEntityTemplate>(() => templateFor('Characters', templates));
  const [fields, setFields] = useState<EntityFieldDefinition[]>([]);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [confirmingTypeChange, setConfirmingTypeChange] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [saving, setSaving] = useState(false);

  const saved = useMemo(() => templateFor(typeId, templates), [templates, typeId]);
  useEffect(() => { setDraft(saved); setFieldDraft(null); }, [saved]);
  useEffect(() => { api.listWorldbuildFieldDefinitions(workspaceId, typeId).then(result => setFields(result.fields || [])).catch(() => setFields([])); }, [api, typeId, workspaceId]);
  const sections = draft.layout.sections ?? [];
  // Section renames, order and visibility live in the draft until saved. Field edits
  // persist immediately, so they carry the draft with them: a field's section lives in
  // the template, and leaving it unsaved used to strand the field outside its section.
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const variants = variantsOf(typeId);
  const variantOf = (section: WorldbuildTemplateSection) => templatableSections(typeId).find(item => item.id === section.id)?.variant;

  const updateSections = (next: WorldbuildTemplateSection[]) => setDraft(current => ({ ...current, layout: { ...current.layout, sections: next } }));
  const updateSection = (id: string, patch: Partial<WorldbuildTemplateSection>) => updateSections(sections.map(section => section.id === id ? { ...section, ...patch } : section));
  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    updateSections(next);
  };
  const startField = (sectionId: string, definition?: EntityFieldDefinition) => setFieldDraft({
    definition, sectionId,
    label: definition?.label ?? '',
    valueType: definition?.valueType ?? 'short-text',
    optionsText: definition?.options?.map(option => option.label).join('\n') ?? '',
    required: definition?.required ?? false,
    aiAccess: definition?.aiAccess ?? 'read-write',
    aiGuidance: definition?.aiGuidance ?? '',
  });

  const persistTemplate = async (next: WorldbuildEntityTemplate) => {
    const result = await api.saveWorldbuildEntityTemplate({ ...next, workspaceId });
    if (!result.success || !result.template) throw new Error(result.error || 'Could not save the template.');
    onSaved(result.template);
    setDraft(templateFor(typeId, [result.template]));
    return result.template;
  };

  const saveField = async (clearValuesOnTypeChange = false) => {
    if (!fieldDraft?.label.trim()) return;
    const hasTypeChange = fieldDraft.definition && fieldDraft.definition.valueType !== fieldDraft.valueType;
    if (hasTypeChange && !clearValuesOnTypeChange) {
      setConfirmingTypeChange(true);
      return;
    }
    setSaving(true);
    try {
      const isChoice = fieldDraft.valueType === 'single-choice' || fieldDraft.valueType === 'multiple-choice';
      const result = await api.saveWorldbuildFieldDefinition({
        id: fieldDraft.definition?.id, key: fieldDraft.definition?.key,
        projectId: workspaceId, typeId, label: fieldDraft.label.trim(), valueType: fieldDraft.valueType,
        options: isChoice ? fieldDraft.optionsText.split('\n').map(label => ({ id: label, label })).filter(option => option.label.trim()) : undefined,
        required: fieldDraft.required, position: fieldDraft.definition?.position ?? fields.length,
        aiAccess: fieldDraft.aiAccess, aiGuidance: fieldDraft.aiGuidance,
        clearValuesOnTypeChange,
      });
      if (!result.success || !result.field) throw new Error(result.error || 'Could not save the custom field.');
      setFields(current => [...current.filter(field => field.id !== result.field!.id), result.field!].sort((a, b) => a.position - b.position));
      await persistTemplate({
        ...draft,
        layout: { ...draft.layout, fieldSections: { ...(draft.layout.fieldSections || {}), [result.field.id]: fieldDraft.sectionId } },
      });
      showToast(fieldDraft.definition ? 'Custom field updated.' : 'Custom field added.', 'success');
      setFieldDraft(null);
      setConfirmingTypeChange(false);
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
      setDeleting(null);
      showToast(deleting.kind === 'section' ? 'Custom section deleted.' : 'Custom field deleted.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not delete the custom content.', 'error'); }
    finally { setSaving(false); }
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      await persistTemplate(draft);
      showToast('Entity template saved.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save the template.', 'error'); }
    finally { setSaving(false); }
  };

  const requestClose = () => { if (dirty) setConfirmingClose(true); else onClose(); };

  return <Modal size="2xl" title="Worldbuild entity templates" icon={LayoutTemplate} onClose={requestClose} closeOnOverlay={!saving && !dirty} closeOnEsc={!saving && !dirty}>
    <div className="grid h-[min(42rem,calc(100vh-9rem))] min-h-0 grid-cols-[13rem_minmax(0,1fr)_20rem] overflow-hidden">
      <TypeList typeId={typeId} templates={templates} onSelect={setTypeId} />
      <TemplatePreview typeId={typeId} draft={draft} fields={fields} variantOf={variantOf} variants={variants} />
      <aside className="min-h-0 overflow-y-auto border-l border-border-subtle p-4 custom-scrollbar">
        <label className="block"><span className="eyebrow mb-1 block">Display name</span><input className={INPUT} value={draft.displayName} onChange={event => setDraft(current => ({ ...current, displayName: event.target.value }))} placeholder={typeId} /></label>
        <p className="caption mt-1">Renames this type across Worldbuild.</p>
        <div className="my-4 border-t border-border-subtle" />
        <div className="mb-1 flex items-center justify-between">
          <span className="eyebrow">Data sections</span>
          <button type="button" onClick={() => updateSections([...sections, { id: `custom-${crypto.randomUUID()}`, label: 'New section', kind: 'custom' }])} aria-label="Add custom section" data-tooltip="Add a custom section" className="rounded-md p-1.5 text-text-subtle hover:bg-surface-hover/60 hover:text-accent"><Plus className="h-4 w-4" /></button>
        </div>
        <p className="caption mb-3">Rename, reorder or hide the authored part of the sheet. Inventory, connections, knowledge and occurrences are systematic tabs and stay as they are.</p>
        <div className="space-y-2">{sections.map((section, index) => {
          const sectionFields = fields.filter(field => draft.layout.fieldSections?.[field.id] === section.id);
          const variant = variantOf(section);
          return <div key={section.id} className={`rounded-control border p-2 transition-colors ${section.hidden ? 'border-border-subtle bg-surface-canvas/15 opacity-60' : 'border-border-subtle bg-surface-canvas/30'}`}>
            <div className="flex items-center gap-1">
              <input aria-label="Section name" className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm text-text-secondary outline-none focus:bg-surface-input/60 focus:text-text-primary" value={section.label} onChange={event => updateSection(section.id, { label: event.target.value })} />
              <IconButton label="Move section up" onClick={() => moveSection(index, -1)}><ChevronUp /></IconButton>
              <IconButton label="Move section down" onClick={() => moveSection(index, 1)}><ChevronDown /></IconButton>
              <IconButton label={section.hidden ? 'Show section' : 'Hide section'} onClick={() => updateSection(section.id, { hidden: !section.hidden })}>{section.hidden ? <EyeOff /> : <Eye />}</IconButton>
              <IconButton label={`Add field to ${section.label}`} onClick={() => startField(section.id)}><Plus /></IconButton>
              {section.kind === 'custom' && <IconButton label={`Delete ${section.label}`} danger onClick={() => setDeleting({ kind: 'section', section, fields: sectionFields })}><Trash2 /></IconButton>}
            </div>
            {(section.kind === 'custom' || variant || section.hidden) && <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1">
              {section.kind === 'custom' && <Tag>Custom</Tag>}
              {variant && <Tag tone="variant">{VARIANT_LABELS[variant as keyof typeof VARIANT_LABELS]} only</Tag>}
              {section.hidden && <Tag tone="muted">Hidden</Tag>}
            </div>}
            {sectionFields.length > 0 && <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">{sectionFields.map(field => <div key={field.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs text-text-muted"><span className="truncate">{field.label}</span><div className="flex items-center"><IconButton label={`Edit ${field.label}`} onClick={() => startField(section.id, field)}><Pencil /></IconButton><IconButton label={`Delete ${field.label}`} danger onClick={() => setDeleting({ kind: 'field', field })}><Trash2 /></IconButton></div></div>)}</div>}
          </div>;
        })}</div>
        {fieldDraft && <FieldEditor draft={fieldDraft} saving={saving} sectionLabel={sections.find(section => section.id === fieldDraft.sectionId)?.label ?? ''} onChange={setFieldDraft} onCancel={() => setFieldDraft(null)} onSave={() => saveField()} />}
      </aside>
    </div>
    <footer className="flex items-center justify-end gap-3 border-t border-border-subtle px-5 py-4">
      {dirty && <span className="caption mr-auto">Section changes are not saved yet.</span>}
      <Button variant="ghost" onClick={requestClose} disabled={saving}>Close</Button>
      <Button onClick={saveTemplate} loading={saving} disabled={!dirty}>Save template</Button>
    </footer>
    {deleting && <ConfirmDialog title={deleting.kind === 'section' ? 'Delete custom section' : 'Delete custom field'} message={deleting.kind === 'section' ? `Delete “${deleting.section.label}”? ${deleting.fields.length ? `Its ${deleting.fields.length} custom field${deleting.fields.length === 1 ? '' : 's'} and all stored values will also be permanently deleted.` : 'This section will be permanently removed.'}` : `Delete “${deleting.field.label}” from every ${typeId.toLowerCase()} entry? All stored values will be permanently removed.`} actions={[{ label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) }, { label: 'Delete', variant: 'danger', loading: saving, autoFocus: true, onClick: removeCustomContent }]} onClose={() => setDeleting(null)} />}
    {confirmingTypeChange && fieldDraft?.definition && <ConfirmDialog tone="warning" title="Change field type" message={`Change “${fieldDraft.definition.label}” from ${fieldDraft.definition.valueType} to ${fieldDraft.valueType}? Existing values in every ${typeId.toLowerCase()} entry will be permanently cleared.`} actions={[{ label: 'Cancel', variant: 'ghost', onClick: () => setConfirmingTypeChange(false) }, { label: 'Change type', variant: 'danger', loading: saving, autoFocus: true, onClick: () => saveField(true) }]} onClose={() => setConfirmingTypeChange(false)} />}
    {confirmingClose && <ConfirmDialog tone="warning" title="Discard section changes" message="The renames, order and visibility you changed have not been saved. Close anyway?" actions={[{ label: 'Keep editing', variant: 'ghost', onClick: () => setConfirmingClose(false) }, { label: 'Discard', variant: 'danger', autoFocus: true, onClick: onClose }]} onClose={() => setConfirmingClose(false)} />}
  </Modal>;
}

function Tag({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'variant' | 'muted' }) {
  const tones = {
    default: 'border-accent/25 bg-accent/10 text-accent',
    variant: 'border-entity-creature/25 bg-entity-creature/10 text-entity-creature',
    muted: 'border-border-subtle bg-surface-hover/40 text-text-subtle',
  };
  return <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold ${tones[tone]}`}>{children}</span>;
}

function TypeList({ typeId, templates, onSelect }: { typeId: string; templates: WorldbuildEntityTemplate[]; onSelect(typeId: string): void }) {
  return <aside className="min-h-0 overflow-y-auto border-r border-border-subtle bg-surface-canvas/30 p-3 custom-scrollbar">
    <p className="eyebrow mb-2 px-2">Entity types</p>
    <div className="space-y-1">{TYPE_ORDER.map(id => {
      const type = meta(id);
      const Icon = type.icon;
      const active = typeId === id;
      return <button key={id} type="button" onClick={() => onSelect(id)} className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm transition-colors ${active ? 'bg-accent/15 font-semibold text-accent' : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-primary'}`}>
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${type.medallion}`}><Icon className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1 truncate">{templates.find(template => template.typeId === id)?.displayName || type.label}</span>
      </button>;
    })}</div>
  </aside>;
}

function TemplatePreview({ typeId, draft, fields, variantOf, variants }: {
  typeId: string; draft: WorldbuildEntityTemplate; fields: EntityFieldDefinition[];
  variantOf(section: WorldbuildTemplateSection): string | undefined;
  variants: string[];
}) {
  const visible = (draft.layout.sections || []).filter(section => !section.hidden);
  return <main className="min-h-0 min-w-0 overflow-y-auto bg-surface-panel-muted/55 p-5 custom-scrollbar">
    <div className="mb-5">
      <p className="eyebrow text-accent/70">Data tab preview</p>
      <h2 className="mt-1 text-xl font-semibold text-text-primary">{draft.displayName || meta(typeId).label}</h2>
      {variants.length > 0 && (
        <p className="caption mt-1.5">This type has two shapes. A section marked <span className="text-entity-creature">{VARIANT_LABELS.individual} only</span> appears on that shape alone.</p>
      )}
    </div>
    <div className="space-y-3">{visible.map(section => {
      const sectionFields = fields.filter(field => draft.layout.fieldSections?.[field.id] === section.id);
      const variant = variantOf(section);
      return <div key={section.id} className="overflow-hidden rounded-card border border-border-subtle bg-surface-panel-muted/70">
        <div className="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-canvas/20 px-4 py-2.5">
          <span className="eyebrow truncate text-text-secondary">{section.label}</span>
          {variant && <Tag tone="variant">{VARIANT_LABELS[variant as keyof typeof VARIANT_LABELS]}</Tag>}
        </div>
        <div className="p-4">
          {section.kind === 'native' && <><div className="h-2.5 w-2/3 rounded bg-surface-hover/55" /><div className="mt-2 h-2.5 w-1/2 rounded bg-surface-hover/40" /></>}
          {section.kind === 'custom' && !sectionFields.length && <p className="text-xs italic text-text-disabled">Empty custom section</p>}
          {sectionFields.map(field => <div key={field.id} className="mt-3 first:mt-0"><p className="eyebrow">{field.label}</p><div className="mt-1 h-7 rounded-md border border-border-subtle bg-surface-canvas/30" /></div>)}
        </div>
      </div>;
    })}
    {!visible.length && <p className="rounded-card border border-dashed border-border-subtle px-4 py-6 text-center text-xs text-text-disabled">Every section is hidden.</p>}
    </div>
  </main>;
}

function FieldEditor({ draft, saving, sectionLabel, onChange, onCancel, onSave }: { draft: FieldDraft; saving: boolean; sectionLabel: string; onChange(draft: FieldDraft): void; onCancel(): void; onSave(): void }) {
  const update = (patch: Partial<FieldDraft>) => onChange({ ...draft, ...patch });
  const isChoice = draft.valueType === 'single-choice' || draft.valueType === 'multiple-choice';
  return <div className="mt-3 space-y-2 rounded-control border border-accent/20 bg-accent/[0.04] p-3">
    <p className="eyebrow text-accent/80">{draft.definition ? 'Edit field' : 'New field'}{sectionLabel ? ` · ${sectionLabel}` : ''}</p>
    <input aria-label="Field name" className={INPUT} value={draft.label} onChange={event => update({ label: event.target.value })} placeholder="Field name…" autoFocus />
    <select aria-label="Field type" className={INPUT} value={draft.valueType} onChange={event => update({ valueType: event.target.value as EntityFieldType, optionsText: '' })}><option value="short-text">Short text</option><option value="long-text">Long text</option><option value="number">Number</option><option value="range">Number range</option><option value="boolean">Yes / No</option><option value="single-choice">Single choice</option><option value="multiple-choice">Multiple choice</option><option value="entity-reference">Entity reference</option><option value="entity-reference-list">Entity reference list</option></select>
    {isChoice && <textarea aria-label="Available options" className={`${INPUT} min-h-20 resize-y`} value={draft.optionsText} onChange={event => update({ optionsText: event.target.value })} placeholder="One option per line…" />}
    <select aria-label="AI access" className={INPUT} value={draft.aiAccess} onChange={event => update({ aiAccess: event.target.value as FieldDraft['aiAccess'] })}><option value="read-write">AI can read and propose edits</option><option value="read-only">AI can read only</option><option value="hidden">Hidden from AI</option></select>
    {draft.aiAccess !== 'hidden' && <label className="block"><span className="eyebrow mb-1 block">AI guidance</span><textarea className={`${INPUT} min-h-20 resize-y`} value={draft.aiGuidance} onChange={event => update({ aiGuidance: event.target.value })} placeholder="Explain how the AI should interpret or review this field…" /><span className="caption mt-1 block">Optional. Describe the field's purpose and what the AI should not infer.</span></label>}
    <div className="flex items-center gap-2.5 rounded-control border border-border-subtle px-3 py-2.5"><Checkbox checked={draft.required} onChange={required => update({ required })} ariaLabel="Required field" /><span className="text-xs text-text-secondary">Required field</span></div>
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button><Button size="sm" onClick={onSave} disabled={!draft.label.trim()} loading={saving}>{draft.definition ? 'Save field' : 'Add field'}</Button></div>
  </div>;
}

function IconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick(): void; children: React.ReactElement<{ className?: string }> }) {
  return <button type="button" onClick={onClick} aria-label={label} data-tooltip={label} className={`rounded p-1 text-text-disabled ${danger ? 'hover:bg-status-danger/10 hover:text-status-danger' : 'hover:bg-surface-hover/60 hover:text-accent'}`}>{children && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{children}</span>}</button>;
}

function templateFor(typeId: string, templates: WorldbuildEntityTemplate[]): WorldbuildEntityTemplate {
  const saved = templates.find(template => template.typeId === typeId);
  const defaults = templatableSections(typeId).map(item => ({ id: item.id, label: item.label, kind: 'native' as const }));
  if (!saved) return { typeId, displayName: '', layout: { sections: defaults, fieldSections: {} } };
  const savedSections = normalizeTemplateSections(typeId, saved.layout.sections ?? []);
  const missing = defaults.filter(section => !savedSections.some(savedSection => savedSection.id === section.id));
  return { ...saved, layout: { ...saved.layout, sections: [...savedSections, ...missing] } };
}

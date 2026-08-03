import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import type { EntityFieldDefinition, EntityFieldType } from '../../../kanora/contracts';
import Button from '../../components/ui/Button';
import Checkbox from '../../components/ui/Checkbox';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import type { Toast, WorldbuildApi, WorldbuildEntityTemplate, WorldbuildTemplateSection } from './worldbuildTypes';

const INPUT = 'wb-input w-full rounded-lg border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/15';
const TYPE_IDS = ['System', 'Locations', 'Items', 'Races', 'Factions', 'Characters', 'Creatures', 'Events'];
const NATIVE_SECTIONS: Record<string, Array<[string, string]>> = {
  System: [['content', 'Content']],
  Locations: [['overview', 'Overview'], ['lore', 'Lore']],
  Items: [['details', 'Details'], ['lore', 'Lore']],
  Races: [['desc', 'Description'], ['lore', 'Lore'], ['members', 'Known members']],
  Factions: [['overview', 'Overview'], ['desc', 'Description'], ['lore', 'Lore'], ['members', 'Members']],
  Characters: [['identity', 'Identity'], ['appearance', 'Appearance'], ['personality', 'Personality'], ['lore', 'Lore']],
  Creatures: [['overview', 'Overview'], ['appearance', 'Appearance'], ['personality', 'Personality'], ['lore', 'Lore']],
  Events: [['overview', 'Overview'], ['desc', 'Description'], ['lore', 'Lore']],
};

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
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(templateFor(typeId, templates)); setFieldDraft(null); }, [templates, typeId]);
  useEffect(() => { api.listWorldbuildFieldDefinitions(workspaceId, typeId).then(result => setFields(result.fields || [])).catch(() => setFields([])); }, [api, typeId, workspaceId]);
  const sections = draft.layout.sections ?? [];

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
      setDraft(current => ({ ...current, layout: { ...current.layout, fieldSections: { ...(current.layout.fieldSections || {}), [result.field!.id]: fieldDraft.sectionId } } }));
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
      const nextDraft = { ...draft, layout: { ...draft.layout, sections: nextSections, fieldSections } };
      if (deleting.kind === 'section') {
        const result = await api.saveWorldbuildEntityTemplate({ ...nextDraft, workspaceId });
        if (!result.success || !result.template) throw new Error(result.error || 'Could not delete the custom section.');
        onSaved(result.template);
      }
      setFields(current => current.filter(field => !deletedIds.has(field.id)));
      setDraft(nextDraft);
      setDeleting(null);
      showToast(deleting.kind === 'section' ? 'Custom section deleted.' : 'Custom field deleted.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not delete the custom content.', 'error'); }
    finally { setSaving(false); }
  };

  const saveTemplate = async () => {
    setSaving(true);
    try {
      const result = await api.saveWorldbuildEntityTemplate({ ...draft, workspaceId });
      if (!result.success || !result.template) throw new Error(result.error || 'Could not save the template.');
      onSaved(result.template);
      showToast('Entity template saved.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save the template.', 'error'); }
    finally { setSaving(false); }
  };

  return <Modal size="2xl" title="Worldbuild entity templates" icon={LayoutTemplate} onClose={onClose} closeOnOverlay={!saving} closeOnEsc={!saving}>
    <div className="grid h-[min(42rem,calc(100vh-9rem))] min-h-0 grid-cols-[12rem_minmax(0,1fr)_19rem] overflow-hidden">
      <TypeList typeId={typeId} templates={templates} onSelect={setTypeId} />
      <TemplatePreview typeId={typeId} draft={draft} fields={fields} />
      <aside className="min-h-0 overflow-y-auto border-l border-white/10 p-4 custom-scrollbar">
        <label className="block"><span className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-500">Display name</span><input className={INPUT} value={draft.displayName} onChange={event => setDraft(current => ({ ...current, displayName: event.target.value }))} placeholder={typeId} /></label>
        <div className="my-4 border-t border-white/10" />
        <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-gray-500">Data sections</span><button type="button" onClick={() => updateSections([...sections, { id: `custom-${crypto.randomUUID()}`, label: 'New section', kind: 'custom' }])} aria-label="Add custom section" className="rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-accent"><Plus className="h-4 w-4" /></button></div>
        <div className="space-y-2">{sections.map((section, index) => {
          const sectionFields = fields.filter(field => draft.layout.fieldSections?.[field.id] === section.id);
          return <div key={section.id} className="rounded-lg border border-white/[0.08] bg-black/10 p-2">
            <div className="flex items-center gap-1">
              <input aria-label="Section name" className="min-w-0 flex-1 bg-transparent px-1 text-sm text-gray-200 outline-none" value={section.label} onChange={event => updateSection(section.id, { label: event.target.value })} />
              <IconButton label="Move section up" onClick={() => moveSection(index, -1)}><ChevronUp /></IconButton>
              <IconButton label="Move section down" onClick={() => moveSection(index, 1)}><ChevronDown /></IconButton>
              <IconButton label={section.hidden ? 'Show section' : 'Hide section'} onClick={() => updateSection(section.id, { hidden: !section.hidden })}>{section.hidden ? <EyeOff /> : <Eye />}</IconButton>
              <IconButton label={`Add field to ${section.label}`} onClick={() => startField(section.id)}><Plus /></IconButton>
              {section.kind === 'custom' && <IconButton label={`Delete ${section.label}`} danger onClick={() => setDeleting({ kind: 'section', section, fields: sectionFields })}><Trash2 /></IconButton>}
            </div>
            <p className="mt-1 px-1 text-xs text-gray-600">{section.kind === 'native' ? 'Built-in, always preserved' : 'Custom section'}</p>
            {sectionFields.length > 0 && <div className="mt-2 space-y-1 border-t border-white/[0.06] pt-2">{sectionFields.map(field => <div key={field.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-xs text-gray-400"><span className="truncate">{field.label}</span><div className="flex items-center"><IconButton label={`Edit ${field.label}`} onClick={() => startField(section.id, field)}><Pencil /></IconButton><IconButton label={`Delete ${field.label}`} danger onClick={() => setDeleting({ kind: 'field', field })}><Trash2 /></IconButton></div></div>)}</div>}
          </div>;
        })}</div>
        {fieldDraft && <FieldEditor draft={fieldDraft} saving={saving} onChange={setFieldDraft} onCancel={() => setFieldDraft(null)} onSave={() => saveField()} />}
      </aside>
    </div>
    <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4"><Button variant="ghost" onClick={onClose} disabled={saving}>Close</Button><Button onClick={saveTemplate} loading={saving}>Save template</Button></footer>
    {deleting && <ConfirmDialog title={deleting.kind === 'section' ? 'Delete custom section' : 'Delete custom field'} message={deleting.kind === 'section' ? `Delete “${deleting.section.label}”? ${deleting.fields.length ? `Its ${deleting.fields.length} custom field${deleting.fields.length === 1 ? '' : 's'} and all stored values will also be permanently deleted.` : 'This section will be permanently removed.'}` : `Delete “${deleting.field.label}” from every ${typeId.toLowerCase()} entry? All stored values will be permanently removed.`} actions={[{ label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) }, { label: 'Delete', variant: 'danger', loading: saving, autoFocus: true, onClick: removeCustomContent }]} onClose={() => setDeleting(null)} />}
    {confirmingTypeChange && fieldDraft?.definition && <ConfirmDialog tone="warning" title="Change field type" message={`Change “${fieldDraft.definition.label}” from ${fieldDraft.definition.valueType} to ${fieldDraft.valueType}? Existing values in every ${typeId.toLowerCase()} entry will be permanently cleared.`} actions={[{ label: 'Cancel', variant: 'ghost', onClick: () => setConfirmingTypeChange(false) }, { label: 'Change type', variant: 'danger', loading: saving, autoFocus: true, onClick: () => saveField(true) }]} onClose={() => setConfirmingTypeChange(false)} />}
  </Modal>;
}

function TypeList({ typeId, templates, onSelect }: { typeId: string; templates: WorldbuildEntityTemplate[]; onSelect(typeId: string): void }) {
  return <aside className="min-h-0 overflow-y-auto border-r border-white/10 bg-black/10 p-3 custom-scrollbar"><p className="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-gray-500">Entity types</p><div className="space-y-1">{TYPE_IDS.map(id => <button key={id} type="button" onClick={() => onSelect(id)} className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${typeId === id ? 'bg-accent/15 font-semibold text-accent' : 'text-gray-400 hover:bg-white/5 hover:text-gray-100'}`}>{templates.find(template => template.typeId === id)?.displayName || id}</button>)}</div></aside>;
}

function TemplatePreview({ typeId, draft, fields }: { typeId: string; draft: WorldbuildEntityTemplate; fields: EntityFieldDefinition[] }) {
  return <main className="min-h-0 min-w-0 overflow-y-auto bg-[#07151d]/55 p-5 custom-scrollbar"><div className="mb-5"><p className="text-xs font-bold uppercase tracking-wider text-accent/70">Data page preview</p><h2 className="mt-1 text-xl font-semibold text-gray-100">{draft.displayName || typeId}</h2></div><div className="space-y-3">{(draft.layout.sections || []).filter(section => !section.hidden).map(section => { const sectionFields = fields.filter(field => draft.layout.fieldSections?.[field.id] === section.id); return <div key={section.id} className="overflow-hidden rounded-xl border border-white/10 bg-[#0a1721]/70"><div className="border-b border-white/[0.07] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-300">{section.label}</div><div className="p-4">{section.kind === 'native' && <><div className="h-2.5 w-2/3 rounded bg-white/[0.06]" /><div className="mt-2 h-2.5 w-1/2 rounded bg-white/[0.04]" /></>}{section.kind === 'custom' && !sectionFields.length && <p className="text-xs italic text-gray-600">Empty custom section</p>}{sectionFields.map(field => <div key={field.id} className="mt-3 first:mt-0"><p className="text-xs font-bold uppercase tracking-wider text-gray-500">{field.label}</p><div className="mt-1 h-7 rounded-md border border-white/[0.07] bg-black/10" /></div>)}</div></div>; })}</div></main>;
}

function FieldEditor({ draft, saving, onChange, onCancel, onSave }: { draft: FieldDraft; saving: boolean; onChange(draft: FieldDraft): void; onCancel(): void; onSave(): void }) {
  const update = (patch: Partial<FieldDraft>) => onChange({ ...draft, ...patch });
  const isChoice = draft.valueType === 'single-choice' || draft.valueType === 'multiple-choice';
  return <div className="mt-3 space-y-2 rounded-lg border border-accent/20 bg-accent/[0.04] p-3">
    <input aria-label="Field name" className={INPUT} value={draft.label} onChange={event => update({ label: event.target.value })} placeholder="Field name…" autoFocus />
    <select aria-label="Field type" className={INPUT} value={draft.valueType} onChange={event => update({ valueType: event.target.value as EntityFieldType, optionsText: '' })}><option value="short-text">Short text</option><option value="long-text">Long text</option><option value="number">Number</option><option value="range">Number range</option><option value="boolean">Yes / No</option><option value="single-choice">Single choice</option><option value="multiple-choice">Multiple choice</option><option value="entity-reference">Entity reference</option><option value="entity-reference-list">Entity reference list</option></select>
    {isChoice && <textarea aria-label="Available options" className={`${INPUT} min-h-20 resize-y`} value={draft.optionsText} onChange={event => update({ optionsText: event.target.value })} placeholder="One option per line…" />}
    <select aria-label="AI access" className={INPUT} value={draft.aiAccess} onChange={event => update({ aiAccess: event.target.value as FieldDraft['aiAccess'] })}><option value="read-write">AI can read and propose edits</option><option value="read-only">AI can read only</option><option value="hidden">Hidden from AI</option></select>
    {draft.aiAccess !== 'hidden' && <label className="block"><span className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-500">AI guidance</span><textarea className={`${INPUT} min-h-20 resize-y`} value={draft.aiGuidance} onChange={event => update({ aiGuidance: event.target.value })} placeholder="Explain how the AI should interpret or review this field…" /><span className="mt-1 block text-xs leading-relaxed text-gray-600">Optional. Describe the field's purpose and what the AI should not infer.</span></label>}
    <div className="flex items-center gap-2.5 rounded-lg border border-white/10 px-3 py-2.5"><Checkbox checked={draft.required} onChange={required => update({ required })} ariaLabel="Required field" /><span className="text-xs text-gray-300">Required field</span></div>
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button><Button size="sm" onClick={onSave} disabled={!draft.label.trim()} loading={saving}>{draft.definition ? 'Save field' : 'Add field'}</Button></div>
  </div>;
}

function IconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick(): void; children: React.ReactElement<{ className?: string }> }) {
  return <button type="button" onClick={onClick} aria-label={label} className={`rounded p-1 text-gray-600 ${danger ? 'hover:bg-red-500/10 hover:text-red-400' : 'hover:bg-white/5 hover:text-accent'}`}>{children && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{children}</span>}</button>;
}

function templateFor(typeId: string, templates: WorldbuildEntityTemplate[]): WorldbuildEntityTemplate {
  const saved = templates.find(template => template.typeId === typeId);
  const defaults = (NATIVE_SECTIONS[typeId] ?? []).map(([id, label]) => ({ id, label, kind: 'native' as const }));
  if (!saved) return { typeId, displayName: '', layout: { sections: defaults, fieldSections: {} } };
  const allowedNativeIds = new Set(defaults.map(section => section.id));
  const savedSections = (saved.layout.sections ?? []).filter(section => section.kind === 'custom' || allowedNativeIds.has(section.id));
  const missing = defaults.filter(section => !savedSections.some(savedSection => savedSection.id === section.id));
  return { ...saved, layout: { ...saved.layout, sections: [...savedSections, ...missing] } };
}

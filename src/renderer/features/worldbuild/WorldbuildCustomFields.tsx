import { useEffect, useMemo, useState } from 'react';
import { Braces, Check, Pencil } from 'lucide-react';
import type { EntityFieldDefinition, EntityFieldType } from '../../../kanora/contracts';
import Button from '../../components/ui/Button';
import SearchableSelect from '../../components/ui/SearchableSelect';
import type { Toast, WorldbuildApi, WorldbuildEntity, WorldbuildEntityTemplate } from './worldbuildTypes';

const INPUT = 'wb-input min-h-10 w-full rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';

interface Props {
  workspaceId: string;
  entity: WorldbuildEntity;
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
  onEntityChange(entity: WorldbuildEntity): void;
  /** Receives the whole customFields map while the entity is still an unsaved draft. */
  onDraftChange?(customFields: Record<string, unknown>): void;
  /** Field definitions for this entity type, loaded once by the sheet. */
  definitions?: EntityFieldDefinition[];
  template?: WorldbuildEntityTemplate;
  sectionId?: string;
  embedded?: boolean;
}

export default function WorldbuildCustomFields({ workspaceId, entity, entities, api, showToast, onEntityChange, onDraftChange, definitions: providedDefinitions, template, sectionId, embedded = false }: Props) {
  // A sheet renders one of these per section. Reading the definitions the sheet already
  // has keeps that to a single load instead of one request per section.
  const [loadedDefinitions, setLoadedDefinitions] = useState<EntityFieldDefinition[]>([]);
  const definitions = providedDefinitions ?? loadedDefinitions;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<unknown>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (providedDefinitions) return;
    let active = true;
    api.listWorldbuildFieldDefinitions(workspaceId, entity.type).then(result => {
      if (!active) return;
      if (result.success) setLoadedDefinitions(result.fields ?? []);
      else showToast(`Could not load custom fields: ${result.error || 'unknown error'}`, 'error');
    });
    return () => { active = false; };
  }, [api, entity.type, providedDefinitions, showToast, workspaceId]);

  // An unsaved draft has nothing to write to yet, so its fields stay open and feed the
  // pending entity; they are persisted by the first save together with the native ones.
  const isDraft = !entity.id;
  const values = entity.data.customFields ?? {};
  const visibleSections = (template?.layout.sections ?? []).filter(section => !section.hidden);
  const groups = visibleSections.filter(section => !sectionId || section.id === sectionId).map(section => ({
    id: section.id,
    label: section.label,
    definitions: definitions.filter(definition => template?.layout.fieldSections?.[definition.id] === section.id),
  }));
  const assigned = new Set(groups.flatMap(group => group.definitions.map(definition => definition.id)));
  const unassigned = definitions.filter(definition => !assigned.has(definition.id));
  if (unassigned.length && (!sectionId || sectionId === 'custom-fields')) groups.push({ id: 'custom-fields', label: 'Custom fields', definitions: unassigned });

  const startEdit = (definition: EntityFieldDefinition) => {
    setEditingId(definition.id);
    setDraftValue(values[definition.key] ?? definition.defaultValue ?? emptyValue(definition.valueType));
  };
  const cancelEdit = () => { setEditingId(null); setDraftValue(''); };
  const saveValue = async (definition: EntityFieldDefinition) => {
    setSaving(true);
    try {
      const customFields = { ...values, [definition.key]: normalizeValue(draftValue, definition) };
      const result = await api.updateEntity(entity.id, { data: { ...entity.data, customFields } });
      if (!result.success || !result.entity) throw new Error(result.error || 'Could not save the field value.');
      onEntityChange(result.entity);
      cancelEdit();
      showToast('Custom field value saved.', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not save the custom field value.', 'error'); }
    finally { setSaving(false); }
  };

  if (!definitions.length) return null;
  return <>{groups.filter(group => group.definitions.length).map(group => {
    const content = <div className={embedded ? 'mt-4 space-y-2 border-t border-border-subtle pt-4' : 'space-y-2 p-4'}>{group.definitions.map(definition => {
      const isEditing = editingId === definition.id;
      const header = <div className="mb-1 flex items-center gap-2"><span className="eyebrow">{definition.label}</span>{definition.required && <span className="text-xs text-status-warning/80">Required</span>}</div>;
      if (isDraft) return <div key={definition.id} className="rounded-control border border-border-subtle bg-surface-canvas/30 px-3.5 py-3">
        {header}
        <FieldInput
          definition={definition}
          value={values[definition.key] ?? definition.defaultValue ?? emptyValue(definition.valueType)}
          onChange={value => onDraftChange?.({ ...values, [definition.key]: normalizeValue(value, definition) })}
          entities={entities}
        />
      </div>;
      return <div key={definition.id} className="group rounded-control border border-border-subtle bg-surface-canvas/30 px-3.5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {header}
            {isEditing
              ? <FieldInput definition={definition} value={draftValue} onChange={setDraftValue} entities={entities} />
              : <FieldValue definition={definition} value={values[definition.key] ?? definition.defaultValue} entities={entities} />}
          </div>
          {!isEditing && <button type="button" onClick={() => startEdit(definition)} aria-label={`Edit ${definition.label} value`} data-tooltip="Edit value" className="shrink-0 rounded-md p-1.5 text-text-subtle opacity-70 transition-colors hover:bg-surface-hover/60 hover:text-accent group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>}
        </div>
        {isEditing && <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>Cancel</Button><Button size="sm" icon={Check} onClick={() => saveValue(definition)} loading={saving}>Save</Button></div>}
      </div>;
    })}</div>;
    if (embedded) return <div key={group.id}>{content}</div>;
    return <section key={group.id} className="overflow-hidden rounded-card border border-border-subtle bg-surface-panel-muted/60 backdrop-blur-md"><header className="flex items-center border-b border-border-subtle bg-surface-canvas/20 px-4 py-2.5"><div className="flex min-w-0 items-center gap-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent/10 text-accent"><Braces className="h-3.5 w-3.5" /></span><span className="eyebrow truncate text-text-secondary">{group.label}</span></div></header>{content}</section>;
  })}</>;
}

function FieldInput({ definition, value, onChange, entities }: { definition: EntityFieldDefinition; value: unknown; onChange(value: unknown): void; entities: WorldbuildEntity[] }) {
  const options = definition.options ?? [];
  const type = definition.valueType;
  if (type === 'boolean') return <select className={INPUT} value={String(Boolean(value))} onChange={event => onChange(event.target.value === 'true')}><option value="false">No</option><option value="true">Yes</option></select>;
  if (type === 'single-choice') return <SearchableSelect value={String(value ?? '')} onChange={onChange} options={options.map(option => ({ id: option.id, label: option.label }))} placeholder="Not set" searchPlaceholder="Filter optionsâ€¦" />;
  if (type === 'multiple-choice') {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return <SearchableSelect multiple values={selected} onChange={onChange} options={options.map(option => ({ id: option.id, label: option.label }))} placeholder="Search and add options" searchPlaceholder="Filter optionsâ€¦" />;
  }
  if (type === 'entity-reference' || type === 'entity-reference-list') {
    const multiple = type === 'entity-reference-list';
    const entityOptions = entities.filter(entity => entity.status !== 'proposed').map(entity => ({
      id: entity.id,
      label: entity.canonicalName,
      aliases: entity.aliases,
      group: entity.type.replace(/s$/, ''),
    }));
    if (multiple) {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return <SearchableSelect multiple values={selected} onChange={onChange} options={entityOptions} placeholder="Search and add entities" />;
    }
    return <SearchableSelect value={String(value ?? '')} onChange={onChange} options={entityOptions} placeholder="Search for an entity" />;
  }
  if (type === 'long-text') return <textarea className={`${INPUT} min-h-24 resize-y`} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />;
  if (type === 'number' || type === 'range') return <input className={INPUT} type="number" value={String(value ?? '')} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />;
  return <input className={INPUT} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />;
}

function FieldValue({ definition, value, entities }: { definition: EntityFieldDefinition; value: unknown; entities: WorldbuildEntity[] }) {
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);
  const optionNames = useMemo(() => new Map(definition.options?.map(option => [option.id, option.label]) ?? []), [definition.options]);
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return <p className="text-sm italic text-text-disabled">Not set</p>;
  if (definition.valueType === 'boolean') return <p className="text-sm text-text-secondary">{value ? 'Yes' : 'No'}</p>;
  if (definition.valueType === 'entity-reference') return <p className="text-sm text-text-secondary">{names.get(String(value)) ?? 'Unknown entity'}</p>;
  if (definition.valueType === 'entity-reference-list') return <p className="text-sm text-text-secondary">{(value as string[]).map(id => names.get(id) ?? 'Unknown entity').join(', ')}</p>;
  if (Array.isArray(value)) return <div className="flex flex-wrap gap-1.5">{value.map(item => <span key={String(item)} className="rounded-full border border-border-subtle bg-surface-hover/45 px-2.5 py-0.5 text-xs text-text-secondary">{optionNames.get(String(item)) ?? String(item)}</span>)}</div>;
  if (definition.valueType === 'single-choice') return <p className="text-sm text-text-secondary">{optionNames.get(String(value)) ?? String(value)}</p>;
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{String(value)}</p>;
}

function emptyValue(type: EntityFieldType): unknown {
  if (type === 'boolean') return false;
  if (type === 'multiple-choice' || type === 'entity-reference-list') return [];
  return '';
}

function normalizeValue(value: unknown, definition: EntityFieldDefinition): unknown {
  const { valueType: type, options = [] } = definition;
  if (type === 'number' || type === 'range') return value === '' ? null : Number(value);
  if (type === 'boolean') return Boolean(value);
  if (type === 'single-choice') return options.find(option => option.id === value || option.label === value)?.id ?? '';
  if (type === 'multiple-choice') return Array.isArray(value) ? value.map(item => options.find(option => option.id === item || option.label === item)?.id).filter(Boolean) : [];
  if (type === 'entity-reference-list') return Array.isArray(value) ? value : [];
  return value ?? '';
}

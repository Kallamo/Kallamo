import { useEffect, useMemo, useState } from 'react';
import { Braces, Check, Pencil } from 'lucide-react';
import type { EntityFieldDefinition, EntityFieldType } from '../../../kanora/contracts';
import Button from '../../components/ui/Button';
import SearchableSelect from '../../components/ui/SearchableSelect';
import type { Toast, WorldbuildApi, WorldbuildEntity, WorldbuildEntityTemplate } from './worldbuildTypes';

const INPUT = 'wb-input min-h-10 w-full rounded-lg border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';

interface Props {
  workspaceId: string;
  entity: WorldbuildEntity;
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
  onEntityChange(entity: WorldbuildEntity): void;
  template?: WorldbuildEntityTemplate;
  sectionId?: string;
  embedded?: boolean;
}

export default function WorldbuildCustomFields({ workspaceId, entity, entities, api, showToast, onEntityChange, template, sectionId, embedded = false }: Props) {
  const [definitions, setDefinitions] = useState<EntityFieldDefinition[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<unknown>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.listWorldbuildFieldDefinitions(workspaceId, entity.type).then(result => {
      if (!active) return;
      if (result.success) setDefinitions(result.fields ?? []);
      else showToast(`Could not load custom fields: ${result.error || 'unknown error'}`, 'error');
    });
    return () => { active = false; };
  }, [api, entity.type, showToast, workspaceId]);

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
    const content = <div className={embedded ? 'mt-4 space-y-2 border-t border-white/[0.07] pt-4' : 'space-y-2 p-4'}>{group.definitions.map(definition => {
      const isEditing = editingId === definition.id;
      return <div key={definition.id} className="group rounded-lg border border-white/[0.07] bg-black/10 px-3.5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2"><span className="text-xs font-bold uppercase tracking-wider text-gray-500">{definition.label}</span>{definition.required && <span className="text-xs text-amber-300/80">Required</span>}</div>
            {isEditing
              ? <FieldInput definition={definition} value={draftValue} onChange={setDraftValue} entities={entities} />
              : <FieldValue definition={definition} value={values[definition.key] ?? definition.defaultValue} entities={entities} />}
          </div>
          {!isEditing && <button type="button" onClick={() => startEdit(definition)} aria-label={`Edit ${definition.label} value`} data-tooltip="Edit value" className="shrink-0 rounded-md p-1.5 text-gray-500 opacity-70 transition-colors hover:bg-white/5 hover:text-accent group-hover:opacity-100"><Pencil className="h-3.5 w-3.5" /></button>}
        </div>
        {isEditing && <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={cancelEdit} disabled={saving}>Cancel</Button><Button size="sm" icon={Check} onClick={() => saveValue(definition)} loading={saving}>Save</Button></div>}
      </div>;
    })}</div>;
    if (embedded) return <div key={group.id}>{content}</div>;
    return <section key={group.id} className="overflow-hidden rounded-xl border border-white/10 bg-[#0a1721]/60 backdrop-blur-md"><header className="flex items-center border-b border-white/[0.08] px-4 py-2.5"><div className="flex items-center gap-2"><Braces className="h-3.5 w-3.5 text-accent" /><span className="text-xs font-bold uppercase tracking-wider text-gray-300">{group.label}</span></div></header>{content}</section>;
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
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return <p className="text-sm italic text-gray-600">Not set</p>;
  if (definition.valueType === 'boolean') return <p className="text-sm text-gray-200">{value ? 'Yes' : 'No'}</p>;
  if (definition.valueType === 'entity-reference') return <p className="text-sm text-gray-200">{names.get(String(value)) ?? 'Unknown entity'}</p>;
  if (definition.valueType === 'entity-reference-list') return <p className="text-sm text-gray-200">{(value as string[]).map(id => names.get(id) ?? 'Unknown entity').join(', ')}</p>;
  if (Array.isArray(value)) return <div className="flex flex-wrap gap-1.5">{value.map(item => <span key={String(item)} className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-xs text-gray-300">{optionNames.get(String(item)) ?? String(item)}</span>)}</div>;
  if (definition.valueType === 'single-choice') return <p className="text-sm text-gray-200">{optionNames.get(String(value)) ?? String(value)}</p>;
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">{String(value)}</p>;
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

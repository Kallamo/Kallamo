import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, EyeOff, Lock } from 'lucide-react';
import type { EntityFieldDefinition, EntityFieldType } from '../../../narrative/contracts';
import SearchableSelect from '../../components/ui/SearchableSelect';
import type { Toast, WorldbuildApi, WorldbuildEntity, WorldbuildEntityTemplate } from './worldbuildTypes';
import { TYPES } from './worldbuildConfig';
import { FieldEye, SpoilerCover, SpoilerText, SpoilerTextArea } from './Spoilers';

// A template field is hidden from readers under its own key, like a native field.
const spoilerKey = (definition: EntityFieldDefinition) => `customFields.${definition.key}`;

const INPUT = 'wb-input min-h-10 w-full rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';

// Fields that read as one line sit in the section's grid; the rest take the full width.
const LONG_TYPES = new Set<EntityFieldType>(['long-text', 'multiple-choice', 'entity-reference-list']);
const NUMERIC_TYPES = new Set<EntityFieldType>(['number', 'range']);
// Templates often write labels as "Level:"; the sheet supplies its own layout.
const labelOf = (definition: EntityFieldDefinition) => definition.label.replace(/\s*:\s*$/, '');
// A short text holding a plain number reads as one, so stat blocks stay stat blocks.
const readsAsNumber = (definition: EntityFieldDefinition, value: unknown) => NUMERIC_TYPES.has(definition.valueType)
  || (definition.valueType === 'short-text' && /^-?\d+([.,]\d+)?$/.test(String(value ?? '').trim()));

interface Props {
  workspaceId: string;
  entity: WorldbuildEntity;
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
  onEntityChange?(entity: WorldbuildEntity): void;
  /** Receives the whole customFields map while the section is being edited or the entity is a draft. */
  onDraftChange?(customFields: Record<string, unknown>): void;
  /** Field definitions for this entity type, loaded once by the sheet. */
  definitions?: EntityFieldDefinition[];
  template?: WorldbuildEntityTemplate;
  sectionId?: string;
  embedded?: boolean;
  /** The section around these fields is in edit mode; one Save stores native and template values together. */
  editing?: boolean;
  /** Only the grid cells ('short', for the section's own grid) or only the long fields that follow its text. */
  part?: 'short' | 'long';
}

/** The template fields a section holds, in the template's order. Unassigned ones belong to "custom-fields". */
export function fieldsForSection(definitions: EntityFieldDefinition[], template: WorldbuildEntityTemplate | undefined, sectionId: string) {
  const sections = new Set((template?.layout.sections ?? []).filter(section => !section.hidden).map(section => section.id));
  return definitions.filter(definition => {
    const assigned = template?.layout.fieldSections?.[definition.id];
    if (sectionId === 'custom-fields') return !assigned || !sections.has(assigned);
    return assigned === sectionId;
  });
}

export const isLongField = (definition: EntityFieldDefinition) => LONG_TYPES.has(definition.valueType);

export const isFilledValue = (value: unknown) => !(value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length));

// A template field reads exactly like a native one: the value type decides its place,
// never where the field came from.
export default function WorldbuildCustomFields({ workspaceId, entity, entities, api, showToast, onDraftChange, definitions: providedDefinitions, template, sectionId = 'custom-fields', editing = false, part }: Props) {
  // A sheet renders one of these per section. Reading the definitions the sheet already
  // has keeps that to a single load instead of one request per section.
  const [loadedDefinitions, setLoadedDefinitions] = useState<EntityFieldDefinition[]>([]);
  const definitions = providedDefinitions ?? loadedDefinitions;

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

  const values = entity.data.customFields ?? {};
  const fields = fieldsForSection(definitions, template, sectionId);
  if (!fields.length) return null;
  const valueOf = (definition: EntityFieldDefinition) => values[definition.key] ?? definition.defaultValue;
  const short = fields.filter(definition => !LONG_TYPES.has(definition.valueType));
  const long = fields.filter(definition => LONG_TYPES.has(definition.valueType));

  // An unsaved draft and a section in edit mode both feed the pending entity; the
  // section's single Save persists them together with the native fields.
  if (editing || !entity.id) {
    const input = (definition: EntityFieldDefinition) => (
      <FieldShell key={definition.id} definition={definition} editing full={LONG_TYPES.has(definition.valueType)}>
        <FieldInput
          definition={definition}
          value={valueOf(definition) ?? emptyValue(definition.valueType)}
          onChange={value => onDraftChange?.({ ...values, [definition.key]: normalizeValue(value, definition) })}
          entities={entities}
        />
      </FieldShell>
    );
    return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{short.map(input)}{long.map(input)}</div>;
  }

  const cell = (definition: EntityFieldDefinition) => (
    <FieldShell key={definition.id} definition={definition} value={valueOf(definition)}>
      <FieldValue definition={definition} value={valueOf(definition)} entities={entities} />
    </FieldShell>
  );
  // A long field sits under a rule, labelled, after whatever text the section already has.
  const longBlock = (definition: EntityFieldDefinition) => (
    <div key={definition.id} className="border-t border-border-subtle pt-4">
      <FieldShell definition={definition} value={valueOf(definition)} full>
        <FieldValue definition={definition} value={valueOf(definition)} entities={entities} />
      </FieldShell>
    </div>
  );
  if (part === 'short') return short.length ? <>{short.map(cell)}</> : null;
  if (part === 'long') return long.length ? <>{long.map(longBlock)}</> : null;

  // A section made only of numbers reads as attribute tiles.
  if (fields.every(definition => readsAsNumber(definition, valueOf(definition)) || (definition.valueType === 'short-text' && !isFilledValue(valueOf(definition)))) && fields.some(definition => isFilledValue(valueOf(definition)))) {
    return <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">{fields.map(definition => (
      <div key={definition.id} className="min-w-0 rounded-control border border-border-subtle bg-surface-canvas/30 px-3 py-2.5">
        <div className="truncate text-xs font-medium text-text-muted">{labelOf(definition)}</div>
        <SpoilerCover field={spoilerKey(definition)}><FieldValue definition={definition} value={valueOf(definition)} entities={entities} large /></SpoilerCover>
      </div>
    ))}</div>;
  }

  return (
    <div className="space-y-4">
      {short.length > 0 && <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">{short.map(cell)}</div>}
      {long.map((definition, index) => short.length || index > 0 ? longBlock(definition) : (
        <FieldShell key={definition.id} definition={definition} value={valueOf(definition)} full>
          <FieldValue definition={definition} value={valueOf(definition)} entities={entities} />
        </FieldShell>
      ))}
    </div>
  );
}

function FieldShell({ definition, value, editing = false, full = false, children }: { definition: EntityFieldDefinition; value?: unknown; editing?: boolean; full?: boolean; children: ReactNode }) {
  const missing = !editing && definition.required && !isFilledValue(value);
  return (
    <div className={`min-w-0 ${full ? 'col-span-full' : ''}`}>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-muted">
        <span className="truncate">{labelOf(definition)}</span>
        {editing && <FieldEye field={spoilerKey(definition)} size="sm" />}
        {missing && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning" />}
        {editing && definition.required && <span className="text-status-warning">Required</span>}
        {editing && definition.aiAccess === 'read-only' && <span data-tooltip="The AI reads it but never changes it" className="inline-flex text-text-subtle"><Lock className="h-3 w-3" aria-label="Read only for the AI" /></span>}
        {editing && definition.aiAccess === 'hidden' && <span data-tooltip="Hidden from the AI" className="inline-flex text-text-subtle"><EyeOff className="h-3 w-3" aria-label="Hidden from the AI" /></span>}
      </div>
      {missing ? <p className="inline-flex items-center gap-1.5 text-sm text-status-warning"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />Needs a value</p> : <SpoilerCover field={spoilerKey(definition)}>{children}</SpoilerCover>}
    </div>
  );
}

function FieldInput({ definition, value, onChange, entities }: { definition: EntityFieldDefinition; value: unknown; onChange(value: unknown): void; entities: WorldbuildEntity[] }) {
  const options = definition.options ?? [];
  const type = definition.valueType;
  if (type === 'boolean') {
    return (
      <div role="radiogroup" aria-label={definition.label} className="inline-flex gap-1 rounded-control border border-border-default bg-surface-input p-1">
        {[false, true].map(option => (
          <button key={String(option)} type="button" role="radio" aria-checked={Boolean(value) === option} onClick={() => onChange(option)}
            className={`min-h-8 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${Boolean(value) === option ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : 'text-text-muted hover:text-text-primary'}`}>
            {option ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    );
  }
  if (type === 'single-choice') return <SearchableSelect value={String(value ?? '')} onChange={onChange} options={options.map(option => ({ id: option.id, label: option.label }))} placeholder="Not set" searchPlaceholder="Filter options…" />;
  if (type === 'multiple-choice') {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return <SearchableSelect multiple values={selected} onChange={onChange} options={options.map(option => ({ id: option.id, label: option.label }))} placeholder="Search and add options" searchPlaceholder="Filter options…" />;
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
  if (type === 'long-text') return <SpoilerTextArea aria-label={definition.label} rows={3} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />;
  if (type === 'range') {
    const min = definition.constraints?.min ?? 0;
    const max = definition.constraints?.max ?? 100;
    const step = definition.constraints?.step ?? 1;
    const current = value === '' || value == null ? min : Number(value);
    return (
      <div className="flex items-center gap-3">
        <input aria-label={definition.label} type="range" min={min} max={max} step={step} value={current} onChange={event => onChange(Number(event.target.value))} className="min-w-0 flex-1 accent-[var(--color-accent)]" />
        <input aria-label={`${definition.label} value`} className={`${INPUT} !w-20 text-right tabular-nums`} type="number" min={min} max={max} step={step} value={String(value ?? '')} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
      </div>
    );
  }
  if (type === 'number') return <input aria-label={definition.label} className={`${INPUT} max-w-40 tabular-nums`} type="number" value={String(value ?? '')} onChange={event => onChange(event.target.value === '' ? '' : Number(event.target.value))} />;
  return <input aria-label={definition.label} className={INPUT} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />;
}

function FieldValue({ definition, value, entities, large = false }: { definition: EntityFieldDefinition; value: unknown; entities: WorldbuildEntity[]; large?: boolean }) {
  const byId = useMemo(() => new Map(entities.map(entity => [entity.id, entity])), [entities]);
  const optionNames = useMemo(() => new Map(definition.options?.map(option => [option.id, option.label]) ?? []), [definition.options]);
  if (!isFilledValue(value)) return <p className={`${large ? 'mt-0.5 text-lg' : 'text-sm'} text-text-disabled`}>Not set</p>;
  const type = definition.valueType;
  if (type === 'boolean') return <p className="text-sm text-text-primary">{value ? 'Yes' : 'No'}</p>;
  if (type === 'number' || (large && type === 'short-text')) return <p className={`${large ? 'mt-0.5 text-xl font-semibold' : 'text-sm'} tabular-nums text-text-primary`}>{String(value)}</p>;
  if (type === 'range') {
    const min = definition.constraints?.min ?? 0;
    const max = definition.constraints?.max ?? 100;
    const share = Math.max(0, Math.min(100, ((Number(value) - min) / ((max - min) || 1)) * 100));
    if (large) return <p className="mt-0.5 text-xl font-semibold tabular-nums text-text-primary">{String(value)}<span className="text-xs font-medium text-text-subtle"> / {max}</span></p>;
    return (
      <div className="flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover"><div className="h-full rounded-full bg-text-secondary" style={{ width: `${share}%` }} /></div>
        <span className="text-sm tabular-nums text-text-primary">{String(value)}<span className="text-text-subtle"> / {max}</span></span>
      </div>
    );
  }
  if (type === 'entity-reference' || type === 'entity-reference-list') {
    const ids = (Array.isArray(value) ? value : [value]).map(String);
    return <div className="flex flex-wrap gap-1.5">{ids.map(id => {
      const entity = byId.get(id);
      const dot = entity ? (TYPES as Record<string, { dot?: string }>)[entity.type]?.dot : null;
      return <span key={id} className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border-subtle bg-surface-hover/35 px-2.5 py-0.5 text-xs font-medium text-text-secondary"><span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot || 'bg-text-subtle'}`} />{entity?.canonicalName ?? 'Unknown entity'}</span>;
    })}</div>;
  }
  if (Array.isArray(value)) return <div className="flex flex-wrap gap-1.5">{value.map(item => <span key={String(item)} className="inline-flex min-h-6 items-center rounded-full border border-border-subtle bg-surface-hover/35 px-2.5 py-0.5 text-xs font-medium text-text-secondary">{optionNames.get(String(item)) ?? String(item)}</span>)}</div>;
  if (type === 'single-choice') return <p className="text-sm text-text-primary">{optionNames.get(String(value)) ?? String(value)}</p>;
  return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary"><SpoilerText text={String(value)} /></p>;
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

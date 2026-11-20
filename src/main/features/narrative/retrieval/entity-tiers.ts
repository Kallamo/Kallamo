import type Database from 'better-sqlite3';
import { derivedAge } from '../../../../shared/world-age';
import { describeLocationChain, loadLocationChain } from '../../worldbuild/location-graph';

/** How much of an entity a context carries: a full sheet, a short card, or one line. */
export type EntityTier = 'sheet' | 'card' | 'mention';

export interface EntityRow {
  id: string;
  type: string;
  canonicalName: string;
  lore: string | null;
  data: string | null;
  status: string;
}

export interface FieldRow {
  type_id: string;
  field_key: string;
  label: string;
  ai_access: string;
  value_type?: string;
  options_json?: string | null;
  ai_guidance?: string | null;
}

interface CalendarNames { months: string[]; eras: Map<string, string> }

/** What rendering needs from the workspace, read once per context. */
export interface WorldbuildView {
  workspaceId: string;
  fields: FieldRow[];
  calendar: Record<string, unknown> | null;
  clock: Record<string, unknown> | null;
  names: CalendarNames | null;
  entity(id: string): EntityRow | undefined;
  nameOf(id: string): string | undefined;
  links(id: string): Array<{ relType: string; label: string | null; otherId: string; direction: 'from' | 'to' }>;
  locationChain(id: string): string;
}

// Keys the app keeps for itself: the sheet's interface, review state and provenance.
const HIDDEN_KEYS = new Set([
  'description', 'content', 'customFields', 'loreDocumentId', 'loreDocumentIds', 'aiPolicy', 'spoilers',
  'alwaysInContext', 'showBirthday', 'nameReviewDismissed', 'needsEnrichment', 'narrativeOrigin', 'scope',
  'ownership', 'recurrence'
]);
const DATE_KEYS = new Set(['birthDate', 'deathDate', 'missingDate', 'startDate', 'endDate', 'foundedDate']);
const NATIVE_LABELS: Record<string, string> = {
  status: 'Status', gender: 'Gender', age: 'Age', appearance: 'Appearance', personality: 'Personality',
  disposition: 'Disposition', nature: 'Nature', abundance: 'Abundance', threat: 'Threat', abilities: 'Abilities',
  locationType: 'Type', size: 'Size', itemType: 'Type', itemNature: 'Nature', kind: 'Kind', race: 'Race',
  eventNature: 'Occurs', birthDate: 'Born', deathDate: 'Died', missingDate: 'Missing since',
  startDate: 'Starts', endDate: 'Ends', foundedDate: 'Founded'
};
const LINK_LABELS: Record<string, string> = {
  member_of: 'Member of', former_member_of: 'Former member of', connected_to: 'Connected to', led_by: 'Led by',
  owned_by: 'Owned by', carried_by: 'Carried by', found_in: 'Found in', operates_in: 'Operates in', happened_at: 'Happened at',
  is_race: 'Race', created_by: 'Created by', located_in: 'Located in', sold_in: 'Sold in'
};
// The links a card keeps per type; a sheet keeps every one.
const CARD_LINKS: Record<string, string[]> = {
  Characters: ['member_of', 'connected_to'],
  Creatures: ['found_in', 'member_of'],
  Items: ['owned_by', 'carried_by'],
  Factions: ['led_by', 'operates_in'],
  Events: ['happened_at'],
  Locations: ['led_by']
};
const CARD_KEYS: Record<string, string[]> = {
  Characters: ['race', 'age', 'status'],
  Creatures: ['nature', 'threat', 'disposition', 'status'],
  Items: ['itemType', 'abundance'],
  Events: ['startDate', 'eventNature'],
  Locations: ['locationType', 'size']
};
const CARD_FIRST_SENTENCE: Record<string, string[]> = {
  Characters: ['appearance', 'personality'],
  Creatures: ['appearance', 'abilities', 'personality']
};

export function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function humanizeKey(key: string): string {
  return NATIVE_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

export function firstSentence(text: unknown, limit = 220): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.match(new RegExp(`^.{1,${limit}}?[.!?](?=\\s|$)`))?.[0] ?? flat.slice(0, limit);
}

export function formatWorldDate(value: unknown, names: CalendarNames | null): string {
  if (!value || typeof value !== 'object') return '';
  const date = value as Record<string, unknown>;
  const [year, month, day] = [date.year, date.month, date.day].map(Number);
  if (![year, month, day].every(part => Number.isInteger(part) && part >= 1)) return '';
  const monthName = names?.months[month - 1] || `month ${month}`;
  const era = names?.eras.get(String(date.eraId ?? '')) ?? '';
  return `${day} ${monthName} ${year}${era ? ` ${era}` : ''}`;
}

// A choice field stores opaque option ids; the model reads the label the user chose.
export function choiceLabels(field: FieldRow, value: unknown): unknown {
  if (field.value_type !== 'single-choice' && field.value_type !== 'multiple-choice') return value;
  let options: Array<{ id?: string; label?: string }> = [];
  try {
    const parsed: unknown = JSON.parse(field.options_json || '[]');
    if (Array.isArray(parsed)) options = parsed;
  } catch {
    return value;
  }
  const label = (id: unknown) => options.find(option => option?.id === id)?.label || id;
  return Array.isArray(value) ? value.map(label) : label(value);
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => formatValue(item)).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function valueLine(view: WorldbuildView, entity: EntityRow, data: Record<string, unknown>, key: string): string | null {
  if (key === 'age') {
    const age = derivedAge(view.calendar as never, view.clock as never, data);
    return age ? `Age: ${age}` : null;
  }
  const value = data[key];
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return null;
  if (DATE_KEYS.has(key)) {
    const date = formatWorldDate(value, view.names);
    return date ? `${humanizeKey(key)}: ${date}` : null;
  }
  return `${humanizeKey(key)}: ${formatValue(value)}`;
}

function customLines(view: WorldbuildView, entity: EntityRow, data: Record<string, unknown>): string[] {
  const custom = parseObject(data.customFields);
  return view.fields
    .filter(field => field.type_id === entity.type && field.ai_access !== 'hidden')
    .flatMap(field => {
      const value = custom[field.field_key];
      if (value === undefined || value === null || value === '') return [];
      return [`${field.label}: ${formatValue(choiceLabels(field, value))}`];
    });
}

function linkLines(view: WorldbuildView, entity: EntityRow, only?: string[]): string[] {
  const grouped = new Map<string, string[]>();
  for (const link of view.links(entity.id)) {
    if (link.direction !== 'from' || (only && !only.includes(link.relType)) || !LINK_LABELS[link.relType]) continue;
    const name = view.nameOf(link.otherId);
    if (!name) continue;
    const label = LINK_LABELS[link.relType];
    grouped.set(label, [...(grouped.get(label) ?? []), link.label ? `${name} (${link.label})` : name]);
  }
  return [...grouped].map(([label, names]) => `${label}: ${names.join(', ')}`);
}

function header(view: WorldbuildView, entity: EntityRow): string {
  const chain = entity.type === 'Locations' ? view.locationChain(entity.id) : '';
  return chain && chain !== entity.canonicalName ? `${entity.canonicalName} (${entity.type}): ${chain}` : `${entity.canonicalName} (${entity.type})`;
}

/** Everything the Worldbuild says about an entity that the AI may read. */
export function renderSheet(view: WorldbuildView, entity: EntityRow): string {
  const data = parseObject(entity.data);
  const parts = [header(view, entity)];
  const description = String(data.description ?? data.content ?? '').trim();
  if (description) parts.push(description);
  if (entity.lore?.trim()) parts.push(entity.lore.trim());
  for (const key of Object.keys(data)) {
    if (key.startsWith('_') || HIDDEN_KEYS.has(key)) continue;
    const line = valueLine(view, entity, data, key);
    if (line) parts.push(line);
  }
  parts.push(...customLines(view, entity, data), ...linkLines(view, entity));
  // A field and a link can say the same thing (a race is both); it is written once.
  return [...new Set(parts)].join('\n');
}

/** Who or what it is in a few lines: enough to voice or place it without the whole sheet. */
export function renderCard(view: WorldbuildView, entity: EntityRow): string {
  const data = parseObject(entity.data);
  const parts = [header(view, entity)];
  const sentences = CARD_FIRST_SENTENCE[entity.type];
  if (sentences) {
    for (const key of sentences) {
      const sentence = firstSentence(data[key]);
      if (sentence) parts.push(`${humanizeKey(key)}: ${sentence}`);
    }
  }
  if (!sentences || parts.length === 1) {
    const sentence = firstSentence(data.description ?? data.content ?? entity.lore);
    if (sentence) parts.push(sentence);
  }
  for (const key of CARD_KEYS[entity.type] ?? []) {
    const line = valueLine(view, entity, data, key);
    if (line) parts.push(line);
  }
  parts.push(...customLines(view, entity, data));
  parts.push(...linkLines(view, entity, CARD_LINKS[entity.type] ?? []));
  return parts.join('\n');
}

/** Name, type and the first sentence of the description. */
export function renderMention(view: WorldbuildView, entity: EntityRow): string {
  const data = parseObject(entity.data);
  const sentence = firstSentence(data.description ?? data.content ?? entity.lore ?? data.appearance, 200);
  return sentence ? `${entity.canonicalName} (${entity.type}): ${sentence}` : `${entity.canonicalName} (${entity.type})`;
}

export function renderEntity(view: WorldbuildView, entity: EntityRow, tier: EntityTier): string {
  return tier === 'sheet' ? renderSheet(view, entity) : tier === 'card' ? renderCard(view, entity) : renderMention(view, entity);
}

function readJson(db: Database.Database, table: string, sql: string, workspaceId: string): Record<string, unknown> | null {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const row = exists ? db.prepare(sql).get(workspaceId) as { json: string } | undefined : undefined;
  try { return row ? JSON.parse(row.json) : null; } catch { return null; }
}

/** Reads the workspace's entities, fields, links and calendar once, for one context. */
export function createWorldbuildView(db: Database.Database, workspaceId: string): WorldbuildView {
  const entities = new Map((db.prepare(`
    SELECT id, type, canonicalName, lore, data, status FROM entities WHERE workspaceId = ? AND status != 'proposed'
  `).all(workspaceId) as EntityRow[]).map(row => [row.id, row]));
  const fields = db.prepare(`
    SELECT type_id, field_key, label, ai_access, value_type, options_json, ai_guidance
    FROM worldbuild_field_definitions WHERE workspace_id = ?
  `).all(workspaceId) as FieldRow[];
  const calendar = readJson(db, 'worldbuild_calendars', 'SELECT definition_json AS json FROM worldbuild_calendars WHERE workspace_id = ?', workspaceId);
  const clock = readJson(db, 'roleplay_time_state', 'SELECT position_json AS json FROM roleplay_time_state WHERE workspace_id = ?', workspaceId);
  const definition = calendar as { months?: Array<{ name?: string }>; eras?: Array<{ id?: string; shortName?: string; name?: string }> } | null;
  const names = definition ? {
    months: (definition.months ?? []).map(month => String(month?.name ?? '')),
    eras: new Map((definition.eras ?? []).map(era => [String(era?.id ?? ''), String(era?.shortName || era?.name || '')]))
  } : null;
  const hasLinks = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entity_links'").get());
  const linkRows = hasLinks
    ? db.prepare('SELECT fromId, toId, relType, label FROM entity_links WHERE workspaceId = ?').all(workspaceId) as Array<{ fromId: string; toId: string; relType: string; label: string | null }>
    : [];
  const linksById = new Map<string, Array<{ relType: string; label: string | null; otherId: string; direction: 'from' | 'to' }>>();
  for (const row of linkRows) {
    linksById.set(row.fromId, [...(linksById.get(row.fromId) ?? []), { relType: row.relType, label: row.label, otherId: row.toId, direction: 'from' }]);
    linksById.set(row.toId, [...(linksById.get(row.toId) ?? []), { relType: row.relType, label: row.label, otherId: row.fromId, direction: 'to' }]);
  }
  const chains = new Map<string, string>();
  return {
    workspaceId,
    fields,
    calendar,
    clock,
    names,
    entity: id => entities.get(id),
    nameOf: id => entities.get(id)?.canonicalName,
    links: id => linksById.get(id) ?? [],
    locationChain: id => {
      if (!chains.has(id)) {
        const chain = loadLocationChain(db, workspaceId, id);
        chains.set(id, chain.length ? describeLocationChain(chain) : '');
      }
      return chains.get(id)!;
    }
  };
}

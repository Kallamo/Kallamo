// Template defaults reach an entity once, when it is created. An existing entry with the field
// empty only shows the default; it is written there only when the user asks for it.

const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const parseObject = (text) => { try { const value = JSON.parse(text || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } };

const isEmptyValue = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

/**
 * A default the field can hold, or `undefined` for none. Choices accept an option id or label, a
 * reference keeps only entities that `entityExists` knows, and anything out of shape is dropped.
 */
function normalizeDefaultValue(definition, value, entityExists = () => true) {
  if (isEmptyValue(value)) return undefined;
  const options = definition.options || [];
  const optionId = (item) => options.find(option => option.id === item || option.label === item)?.id;
  switch (definition.valueType) {
    case 'short-text':
    case 'long-text': {
      const text = String(value).trim();
      return text || undefined;
    }
    case 'number':
    case 'range': {
      const number = Number(value);
      const { min, max } = definition.constraints || {};
      if (!Number.isFinite(number) || (min !== undefined && number < min) || (max !== undefined && number > max)) return undefined;
      return number;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'single-choice':
      return optionId(value);
    case 'multiple-choice': {
      const ids = [...new Set((Array.isArray(value) ? value : [value]).map(optionId).filter(Boolean))];
      return ids.length ? ids : undefined;
    }
    case 'entity-reference':
      return typeof value === 'string' && entityExists(value) ? value : undefined;
    case 'entity-reference-list': {
      const ids = [...new Set((Array.isArray(value) ? value : [value]).filter(id => typeof id === 'string' && entityExists(id)))];
      return ids.length ? ids : undefined;
    }
    default:
      return undefined;
  }
}

/** `data` with every template default the creation did not bring. A key present, even empty, is the creator's choice. */
function withFieldDefaults(db, workspaceId, typeId, data = {}) {
  if (!workspaceId || !hasTable(db, 'worldbuild_field_definitions')) return data;
  const rows = db.prepare(`
    SELECT field_key, default_value_json FROM worldbuild_field_definitions
    WHERE workspace_id = ? AND type_id = ? AND has_default = 1
  `).all(workspaceId, typeId);
  if (!rows.length) return data;
  const customFields = { ...(data.customFields && typeof data.customFields === 'object' ? data.customFields : {}) };
  let changed = false;
  for (const row of rows) {
    if (Object.hasOwn(customFields, row.field_key)) continue;
    customFields[row.field_key] = JSON.parse(row.default_value_json);
    changed = true;
  }
  return changed ? { ...data, customFields } : data;
}

/** The race a new character starts with, when the template names one that still exists. */
function defaultRaceFor(db, workspaceId, typeId) {
  if (typeId !== 'Characters' || !workspaceId || !hasTable(db, 'worldbuild_entity_templates')) return null;
  const row = db.prepare("SELECT layout_json FROM worldbuild_entity_templates WHERE workspace_id = ? AND type_id = 'Characters'").get(workspaceId);
  const raceId = parseObject(row?.layout_json).nativeDefaults?.race;
  if (typeof raceId !== 'string' || !raceId) return null;
  const race = db.prepare("SELECT id FROM entities WHERE workspaceId = ? AND id = ? AND type = 'Races' AND status != 'proposed'").get(workspaceId, raceId);
  return race ? race.id : null;
}

module.exports = { defaultRaceFor, isEmptyValue, normalizeDefaultValue, withFieldDefaults };

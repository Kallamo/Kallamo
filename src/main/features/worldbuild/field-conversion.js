// What a stored custom field value becomes when its field changes type. A value the new type
// cannot hold comes back as not kept, so the caller can name what will be lost before saving.

const TEXT_TYPES = new Set(['short-text', 'long-text']);
const NUMBER_TYPES = new Set(['number', 'range']);
const CHOICE_TYPES = new Set(['single-choice', 'multiple-choice']);
const REFERENCE_TYPES = new Set(['entity-reference', 'entity-reference-list']);

const isEmpty = (value) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
const fold = (text) => String(text).trim().toLocaleLowerCase();
const listOf = (value) => (Array.isArray(value) ? value : [value]).filter(item => !isEmpty(item));

function optionLabels(definition, value) {
  const byId = new Map((definition.options || []).map(option => [option.id, option.label]));
  return listOf(value).map(item => byId.get(String(item)) ?? String(item));
}

function optionIdFor(definition, label) {
  const wanted = fold(label);
  return (definition.options || []).find(option => fold(option.label) === wanted || option.id === label)?.id;
}

// Read the value in its old type as plain parts, then build the new type from them.
function partsOf(value, from) {
  if (CHOICE_TYPES.has(from.valueType)) return optionLabels(from, value);
  if (from.valueType === 'boolean') return [value ? 'Yes' : 'No'];
  if (REFERENCE_TYPES.has(from.valueType)) return listOf(value).map(String);
  if (TEXT_TYPES.has(from.valueType) && CHOICE_TYPES.has(from.nextValueType)) {
    return String(value).split(/[,;\n]/).map(part => part.trim()).filter(Boolean);
  }
  return listOf(value).map(item => (typeof item === 'string' ? item.trim() : item));
}

/** `{ kept: true, value }` when the value survives in the new type, `{ kept: false }` otherwise. */
function convertFieldValue(value, from, to) {
  if (isEmpty(value)) return { kept: true, value: undefined };
  if (from.valueType === to.valueType) return { kept: true, value };
  const parts = partsOf(value, { ...from, nextValueType: to.valueType });
  const type = to.valueType;

  if (TEXT_TYPES.has(type)) {
    if (REFERENCE_TYPES.has(from.valueType)) return { kept: false };
    return { kept: true, value: parts.join(', ') };
  }
  if (NUMBER_TYPES.has(type)) {
    if (parts.length !== 1) return { kept: false };
    const number = typeof parts[0] === 'number' ? parts[0] : Number(String(parts[0]).replace(',', '.'));
    if (!Number.isFinite(number) || String(parts[0]).trim() === '') return { kept: false };
    const { min, max } = to.constraints || {};
    if ((min !== undefined && number < min) || (max !== undefined && number > max)) return { kept: false };
    return { kept: true, value: number };
  }
  if (type === 'boolean') {
    if (parts.length !== 1) return { kept: false };
    const word = fold(parts[0]);
    if (['yes', 'true', 'y', '1'].includes(word)) return { kept: true, value: true };
    if (['no', 'false', 'n', '0'].includes(word)) return { kept: true, value: false };
    return { kept: false };
  }
  if (CHOICE_TYPES.has(type)) {
    if (REFERENCE_TYPES.has(from.valueType)) return { kept: false };
    const ids = parts.map(part => optionIdFor(to, String(part)));
    if (!ids.length || ids.some(id => !id)) return { kept: false };
    if (type === 'single-choice') return ids.length === 1 ? { kept: true, value: ids[0] } : { kept: false };
    return { kept: true, value: [...new Set(ids)] };
  }
  if (REFERENCE_TYPES.has(type)) {
    if (!REFERENCE_TYPES.has(from.valueType)) return { kept: false };
    if (type === 'entity-reference') return parts.length === 1 ? { kept: true, value: parts[0] } : { kept: false };
    return { kept: true, value: parts };
  }
  return { kept: false };
}

module.exports = { convertFieldValue };

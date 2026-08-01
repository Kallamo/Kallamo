const crypto = require('node:crypto');

function filterUpdateFields(entity, fields) {
  if (entity.type === 'Creatures') {
    const isGroup = entity.data?.scope === 'group';
    return fields.filter(field => isGroup ? field !== 'status' : field !== 'abundance');
  }
  if (entity.type === 'Items') {
    const nature = entity.data?.itemNature === 'unique' ? 'unique' : 'type';
    return fields.filter(field => nature === 'unique' ? field !== 'abundance' : true);
  }
  return [...fields];
}

function filterUpdateRelations(entity, relations) {
  const itemNature = entity.data?.itemNature === 'unique' ? 'unique' : 'type';
  return relations.filter(relation => {
    if (entity.type === 'Items' && relation.itemNature && relation.itemNature !== itemNature) return false;
    if (relation.individualOnly && (entity.data?.scope || 'individual') === 'group') return false;
    return true;
  });
}

function isEmptyFieldValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function listEmptyWritableFields(entity, nativeFields) {
  return nativeFields.filter(field => isEmptyFieldValue(entity.data?.[field]));
}

function buildFieldCoverage(entity, nativeFields) {
  const emptyFields = listEmptyWritableFields(entity, nativeFields);
  const signature = crypto.createHash('sha256')
    .update(JSON.stringify({ empty: emptyFields }))
    .digest('hex')
    .slice(0, 16);
  return { emptyFields, signature };
}

function isUnsupportedNumericDelta(value, support) {
  const rawValue = String(value ?? '').trim();
  if (/^[+-]\s*\d+(?:[.,]\d+)?$/.test(rawValue)) return true;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return false;
  const explanation = String(support || '');
  const hasDelta = /(?:^|[\s:(])(?:\+|-)\s*\d+(?:[.,]\d+)?\b|(?:increase|decrease|gain|loss|raised|lowered)\s+(?:by\s+)?\d/iu.test(explanation);
  if (!hasDelta) return false;

  const escaped = String(numericValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasExplicitResult = new RegExp(`(?:->|to|becomes?|became|result(?:s|ed)?\\s+in|final value)\\s*${escaped}(?![\\d.,])`, 'iu').test(explanation);
  return !hasExplicitResult;
}

module.exports = {
  filterUpdateFields,
  filterUpdateRelations,
  buildFieldCoverage,
  isEmptyFieldValue,
  listEmptyWritableFields,
  isUnsupportedNumericDelta
};

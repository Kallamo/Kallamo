const crypto = require('node:crypto');

function filterUpdateFields(entity, fields) {
    // A group has no single life state and no single temperament; an individual has no
    // world-level prevalence, and takes its nature from its species. Each side only ever
    // receives what its sheet can show.
    const GROUP_ONLY = ['abundance', 'nature'];
    const INDIVIDUAL_ONLY = ['status', 'personality'];
    // A birth date on the world calendar is the age's source; an old document's age is a past snapshot.
    if (entity.data?.birthDate) fields = fields.filter(field => field !== 'age');
    if (entity.type === 'Creatures') {
        const isGroup = entity.data?.scope === 'group';
        const excluded = isGroup ? INDIVIDUAL_ONLY : GROUP_ONLY;
        return fields.filter(field => !excluded.includes(field));
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

function listEmptyWritableFields(entity, nativeFields, customFields) {
    const empty = nativeFields.filter(field => isEmptyFieldValue(entity.data?.[field]));
    for (const field of customFields) {
        if (isEmptyFieldValue(entity.data?.customFields?.[field.key])) {
            empty.push(`customFields.${field.key}`);
        }
    }
    return empty;
}

function buildFieldCoverage(entity, nativeFields, customFields) {
    const emptyFields = listEmptyWritableFields(entity, nativeFields, customFields);
    const signature = crypto.createHash('sha256').update(JSON.stringify({
        empty: emptyFields,
        custom: customFields.map(field => ({
            key: field.key,
            type: field.valueType,
            options: field.options,
            constraints: field.constraints,
            guidance: field.aiGuidance || '',
        })),
    })).digest('hex').slice(0, 16);
    return { emptyFields, signature };
}

function isUnsupportedNumericDelta(value, support) {
    const rawValue = String(value ?? '').trim();
    if (/^[+-]\s*\d+(?:[.,]\d+)?$/.test(rawValue)) return true;

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return false;
    const explanation = String(support || '');
    const hasDelta = /(?:^|[\s:(])(?:\+|-)\s*\d+(?:[.,]\d+)?\b|(?:increase|decrease|gain|loss|raised|lowered)\s+(?:by)?\s*\d/iu.test(explanation);
    if (!hasDelta) return false;

    const escaped = String(numericValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasExplicitResult = new RegExp(`(?:→|➔|->|to|becomes?|became|result(?:s|ed)?\\s+in|new value|final value)\\s*${escaped}(?![\\d.,])`, 'iu').test(explanation);
    return !hasExplicitResult;
}

const comparableText = value => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A replacement of a written description must carry it forward: one that drops most of it, or
// only repeats part of it, would cost the user their text for nothing new.
function isWeakTextReplacement(currentValue, proposedValue, { floor = 120 } = {}) {
    const current = comparableText(currentValue);
    const proposed = comparableText(proposedValue);
    if (!current || !proposed) return false;
    if (current.includes(proposed)) return true;
    return current.length >= floor && proposed.length < current.length * 0.5;
}

module.exports = {
    isWeakTextReplacement,
    comparableText,
    filterUpdateFields,
    filterUpdateRelations,
    buildFieldCoverage,
    isEmptyFieldValue,
    listEmptyWritableFields,
    isUnsupportedNumericDelta,
};

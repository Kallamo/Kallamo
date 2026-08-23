function strictObject(properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false };
}

// Every object here stays closed: several providers reject `additionalProperties: true`
// outright, so a structured update request built on an open object never runs.
const CHANGE_KINDS = [
  'field',
  'link',
  'fact',
  'awareness',
  'knowledge',
  'belief',
  'memory',
  'relationship',
];

const ENTITY_UPDATE_SCHEMA = strictObject({
  changes: {
    type: 'array',
    items: strictObject({
      kind: { type: 'string', enum: CHANGE_KINDS },
      key: { type: 'string' },
      value: { type: 'string' },
      subjectId: { type: 'string' },
      target: { type: 'string' },
      targetId: { type: 'string' },
      perspectiveOwnerId: { type: 'string' },
      targetRole: { type: 'string' },
      sourcePerspective: { type: 'string' },
      score: { type: 'number' },
      method: { type: 'string', enum: ['', 'participant', 'witness', 'reported', 'inferred'] },
      accessibility: { type: 'string', enum: ['', 'available', 'suppressed', 'inaccessible'] },
      support: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } },
    }),
  },
});

const ENTITY_LORE_SCHEMA = strictObject({
  lore: strictObject({
    value: { type: 'string' },
    support: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  }),
});

function buildEntityUpdateSchema() {
  return ENTITY_UPDATE_SCHEMA;
}

function buildEntityLoreSchema() {
  return ENTITY_LORE_SCHEMA;
}

module.exports = { CHANGE_KINDS, ENTITY_UPDATE_SCHEMA, ENTITY_LORE_SCHEMA, buildEntityUpdateSchema, buildEntityLoreSchema };

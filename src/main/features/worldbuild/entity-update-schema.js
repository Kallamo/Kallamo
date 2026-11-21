function strictObject(properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false };
}

// Every object here stays closed: several providers reject `additionalProperties: true`
// outright, so a structured update request built on an open object never runs.
const CANON_KINDS = ['field', 'link', 'history', 'skill'];
const NARRATIVE_KINDS = ['fact', 'awareness', 'knowledge', 'belief', 'memory', 'relationship'];
const CHANGE_KINDS = [...CANON_KINDS, ...NARRATIVE_KINDS];

const RELATIONSHIP_DIRECTIONS = ['', 'closer', 'further'];
const RELATIONSHIP_IMPACTS = ['', 'meaningful', 'significant', 'drastic'];

// The sheet's pass needs only what a field, link, background line or skill carries.
function canonChangeSchema(kinds) {
  return strictObject({
    kind: { type: 'string', enum: kinds },
    key: { type: 'string' },
    value: { type: 'string' },
    target: { type: 'string' },
    targetRole: { type: 'string' },
    support: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  });
}

function narrativeChangeSchema(kinds, causes) {
  return strictObject({
    kind: { type: 'string', enum: kinds },
    key: { type: 'string' },
    value: { type: 'string' },
    subjectId: { type: 'string' },
    target: { type: 'string' },
    targetId: { type: 'string' },
    perspectiveOwnerId: { type: 'string' },
    targetRole: { type: 'string' },
    sourcePerspective: { type: 'string' },
    score: { type: 'number' },
    direction: { type: 'string', enum: RELATIONSHIP_DIRECTIONS },
    cause: { type: 'string', enum: ['', ...causes] },
    impact: { type: 'string', enum: RELATIONSHIP_IMPACTS },
    method: { type: 'string', enum: ['', 'participant', 'witness', 'reported', 'inferred'] },
    accessibility: { type: 'string', enum: ['', 'available', 'suppressed', 'inaccessible'] },
    support: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  });
}

const ENTITY_LORE_SCHEMA = strictObject({
  lore: strictObject({
    value: { type: 'string' },
    support: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
  }),
});

// The same request shape returns the same object, so a provider that compiles the grammar reuses it.
const schemaCache = new Map();

function buildEntityUpdateSchema({ pass = 'canon', kinds = null, causes = [] } = {}) {
  const key = JSON.stringify([pass, kinds, causes]);
  if (!schemaCache.has(key)) {
    schemaCache.set(key, pass === 'narrative'
      ? strictObject({ changes: { type: 'array', items: narrativeChangeSchema(kinds || NARRATIVE_KINDS, causes) } })
      : strictObject({ changes: { type: 'array', items: canonChangeSchema(kinds || CANON_KINDS) } }));
  }
  return schemaCache.get(key);
}

function buildEntityLoreSchema() {
  return ENTITY_LORE_SCHEMA;
}

// Each field of a sheet that is empty is answered, found or not, so a skipped field is visible.
const FIELD_GAP_SCHEMA = strictObject({
  fields: {
    type: 'array',
    items: strictObject({
      key: { type: 'string' },
      status: { type: 'string', enum: ['found', 'absent'] },
      value: { type: 'string' },
      support: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' } },
    }),
  },
});

function buildFieldGapSchema() {
  return FIELD_GAP_SCHEMA;
}

// A cleaned lore keeps sentences of the current one word for word; nothing new is written.
const LORE_CLEANUP_SCHEMA = strictObject({
  keep: { type: 'array', items: { type: 'number' } },
  story: { type: 'array', items: { type: 'number' } },
});

function buildLoreCleanupSchema() {
  return LORE_CLEANUP_SCHEMA;
}

module.exports = {
  CANON_KINDS,
  NARRATIVE_KINDS,
  CHANGE_KINDS,
  ENTITY_LORE_SCHEMA,
  buildEntityUpdateSchema,
  buildEntityLoreSchema,
  buildFieldGapSchema,
  buildLoreCleanupSchema,
};

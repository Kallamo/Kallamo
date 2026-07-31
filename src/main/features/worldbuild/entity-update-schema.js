function strictObject(properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false };
}

const ENTITY_UPDATE_SCHEMA = strictObject({
  data: { type: 'object', additionalProperties: true },
  links: { type: 'object', additionalProperties: true }
});

const ENTITY_LORE_SCHEMA = strictObject({
  lore: strictObject({
    value: { type: 'string' },
    support: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } }
  })
});

function buildEntityUpdateSchema() {
  return ENTITY_UPDATE_SCHEMA;
}

function buildEntityLoreSchema() {
  return ENTITY_LORE_SCHEMA;
}

module.exports = { ENTITY_UPDATE_SCHEMA, ENTITY_LORE_SCHEMA, buildEntityUpdateSchema, buildEntityLoreSchema };

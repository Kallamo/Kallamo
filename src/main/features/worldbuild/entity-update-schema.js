function strictObject(properties, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false };
}

// One proposed field value, with the support the enrichment validates before it
// accepts anything.
const FIELD_PROPOSAL = strictObject({
  value: { type: 'string' },
  certainty: { type: 'string' },
  support: { type: 'string' },
  evidence: { type: 'array', items: { type: 'string' } }
});

// One proposed edge to an existing entity. `label` only applies to labelled
// relations, so it is declared but never required.
const LINK_PROPOSAL = strictObject(
  {
    name: { type: 'string' },
    label: { type: 'string' },
    certainty: { type: 'string' },
    support: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } }
  },
  ['name', 'certainty', 'support', 'evidence']
);

const ENTITY_LORE_SCHEMA = strictObject({
  lore: strictObject({
    value: { type: 'string' },
    support: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } }
  })
});

// `data` and `links` hold keys that depend on the entity type, which used to be
// expressed as open objects. Several providers reject an open object outright
// ("additionalProperties: true is not supported"), so the schema is built per
// entity from the fields and relations that entity actually accepts. Nothing is
// lost by closing it: the enrichment already discards any key outside those
// lists. Both stay optional, since an update that changes nothing is valid.
function buildEntityUpdateSchema(fieldKeys = [], relationKeys = []) {
  const data = {};
  for (const key of fieldKeys) data[key] = FIELD_PROPOSAL;

  const links = {};
  for (const key of relationKeys) links[key] = { type: 'array', items: LINK_PROPOSAL };

  return strictObject({
    data: strictObject(data, []),
    links: strictObject(links, [])
  });
}

function buildEntityLoreSchema() {
  return ENTITY_LORE_SCHEMA;
}

module.exports = { ENTITY_LORE_SCHEMA, buildEntityUpdateSchema, buildEntityLoreSchema };

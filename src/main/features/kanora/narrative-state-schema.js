const NARRATIVE_TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consequential', 'types', 'entityIds', 'confidence', 'evidence', 'requiresFullAnalysis', 'reason', 'timeAdvance'],
  properties: {
    consequential: { type: 'boolean' },
    types: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['entity', 'scene', 'resource', 'inventory', 'awareness', 'knowledge', 'belief', 'memory', 'relationship', 'fact'],
      },
    },
    entityIds: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    evidence: { type: 'array', items: { type: 'string' } },
    requiresFullAnalysis: { type: 'boolean' },
    reason: { type: 'string' },
    timeAdvance: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['actionType', 'basis', 'duration', 'confidence', 'evidence'],
          properties: {
            actionType: { type: 'string' },
            basis: { type: 'string', enum: ['explicit', 'matrix'] },
            duration: {
              type: 'object',
              additionalProperties: false,
              required: ['years', 'months', 'days', 'hours', 'minutes'],
              properties: {
                years: { type: 'integer', minimum: 0 },
                months: { type: 'integer', minimum: 0 },
                days: { type: 'integer', minimum: 0 },
                hours: { type: 'integer', minimum: 0 },
                minutes: { type: 'integer', minimum: 0 },
              },
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidence: { type: 'string' },
          },
        },
      ],
    },
  },
};

const NARRATIVE_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['newEntities', 'resourceChanges', 'scenePatch', 'inventoryChanges', 'events'],
  properties: {
    newEntities: { type: 'array', items: { type: 'object', additionalProperties: true } },
    resourceChanges: { type: 'array', items: { type: 'object', additionalProperties: true } },
    scenePatch: { type: 'object', additionalProperties: true },
    inventoryChanges: { type: 'array', items: { type: 'object', additionalProperties: true } },
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['type', 'description', 'excerpt', 'participantIds', 'confidence', 'operations'],
        properties: {
          type: { type: 'string' },
          description: { type: 'string' },
          excerpt: { type: 'string' },
          participantIds: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          operations: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
    },
  },
};

module.exports = { NARRATIVE_TRIAGE_SCHEMA, NARRATIVE_STATE_SCHEMA };

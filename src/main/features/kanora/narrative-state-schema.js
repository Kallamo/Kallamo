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
          required: ['actionType', 'basis', 'duration', 'targetPosition', 'confidence', 'evidence'],
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
            targetPosition: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['eraId', 'year', 'month', 'day', 'hour', 'minute'],
                  properties: {
                    eraId: { type: 'string' },
                    year: { type: 'integer' },
                    month: { type: 'integer', minimum: 1 },
                    day: { type: 'integer', minimum: 1 },
                    hour: { type: 'integer', minimum: 0 },
                    minute: { type: 'integer', minimum: 0, maximum: 59 },
                  },
                },
              ],
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
  required: ['newEntities', 'identityUpdates', 'resourceChanges', 'scenePatch', 'inventoryChanges', 'events'],
  properties: {
    newEntities: { type: 'array', items: { type: 'object', additionalProperties: true } },
    identityUpdates: { type: 'array', items: { type: 'object', additionalProperties: true } },
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
          type: {
            type: 'string',
            enum: ['movement', 'possession-transfer', 'revelation', 'deception', 'discovery', 'relationship-change', 'custom'],
          },
          description: { type: 'string' },
          excerpt: { type: 'string' },
          participantIds: { type: 'array', items: { type: 'string' } },
          participants: { type: 'array', items: { type: 'object', additionalProperties: true } },
          worldbuildEventId: { type: 'string' },
          occurrenceTitle: { type: 'string' },
          worldDate: { type: 'object', additionalProperties: true },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          operations: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
    },
  },
};

module.exports = { NARRATIVE_TRIAGE_SCHEMA, NARRATIVE_STATE_SCHEMA };

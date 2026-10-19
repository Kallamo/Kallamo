import {
  KNOWLEDGE_CATEGORIES,
  MEMORY_CATEGORIES,
  RELATIONSHIP_CAUSES
} from '../../../narrative/narrative-taxonomy';

/** The union of both vocabularies, with the value they share listed once. */
const OPERATION_CATEGORIES = [...new Set<string>([...KNOWLEDGE_CATEGORIES, ...MEMORY_CATEGORIES])];

/**
 * The vocabularies live in the schema, not only the prompt, so structured output refuses an
 * invented category at generation time. Transient values are allowed here and dropped by name later.
 */
export const NARRATIVE_OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  required: ['type'],
  properties: {
    type: {
      type: 'string',
      enum: ['fact', 'awareness', 'knowledge', 'belief', 'memory', 'relationship'],
    },
    subjectId: { type: 'string' },
    targetId: { type: 'string' },
    sourceEntityId: { type: 'string' },
    targetEntityId: { type: 'string' },
    proposition: {
      type: 'object',
      additionalProperties: true,
      properties: {
        subjectId: { type: 'string' },
        predicate: { type: 'string' },
      },
    },
    category: {
      type: 'string',
      enum: OPERATION_CATEGORIES,
    },
    cause: { type: 'string', enum: [...RELATIONSHIP_CAUSES] },
    acquisition: { type: 'string', enum: ['participant', 'witness', 'reported', 'inferred'] },
    accessibility: { type: 'string', enum: ['available', 'suppressed', 'inaccessible'] },
    impact: { type: 'string', enum: ['meaningful', 'significant', 'drastic'] },
    informantIds: { type: 'array', items: { type: 'string' } },
    relatedEntityIds: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    dimension: { type: 'string' },
    value: { type: 'number', minimum: -100, maximum: 100 },
    salience: { type: 'number', minimum: 0, maximum: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export const NARRATIVE_TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['consequential', 'types', 'entityIds', 'presentIds', 'confidence', 'evidence', 'requiresFullAnalysis', 'reason', 'timeAdvance', 'sceneMemory'],
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
    presentIds: { type: 'array', items: { type: 'string' } },
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
          required: ['actionType', 'basis', 'duration', 'targetPosition', 'confidence', 'evidence', 'statedSpan'],
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
            statedSpan: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['excerpt', 'amount', 'unit', 'asserts'],
                  properties: {
                    excerpt: { type: 'string' },
                    amount: { type: 'integer', minimum: 1 },
                    unit: { type: 'string', enum: ['minutes', 'hours', 'days', 'weeks', 'months', 'years', 'decades'] },
                    asserts: { type: 'string', enum: ['now', 'framing', 'history'] },
                  },
                },
              ],
            },
          },
        },
      ],
    },
    sceneMemory: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['entityId', 'perceived', 'heard', 'stance'],
        properties: {
          entityId: { type: 'string' },
          perceived: { type: 'array', items: { type: 'string' } },
          heard: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['fromId', 'text'],
              properties: {
                fromId: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
          stance: { type: 'string' },
        },
      },
    },
  },
};

export const NARRATIVE_STATE_SCHEMA = {
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
          operations: { type: 'array', items: NARRATIVE_OPERATION_SCHEMA },
        },
      },
    },
  },
};

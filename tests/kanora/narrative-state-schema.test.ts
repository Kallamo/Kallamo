import Ajv from 'ajv';
import { describe, expect, test } from 'vitest';
import {
  NARRATIVE_STATE_SCHEMA,
  NARRATIVE_TRIAGE_SCHEMA
} from '../../src/main/features/kanora/narrative-state-schema.js';

describe('Narrative State structured output schemas', () => {
  test('accepts the supported triage shape and rejects missing ownership fields', () => {
    const validate = new Ajv().compile(NARRATIVE_TRIAGE_SCHEMA);

    expect(validate({
      consequential: true,
      types: ['knowledge'],
      entityIds: ['kepler'],
      confidence: 0.9,
      evidence: ['Kepler heard a new concept.'],
      requiresFullAnalysis: false,
      reason: 'Kepler heard a new concept.'
    })).toBe(true);
    expect(validate({ consequential: true, types: ['knowledge'] })).toBe(false);
  });

  test('accepts an empty durable state result and a structured event', () => {
    const validate = new Ajv().compile(NARRATIVE_STATE_SCHEMA);

    expect(validate({
      newEntities: [],
      resourceChanges: [],
      scenePatch: {},
      inventoryChanges: [],
      events: []
    })).toBe(true);
    expect(validate({
      newEntities: [],
      resourceChanges: [],
      scenePatch: {},
      inventoryChanges: [],
      events: [{
        type: 'revelation',
        description: 'Mara explains the Aether Weave.',
        excerpt: 'The weave fails near iron.',
        participantIds: ['mara', 'kepler'],
        confidence: 0.95,
        operations: []
      }]
    })).toBe(true);
  });
});

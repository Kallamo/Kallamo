import Ajv from 'ajv';
import { describe, expect, test } from 'vitest';
import {
  NARRATIVE_MECHANICS_SCHEMA,
  NARRATIVE_STORY_SCHEMA,
  NARRATIVE_TRIAGE_SCHEMA
} from '../../src/main/features/narrative/narrative-state-schema';

describe('Narrative State structured output schemas', () => {
  test('accepts the supported triage shape and rejects missing ownership fields', () => {
    const validate = new Ajv().compile(NARRATIVE_TRIAGE_SCHEMA);

    expect(validate({
      consequential: true,
      types: ['knowledge'],
      entityIds: ['corwin'],
      presentIds: ['corwin'],
      aboutIds: ['corwin'],
      confidence: 0.9,
      evidence: ['Corwin heard a new concept.'],
      requiresFullAnalysis: false,
      reason: 'Corwin heard a new concept.',
      timeAdvance: {
        actionType: 'reported_discovery',
        basis: 'explicit',
        duration: { years: 0, months: 0, days: 0, hours: 5, minutes: 5 },
        targetPosition: { eraId: 'ce', year: 997, month: 5, day: 15, hour: 13, minute: 15 },
        confidence: 1,
        evidence: 'The clock reads 13:15.',
        statedSpan: null,
        movementOnly: false
      },
      sceneMemory: [{
        entityId: 'corwin',
        perceived: ['Tess drew the weave in the dust'],
        heard: [{ fromId: 'tess', text: 'the weave fails near iron' }],
        stance: 'wants to test the claim'
      }]
    })).toBe(true);
    expect(validate({ consequential: true, types: ['knowledge'] })).toBe(false);
  });

  test('scene memory lines name their speaker and nothing else', () => {
    const validate = new Ajv().compile(NARRATIVE_TRIAGE_SCHEMA);
    const turn = {
      consequential: false, types: [], entityIds: [], presentIds: ['guard'], aboutIds: [], confidence: 1, evidence: [],
      requiresFullAnalysis: false, reason: 'dialogue', timeAdvance: null
    };

    expect(validate({ ...turn, sceneMemory: [] })).toBe(true);
    expect(validate({ ...turn, sceneMemory: [{ entityId: 'guard', perceived: [], heard: [{ text: 'five captured' }], stance: '' }] })).toBe(false);
    expect(validate({ ...turn, sceneMemory: [{ entityId: 'guard', perceived: [], heard: [], stance: '', truth: 'six' }] })).toBe(false);
  });

  test('the scene pass carries no events, and the story pass only events', () => {
    const mechanics = new Ajv().compile(NARRATIVE_MECHANICS_SCHEMA);
    const story = new Ajv().compile(NARRATIVE_STORY_SCHEMA);
    const scene = { newEntities: [], identityUpdates: [], resourceChanges: [], scenePatch: {}, inventoryChanges: [] };
    const event = {
      type: 'revelation',
      description: 'Tess explains the Aether Weave to Corwin at the forge.',
      excerpt: 'The weave fails near iron.',
      participantIds: ['tess', 'corwin'],
      confidence: 0.95,
      operations: []
    };

    expect(mechanics(scene)).toBe(true);
    expect(mechanics({ ...scene, events: [event] })).toBe(false);
    expect(story({ events: [] })).toBe(true);
    expect(story({ events: [event] })).toBe(true);
    expect(story({ events: [{ ...event, type: 'conversation' }] })).toBe(false);
    expect(story({ ...scene, events: [] })).toBe(false);
  });
});

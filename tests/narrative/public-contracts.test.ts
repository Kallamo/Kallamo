import { describe, expect, test } from 'vitest';
import { possessionTransferScenario } from '../../src/narrative/scenarios';
import {
  VALIDATION_ISSUE_CODES,
  validateEvidenceReference,
  validateAwareness,
  validateKnowledge,
  validateNarrativeEvent,
  validateNarrativeOperation,
  validateNarrativeProjection,
  validateScene
} from '../../src/narrative/validation';

describe('public Contract v1 validators', () => {
  test('validates evidence, event, and operation independently', () => {
    expect(validateEvidenceReference(possessionTransferScenario.evidence[0]).success).toBe(true);
    expect(validateNarrativeEvent(possessionTransferScenario.changeSet.event).success).toBe(true);
    expect(validateNarrativeOperation(possessionTransferScenario.changeSet.operations[0]).success).toBe(true);
  });

  test('validates knowledge accessibility independently from its status', () => {
    expect(validateKnowledge({
      id: 'knowledge-suppressed',
      subjectId: 'elias',
      proposition: { subjectId: 'vault', predicate: 'location', object: 'citadel' },
      sourceEventId: 'event-discovery',
      acquisition: 'participant',
      confidence: 0.8,
      accessibility: 'suppressed',
      status: 'active'
    }).success).toBe(true);
  });

  test('validates portable awareness independently from card presentation', () => {
    expect(validateAwareness({
      id: 'awareness-one',
      subjectId: 'elias',
      targetId: 'vault',
      status: 'active',
      sourceEventId: 'event-discovery'
    }).success).toBe(true);
  });

  test('rejects knowledge without explicit accessibility', () => {
    const result = validateKnowledge({
      id: 'knowledge-missing-accessibility',
      subjectId: 'elias',
      proposition: { subjectId: 'vault', predicate: 'location', object: 'citadel' },
      sourceEventId: 'event-discovery',
      acquisition: 'participant',
      confidence: 0.8,
      status: 'active'
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.accessibility' }));
  });

  test('requires a focal subject for subjective scenes', () => {
    const result = validateScene({
      id: 'scene-one',
      projectId: 'project-example',
      status: 'active',
      participantIds: ['mara'],
      possibleObserverIds: [],
      perspective: { access: 'subjective' },
      position: { sequence: 1 }
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(expect.objectContaining({ code: VALIDATION_ISSUE_CODES.REQUIRED, path: '$.perspective.focalSubjectId' }));
  });

  test('validates a complete empty projection', () => {
    const result = validateNarrativeProjection({
      projectId: 'project-example',
      through: { sequence: 12 },
      facts: [],
      states: [],
      awareness: [],
      knowledge: [],
      beliefs: [],
      relationships: []
    });

    expect(result.success).toBe(true);
  });

  test('rejects malformed records inside a projection', () => {
    const result = validateNarrativeProjection({
      projectId: 'project-example',
      through: { sequence: 12 },
      facts: [],
      states: [{ entityId: '', property: 'ownerId', value: 'elias', effectiveFrom: { sequence: 12 } }],
      awareness: [],
      knowledge: [],
      beliefs: [],
      relationships: []
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(expect.objectContaining({ code: VALIDATION_ISSUE_CODES.REQUIRED }));
  });
});

import { describe, expect, test } from 'vitest';
import { possessionTransferScenario } from '../../src/kanora/scenarios';
import {
  VALIDATION_ISSUE_CODES,
  validateEvidenceReference,
  validateNarrativeEvent,
  validateNarrativeOperation,
  validateNarrativeProjection,
  validateScene
} from '../../src/kanora/validation';

describe('public Contract v1 validators', () => {
  test('validates evidence, event, and operation independently', () => {
    expect(validateEvidenceReference(possessionTransferScenario.evidence[0]).success).toBe(true);
    expect(validateNarrativeEvent(possessionTransferScenario.changeSet.event).success).toBe(true);
    expect(validateNarrativeOperation(possessionTransferScenario.changeSet.operations[0]).success).toBe(true);
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
      knowledge: [],
      beliefs: [],
      relationships: []
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(expect.objectContaining({ code: VALIDATION_ISSUE_CODES.REQUIRED }));
  });
});

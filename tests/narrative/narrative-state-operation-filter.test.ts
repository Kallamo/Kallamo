import { describe, expect, test } from 'vitest';
import type { NarrativeOperation } from '../../src/narrative/contracts';
import { isValidNarrativeOperation } from '../../src/main/features/narrative/narrative-state';

describe('Narrative State operation boundary', () => {
  test('keeps a valid relationship operation', () => {
    expect(isValidNarrativeOperation({
      id: 'relationship-operation',
      type: 'set-relationship',
      evidenceIds: ['evidence-one'],
      relationship: {
        id: 'relationship-one',
        sourceEntityId: 'npc',
        targetEntityId: 'player',
        dimension: 'overall',
        value: 5,
        previousValue: 0,
        sourceEventId: 'event-one'
      }
    })).toBe(true);
  });

  test('rejects a malformed operation before it invalidates the change set', () => {
    const malformed = {
      id: 'knowledge-operation',
      type: 'grant-knowledge',
      evidenceIds: ['evidence-one'],
      knowledge: {
        id: 'knowledge-one',
        subjectId: 'npc',
        proposition: { subjectId: 'player', predicate: 'revealed-history' },
        sourceEventId: 'event-one',
        acquisition: 'reported',
        confidence: 0.95,
        accessibility: 'available',
        status: 'active'
      }
    } as unknown as NarrativeOperation;

    expect(isValidNarrativeOperation(malformed)).toBe(false);
  });
});

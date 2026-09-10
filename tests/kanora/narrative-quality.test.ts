import { describe, expect, test } from 'vitest';
import {
  EVENT_BUDGET_PER_TURN,
  OPERATION_BUDGET,
  assessExtractedOperation,
  reviewExtractedOperations,
  type ExtractedNarrativeOperation
} from '../../src/main/features/kanora/narrative-quality';

const model = { modelAuthored: true, eventConfidence: 0.95 };
const authored = { modelAuthored: false, eventConfidence: 0.95 };

function knowledge(patch: Partial<Extract<ExtractedNarrativeOperation, { type: 'knowledge' }>> = {}) {
  return {
    type: 'knowledge' as const,
    subjectId: 'kepler',
    proposition: { subjectId: 'alistair', predicate: 'past-service', object: 'Alistair commanded the northern march.' },
    category: 'history',
    acquisition: 'reported' as const,
    confidence: 0.95,
    ...patch
  };
}

describe('Narrative State quality gate', () => {
  test('keeps a durable statement and normalizes its category', () => {
    const verdict = assessExtractedOperation(knowledge({ category: 'World_Lore' }), model);

    expect(verdict.accepted).toBe(true);
    expect(verdict.operation).toMatchObject({ category: 'world-lore' });
  });

  test('refuses a statement the interpreter classified as momentary', () => {
    expect(assessExtractedOperation(knowledge({ category: 'scene-state' }), model))
      .toEqual({ accepted: false, reason: 'transient-category' });
    expect(assessExtractedOperation(knowledge({ category: 'small-talk' }), model))
      .toEqual({ accepted: false, reason: 'transient-category' });
  });

  test('refuses a statement with no category rather than guessing one', () => {
    expect(assessExtractedOperation(knowledge({ category: undefined }), model))
      .toEqual({ accepted: false, reason: 'missing-category' });
    expect(assessExtractedOperation(knowledge({ category: 'lore-ish' }), model))
      .toEqual({ accepted: false, reason: 'missing-category' });
  });

  test('refuses scene state under a durable category, whatever the predicate is called', () => {
    const renamed = knowledge({
      category: 'world-lore',
      proposition: { subjectId: 'nex', predicate: 'current-activity', object: 'Being trained with a combat stave in the courtyard.' }
    });

    expect(assessExtractedOperation(renamed, model))
      .toEqual({ accepted: false, reason: 'scene-state-predicate' });
  });

  test('refuses a record whose content is an opaque key', () => {
    const identifier = knowledge({
      proposition: { subjectId: 'kepler', predicate: 'seen-at', object: 'bd4d6b65-3500-42f3-ac94-d73d9e76ab02' }
    });

    expect(assessExtractedOperation(identifier, model))
      .toEqual({ accepted: false, reason: 'identifier-content' });
  });

  test('refuses an empty statement under a predicate that says nothing on its own', () => {
    const empty = knowledge({
      proposition: { subjectId: 'alistair', predicate: 'worldbuild-statement', object: 'Something' }
    });

    expect(assessExtractedOperation(empty, model)).toEqual({ accepted: false, reason: 'trivial-statement' });
  });

  test('keeps a short value under a predicate that carries the claim', () => {
    const value = knowledge({
      category: 'capability',
      proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }
    });

    expect(assessExtractedOperation(value, model).accepted).toBe(true);
  });

  test('refuses a subject knowing world lore about itself, and keeps its own secret', () => {
    const lore = knowledge({ subjectId: 'alistair', category: 'history' });
    const secret = knowledge({ subjectId: 'alistair', category: 'secret' });

    expect(assessExtractedOperation(lore, model)).toEqual({ accepted: false, reason: 'self-referential' });
    expect(assessExtractedOperation(secret, model).accepted).toBe(true);
  });

  test('refuses a relationship change caused by ordinary courtesy', () => {
    const courtesy: ExtractedNarrativeOperation = {
      type: 'relationship', sourceEntityId: 'nex', targetEntityId: 'kepler',
      dimension: 'overall', value: 60, cause: 'courtesy', impact: 'meaningful'
    };

    expect(assessExtractedOperation(courtesy, model)).toEqual({ accepted: false, reason: 'transient-cause' });
  });

  test('keeps a relationship change with a cause that earns it', () => {
    const rescue: ExtractedNarrativeOperation = {
      type: 'relationship', sourceEntityId: 'nex', targetEntityId: 'kepler',
      dimension: 'overall', value: 75, cause: 'rescue', impact: 'significant'
    };

    expect(assessExtractedOperation(rescue, model).accepted).toBe(true);
  });

  test('refuses a relationship change the interpreter was unsure about', () => {
    const rescue: ExtractedNarrativeOperation = {
      type: 'relationship', sourceEntityId: 'nex', targetEntityId: 'kepler',
      dimension: 'overall', value: 75, cause: 'rescue'
    };

    expect(assessExtractedOperation(rescue, { modelAuthored: true, eventConfidence: 0.6 }))
      .toEqual({ accepted: false, reason: 'low-confidence' });
  });

  test('refuses a routine memory and keeps one a character carries', () => {
    const routine: ExtractedNarrativeOperation = {
      type: 'memory', subjectId: 'nex', summary: 'Nex ate breakfast at the inn before the others woke.',
      category: 'routine', salience: 0.9
    };
    const formative: ExtractedNarrativeOperation = { ...routine, category: 'formative' };

    expect(assessExtractedOperation(routine, model)).toEqual({ accepted: false, reason: 'transient-category' });
    expect(assessExtractedOperation(formative, model).accepted).toBe(true);
  });

  test('leaves hand-authored records alone', () => {
    expect(assessExtractedOperation(knowledge({ category: undefined }), authored).accepted).toBe(true);
    expect(assessExtractedOperation({
      type: 'relationship', sourceEntityId: 'nex', targetEntityId: 'kepler',
      dimension: 'trust', value: 40, title: 'Mentor'
    }, authored).accepted).toBe(true);
  });

  test('caps a runaway response instead of letting it flood the campaign', () => {
    const many = Array.from({ length: 20 }, (unused, index) => knowledge({
      proposition: { subjectId: 'alistair', predicate: `clue-${index}`, object: `Alistair revealed detail number ${index}.` }
    }));

    const review = reviewExtractedOperations(many, model);

    expect(review.operations).toHaveLength(OPERATION_BUDGET.knowledge);
    expect(review.rejections.filter(rejection => rejection.reason === 'over-budget'))
      .toHaveLength(20 - OPERATION_BUDGET.knowledge);
  });

  test('reports every refusal so a silent turn can explain itself', () => {
    const review = reviewExtractedOperations([
      knowledge({ category: 'scene-state' }),
      knowledge({ category: undefined }),
      knowledge()
    ], model);

    expect(review.operations).toHaveLength(1);
    expect(review.rejections).toEqual([
      { type: 'knowledge', reason: 'transient-category' },
      { type: 'knowledge', reason: 'missing-category' }
    ]);
  });

  /* The pipeline builds these itself when a character first meets the controlled one. They go
     through the same gate as anything the interpreter writes, so they have to speak the same
     vocabulary or first contact stops being recorded at all. */
  test('keeps the first-contact operations the pipeline generates', () => {
    const introduction: ExtractedNarrativeOperation = {
      type: 'fact',
      proposition: { subjectId: 'valera', predicate: 'narrative-introduction', object: 'A duelist from the Slag Pit enters the narrative.' },
      category: 'identity',
      confidence: 0.9
    };
    const encounter: ExtractedNarrativeOperation = {
      type: 'relationship', sourceEntityId: 'valera', targetEntityId: 'kepler',
      dimension: 'overall', value: 0, cause: 'first-impression', impact: 'meaningful'
    };

    expect(assessExtractedOperation(introduction, model).accepted).toBe(true);
    expect(assessExtractedOperation(encounter, model).accepted).toBe(true);
  });

  test('bounds how many events a single turn may produce', () => {
    expect(EVENT_BUDGET_PER_TURN).toBeGreaterThan(0);
    expect(EVENT_BUDGET_PER_TURN).toBeLessThanOrEqual(20);
  });
});

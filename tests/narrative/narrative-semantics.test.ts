import { describe, expect, test } from 'vitest';
import {
  deceptiveBeliefScenario,
  narrativeScenarios,
  possessionTransferScenario,
  secretRevelationScenario,
  verifyNarrativeScenarios
} from '../../src/narrative/scenarios';

describe('narrative semantics', () => {
  test('keeps deceptive belief separate from canonical fact and knowledge', () => {
    const operationTypes = deceptiveBeliefScenario.changeSet.operations.map(operation => operation.type);

    expect(operationTypes).toEqual(['set-belief']);
    expect(operationTypes).not.toContain('assert-fact');
    expect(operationTypes).not.toContain('grant-knowledge');
  });

  test('grants secret knowledge only to the exposed subject', () => {
    const knowledgeOperations = secretRevelationScenario.changeSet.operations.filter(operation => operation.type === 'grant-knowledge');

    expect(knowledgeOperations).toHaveLength(1);
    expect(knowledgeOperations[0].knowledge.subjectId).toBe('elias');
  });

  test('represents possession transfer as state instead of belief', () => {
    const operationTypes = possessionTransferScenario.changeSet.operations.map(operation => operation.type);

    expect(operationTypes).toEqual(['set-state']);
  });

  test('keeps every built-in scenario valid', () => {
    expect(narrativeScenarios).toHaveLength(3);
    expect(verifyNarrativeScenarios).not.toThrow();
  });
});

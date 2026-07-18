import { describe, expect, test } from 'vitest';
import { possessionTransferScenario, secretRevelationScenario } from '../../src/kanora/scenarios';
import { VALIDATION_ISSUE_CODES, validateNarrativeProposal } from '../../src/kanora/validation';

describe('narrative proposal validation', () => {
  test('rejects evidence references that are not supplied by the proposal', () => {
    const proposal = structuredClone(possessionTransferScenario);
    proposal.changeSet.event.evidenceIds = ['missing-evidence'];

    const result = validateNarrativeProposal(proposal);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual({
      code: VALIDATION_ISSUE_CODES.INVALID_REFERENCE,
      path: '$.changeSet',
      message: 'Unknown evidence reference: missing-evidence.'
    });
  });

  test.each([-0.1, 1.1])('rejects confidence outside the inclusive range for %s', confidence => {
    const proposal = structuredClone(secretRevelationScenario);
    const operation = proposal.changeSet.operations.find(candidate => candidate.type === 'grant-knowledge');
    if (!operation || operation.type !== 'grant-knowledge') throw new Error('Knowledge operation fixture is missing.');
    operation.knowledge.confidence = confidence;

    const result = validateNarrativeProposal(proposal);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(issue => issue.path.endsWith('.knowledge.confidence'))).toBe(true);
  });

  test('rejects knowledge without a subject', () => {
    const proposal = structuredClone(secretRevelationScenario);
    const operation = proposal.changeSet.operations.find(candidate => candidate.type === 'grant-knowledge');
    if (!operation || operation.type !== 'grant-knowledge') throw new Error('Knowledge operation fixture is missing.');
    operation.knowledge.subjectId = '';

    const result = validateNarrativeProposal(proposal);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(issue => issue.path.endsWith('.knowledge.subjectId'))).toBe(true);
  });
});

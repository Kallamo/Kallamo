import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { NarrativeProposal } from '../../src/narrative/contracts';
import { validateNarrativeProposal } from '../../src/narrative/validation';

interface ValidFixture {
  name: string;
  proposal: NarrativeProposal;
  expectedOperationTypes: string[];
  forbiddenOperationTypes: string[];
}

interface InvalidFixture {
  name: string;
  proposal: unknown;
  expectedIssuePaths: string[];
}

const fixtureRoot = join(process.cwd(), 'tests', 'fixtures', 'narrative', 'v1');

function loadFixtures<T>(kind: 'valid' | 'invalid'): T[] {
  const directory = join(fixtureRoot, kind);
  return readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')) as T);
}

describe('Narrative contract v1 conformance fixtures', () => {
  test.each(loadFixtures<ValidFixture>('valid'))('$name', fixture => {
    const result = validateNarrativeProposal(fixture.proposal);

    expect(result.success).toBe(true);
    const operationTypes = fixture.proposal.changeSet.operations.map(operation => operation.type);
    expect(operationTypes).toEqual(fixture.expectedOperationTypes);
    for (const forbiddenType of fixture.forbiddenOperationTypes) expect(operationTypes).not.toContain(forbiddenType);
  });

  test.each(loadFixtures<InvalidFixture>('invalid'))('$name', fixture => {
    const result = validateNarrativeProposal(fixture.proposal);

    expect(result.success).toBe(false);
    if (result.success) return;
    const issuePaths = result.issues.map(issue => issue.path);
    for (const expectedPath of fixture.expectedIssuePaths) expect(issuePaths).toContain(expectedPath);
  });
});

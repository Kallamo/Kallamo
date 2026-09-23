import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, test } from 'vitest';

interface Fixture {
  proposal: unknown;
}

const schemaPath = join(process.cwd(), 'src', 'narrative', 'schema', 'narrative-contract-v1.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

function loadProposals(kind: 'valid' | 'invalid'): unknown[] {
  const directory = join(process.cwd(), 'tests', 'fixtures', 'narrative', 'v1', kind);
  return readdirSync(directory)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(join(directory, file), 'utf8')) as Fixture)
    .map(fixture => fixture.proposal);
}

describe('Narrative Contract v1 JSON Schema', () => {
  test.each(loadProposals('valid'))('accepts a valid conformance proposal', proposal => {
    expect(validate(proposal), JSON.stringify(validate.errors)).toBe(true);
  });

  test.each(loadProposals('invalid'))('rejects an invalid conformance proposal', proposal => {
    expect(validate(proposal)).toBe(false);
  });

  test('survives JSON serialization without changing validity', () => {
    const proposal = loadProposals('valid')[0];
    const roundTrip = JSON.parse(JSON.stringify(proposal)) as unknown;

    expect(validate(roundTrip), JSON.stringify(validate.errors)).toBe(true);
    expect(roundTrip).toEqual(proposal);
  });
});

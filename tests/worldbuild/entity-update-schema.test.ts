import Ajv from 'ajv';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildEntityUpdateSchema } = require('../../src/main/features/worldbuild/entity-update-schema');
const { decodeEntityUpdate } = require('../../src/main/features/worldbuild/entity-update-protocol');
const validate = new Ajv({ strict: false }).compile(buildEntityUpdateSchema());

function relationship(targetRole: string) {
  return {
    kind: 'relationship',
    key: 'overall',
    value: '',
    subjectId: 'kaelen',
    targetId: 'mara',
    perspectiveOwnerId: 'kaelen',
    target: 'Mara',
    targetRole,
    sourcePerspective: 'Kaelen loves and protects Mara.',
    score: 100,
    method: '',
    accessibility: '',
    support: 'The passage identifies Mara as his daughter.',
    evidence: ['E_1'],
  };
}

describe('entity update structured schema', () => {
  test('uses one compact provider-independent grammar', () => {
    expect(validate({ changes: [relationship('Daughter')] })).toBe(true);
    expect(buildEntityUpdateSchema()).toBe(buildEntityUpdateSchema());
  });

  test('keeps target role separate from source perspective', () => {
    const decoded = decodeEntityUpdate({ changes: [relationship('Daughter')] });
    expect(decoded.narrative[0]).toEqual(expect.objectContaining({
      targetRole: 'Daughter',
      sourcePerspective: 'Kaelen loves and protects Mara.',
    }));
  });

  test('rejects provider output with extra shape variants', () => {
    expect(validate({ changes: [{ ...relationship('Daughter'), label: 'Protective Father' }] })).toBe(false);
  });

  test('keeps lore out of the findings response', () => {
    expect(validate({ changes: [{ ...relationship('Daughter'), kind: 'lore' }] })).toBe(false);
  });
});

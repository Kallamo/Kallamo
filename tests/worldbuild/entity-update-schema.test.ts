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
    subjectId: 'dorian',
    targetId: 'tess',
    perspectiveOwnerId: 'dorian',
    target: 'Tess',
    targetRole,
    sourcePerspective: 'Dorian loves and protects Tess.',
    score: 100,
    method: '',
    accessibility: '',
    support: 'The passage identifies Tess as his daughter.',
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
      sourcePerspective: 'Dorian loves and protects Tess.',
    }));
  });

  test('rejects provider output with extra shape variants', () => {
    expect(validate({ changes: [{ ...relationship('Daughter'), label: 'Protective Father' }] })).toBe(false);
  });

  test('routes history to the lore step and skills to the Rules', () => {
    const blank = { ...relationship(''), targetRole: '', sourcePerspective: '', score: 0, targetId: '', subjectId: '', perspectiveOwnerId: '', target: '' };
    const decoded = decodeEntityUpdate({ changes: [
      { ...blank, kind: 'history', key: '', value: 'Dorian left the mines after the collapse.' },
      { ...blank, kind: 'skill', key: 'Glass Weaving', value: 'Apprentice', target: 'Crafting', sourcePerspective: 'Shaping molten glass into thread.' },
    ] });
    expect(validate({ changes: [{ ...blank, kind: 'skill' }] })).toBe(true);
    expect(decoded.history).toEqual([expect.objectContaining({ value: 'Dorian left the mines after the collapse.' })]);
    expect(decoded.skills).toEqual([expect.objectContaining({ name: 'Glass Weaving', rank: 'Apprentice', parent: 'Crafting', description: 'Shaping molten glass into thread.' })]);
    expect(decoded.narrative).toEqual([]);
  });

  test('keeps lore out of the findings response', () => {
    expect(validate({ changes: [{ ...relationship('Daughter'), kind: 'lore' }] })).toBe(false);
  });
});

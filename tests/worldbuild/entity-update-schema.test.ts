import Ajv from 'ajv';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildEntityUpdateSchema } = require('../../src/main/features/worldbuild/entity-update-schema');
const { decodeEntityUpdate } = require('../../src/main/features/worldbuild/entity-update-protocol');
const ajv = new Ajv({ strict: false });
const validate = ajv.compile(buildEntityUpdateSchema({ pass: 'narrative', causes: ['rescue', 'affection'] }));
const validateSheet = ajv.compile(buildEntityUpdateSchema({ pass: 'canon' }));

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
    direction: '',
    cause: 'affection',
    impact: 'meaningful',
    method: '',
    accessibility: '',
    support: 'The passage identifies Tess as his daughter.',
    evidence: ['E_1'],
  };
}

describe('entity update structured schema', () => {
  test('uses one compact provider-independent grammar', () => {
    expect(validate({ changes: [relationship('Daughter')] })).toBe(true);
    expect(buildEntityUpdateSchema({ pass: 'narrative', causes: ['rescue', 'affection'] })).toBe(buildEntityUpdateSchema({ pass: 'narrative', causes: ['rescue', 'affection'] }));
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

  test('routes background to the lore step and skills to the Rules', () => {
    const sheet = { kind: 'field', key: '', value: '', target: '', targetRole: '', support: 'The passage says so.', evidence: ['E_1'] };
    const decoded = decodeEntityUpdate({ changes: [
      { ...sheet, kind: 'history', key: 'before-story', value: 'Dorian left the mines after the collapse.' },
      { ...sheet, kind: 'skill', key: 'Glass Weaving', value: 'Apprentice', target: 'Crafting', targetRole: 'Shaping molten glass into thread.' },
    ] });
    expect(validateSheet({ changes: [{ ...sheet, kind: 'skill' }] })).toBe(true);
    expect(validateSheet({ changes: [{ ...sheet, kind: 'memory' }] })).toBe(false);
    expect(validate({ changes: [{ ...relationship('Daughter'), kind: 'skill' }] })).toBe(false);
    expect(decoded.history).toEqual([expect.objectContaining({ era: 'before-story', value: 'Dorian left the mines after the collapse.' })]);
    expect(decoded.skills).toEqual([expect.objectContaining({ name: 'Glass Weaving', rank: 'Apprentice', parent: 'Crafting', description: 'Shaping molten glass into thread.' })]);
    expect(decoded.narrative).toEqual([]);
  });

  test('reads a field value sent as a quoted JSON string as plain text', () => {
    const blank = { ...relationship(''), targetRole: '', sourcePerspective: '', score: 0, targetId: '', subjectId: '', perspectiveOwnerId: '', target: '' };
    const decoded = decodeEntityUpdate({ changes: [
      { ...blank, kind: 'field', key: 'locationType', value: '"mountain"' },
      { ...blank, kind: 'field', key: 'description', value: '"Never again," she said at the gate.' },
      { ...blank, kind: 'field', key: 'tags', value: '["one","two"]' },
    ] });
    expect(decoded.data.locationType.value).toBe('mountain');
    expect(decoded.data.description.value).toBe('"Never again," she said at the gate.');
    expect(decoded.data.tags.value).toEqual(['one', 'two']);
  });

  test('keeps lore out of the findings response', () => {
    expect(validate({ changes: [{ ...relationship('Daughter'), kind: 'lore' }] })).toBe(false);
  });
});

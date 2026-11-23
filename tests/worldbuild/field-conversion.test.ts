import { describe, expect, test } from 'vitest';
import { convertFieldValue } from '../../src/main/features/worldbuild/field-conversion.js';

const field = (valueType: string, extra: Record<string, unknown> = {}) => ({ valueType, ...extra });
const choices = { options: [{ id: 'opt-h', label: 'Human' }, { id: 'opt-e', label: 'Elf' }] };

describe('custom field type conversion', () => {
  test('text keeps its words, and a plain number becomes a number', () => {
    expect(convertFieldValue('Tall', field('short-text'), field('long-text'))).toEqual({ kept: true, value: 'Tall' });
    expect(convertFieldValue('12,5', field('short-text'), field('number'))).toEqual({ kept: true, value: 12.5 });
    expect(convertFieldValue('heavy', field('short-text'), field('number'))).toEqual({ kept: false });
    expect(convertFieldValue(7, field('number'), field('short-text'))).toEqual({ kept: true, value: '7' });
  });

  test('a number outside the new range is not kept', () => {
    expect(convertFieldValue(120, field('number'), field('range', { constraints: { min: 0, max: 100 } }))).toEqual({ kept: false });
  });

  test('text matching an option label becomes that option, and choices read back as labels', () => {
    expect(convertFieldValue('elf', field('short-text'), field('single-choice', choices))).toEqual({ kept: true, value: 'opt-e' });
    expect(convertFieldValue('Human, Elf', field('short-text'), field('multiple-choice', choices))).toEqual({ kept: true, value: ['opt-h', 'opt-e'] });
    expect(convertFieldValue('Dwarf', field('short-text'), field('single-choice', choices))).toEqual({ kept: false });
    expect(convertFieldValue(['opt-h', 'opt-e'], field('multiple-choice', choices), field('long-text'))).toEqual({ kept: true, value: 'Human, Elf' });
    expect(convertFieldValue('opt-h', field('single-choice', choices), field('multiple-choice', choices))).toEqual({ kept: true, value: ['opt-h'] });
    expect(convertFieldValue(['opt-h', 'opt-e'], field('multiple-choice', choices), field('single-choice', choices))).toEqual({ kept: false });
  });

  test('yes and no words become a boolean', () => {
    expect(convertFieldValue('Yes', field('short-text'), field('boolean'))).toEqual({ kept: true, value: true });
    expect(convertFieldValue(false, field('boolean'), field('short-text'))).toEqual({ kept: true, value: 'No' });
  });

  test('entity references only move between the two reference types', () => {
    expect(convertFieldValue('ent-1', field('entity-reference'), field('entity-reference-list'))).toEqual({ kept: true, value: ['ent-1'] });
    expect(convertFieldValue(['ent-1'], field('entity-reference-list'), field('entity-reference'))).toEqual({ kept: true, value: 'ent-1' });
    expect(convertFieldValue('ent-1', field('entity-reference'), field('short-text'))).toEqual({ kept: false });
    expect(convertFieldValue('Mara', field('short-text'), field('entity-reference'))).toEqual({ kept: false });
  });
});

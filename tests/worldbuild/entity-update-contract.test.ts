import { describe, expect, test } from 'vitest';

const {
  filterUpdateFields,
  filterUpdateRelations,
  buildFieldCoverage,
  isUnsupportedNumericDelta,
  listEmptyWritableFields,
} = require('../../src/main/features/worldbuild/entity-update-contract');

describe('entity update contract', () => {
  const fields = ['itemType', 'abundance', 'description'];
  const relations = [
    { key: 'creator' },
    { key: 'owner', itemNature: 'unique' },
    { key: 'currentLocation', itemNature: 'unique' },
    { key: 'foundIn', itemNature: 'type' },
    { key: 'soldIn', itemNature: 'type' },
  ];

  test('item types receive abundance and availability but never fixed ownership', () => {
    const entity = { type: 'Items', data: { itemNature: 'type' } };
    expect(filterUpdateFields(entity, fields)).toEqual(fields);
    expect(filterUpdateRelations(entity, relations).map((relation: { key: string }) => relation.key))
      .toEqual(['creator', 'foundIn', 'soldIn']);
  });

  test('unique items receive ownership and location but never abundance or availability', () => {
    const entity = { type: 'Items', data: { itemNature: 'unique' } };
    expect(filterUpdateFields(entity, fields)).toEqual(['itemType', 'description']);
    expect(filterUpdateRelations(entity, relations).map((relation: { key: string }) => relation.key))
      .toEqual(['creator', 'owner', 'currentLocation']);
  });
});

describe('empty field coverage', () => {
  test('finds only writable fields that still lack a meaningful value', () => {
    const entity = {
      data: {
        appearance: 'Scarred',
        personality: '',
        customFields: { level: 0, title: '  ', active: false },
      },
    };
    const customFields = [
      { key: 'level' },
      { key: 'title' },
      { key: 'active' },
      { key: 'missing' },
    ];

    expect(listEmptyWritableFields(entity, ['appearance', 'personality'], customFields))
      .toEqual(['personality', 'customFields.title', 'customFields.missing']);
  });

  test('invalidates coverage when an empty field or its guidance changes', () => {
    const fields = [{ key: 'title', valueType: 'text', options: [], constraints: {}, aiGuidance: 'Formal title.' }];
    const empty = buildFieldCoverage({ data: { customFields: {} } }, [], fields);
    const filled = buildFieldCoverage({ data: { customFields: { title: 'Captain' } } }, [], fields);
    const revised = buildFieldCoverage(
      { data: { customFields: {} } },
      [],
      [{ ...fields[0], aiGuidance: 'Current formal title.' }],
    );

    expect(empty.emptyFields).toEqual(['customFields.title']);
    expect(filled.emptyFields).toEqual([]);
    expect(filled.signature).not.toBe(empty.signature);
    expect(revised.signature).not.toBe(empty.signature);
  });
});

describe('numeric field proposals', () => {
  test('rejects a bare increment presented as the field value', () => {
    expect(isUnsupportedNumericDelta('+1', 'DEX +1 for precise mana cleavage.')).toBe(true);
    expect(isUnsupportedNumericDelta(2, 'Dignity: +2 after the ceremony.')).toBe(true);
  });

  test('accepts an explicit resulting value even when the evidence also states its delta', () => {
    expect(isUnsupportedNumericDelta(23, 'AGI 22 → 23 (+1) after training.')).toBe(false);
  });

  test('accepts an absolute numeric value without delta language', () => {
    expect(isUnsupportedNumericDelta(17, 'The current Intelligence score is 17.')).toBe(false);
  });
});

// A creature is one stored type with two product surfaces. The enrichment may only
// offer a field the sheet for that scope actually renders.
describe('creature scope decides which fields the enrichment may set', () => {
  const creatureFields = ['status', 'disposition', 'nature', 'abundance', 'threat', 'abilities', 'appearance', 'personality'];
  const forScope = (scope?: string) =>
    filterUpdateFields({ type: 'Creatures', data: scope ? { scope } : {} }, creatureFields);

  test('a specific being has a life state and a temperament, not a prevalence', () => {
    expect(forScope('individual')).toEqual(['status', 'disposition', 'nature', 'threat', 'abilities', 'appearance', 'personality']);
  });

  test('a group has a prevalence and a shared look, but no status or personality', () => {
    expect(forScope('group')).toEqual(['disposition', 'nature', 'abundance', 'threat', 'abilities', 'appearance']);
  });

  test('an unset scope is treated as a specific being', () => {
    expect(forScope()).toEqual(forScope('individual'));
  });
});

import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ENRICH_ENUMS,
  ENRICH_FIELDS,
  ENRICH_TYPE_GUIDANCE,
  ENRICH_FIELD_GUIDANCE,
  DOSSIER_DATA_FIELDS,
  DOSSIER_EXEMPT_FIELDS,
  entityDataFacts
} = require('../../src/main/features/worldbuild/entity-fields');

const enrichableFields: string[] = [...new Set(Object.values(ENRICH_FIELDS).flat() as string[])];
const dossierKeys = new Set(DOSSIER_DATA_FIELDS.map(([key]: [string, string]) => key));

// A field that the AI may write but retrieval never reads is stored correctly and then
// never seen by anyone. Nothing throws, so the only thing that catches it is this test.
describe('every enrichable field survives the round trip', () => {
  test.each(enrichableFields)('%s reaches the dossier, or is exempt on purpose', (field) => {
    if (DOSSIER_EXEMPT_FIELDS.includes(field)) return;
    expect(dossierKeys).toContain(field);
  });

  test.each(DOSSIER_EXEMPT_FIELDS)('%s is exempt because a caller emits it separately', (field) => {
    expect(enrichableFields).toContain(field);
    expect(dossierKeys).not.toContain(field);
  });
});

// A missing guidance line does not fail loudly either: it reaches the AI as the literal
// string "undefined" inside the extraction prompt.
describe('every enrichable field and type carries its prompt guidance', () => {
  test.each(enrichableFields)('%s has field guidance', (field) => {
    expect(String(ENRICH_FIELD_GUIDANCE[field] || '').trim()).not.toBe('');
  });

  test.each(Object.keys(ENRICH_FIELDS))('%s has type guidance', (type) => {
    expect(String(ENRICH_TYPE_GUIDANCE[type] || '').trim()).not.toBe('');
  });

  test('no guidance is written for a field no type can set', () => {
    expect(Object.keys(ENRICH_FIELD_GUIDANCE).sort()).toEqual([...enrichableFields].sort());
  });

  test('every enum belongs to a field some type can set', () => {
    for (const field of Object.keys(ENRICH_ENUMS)) expect(enrichableFields).toContain(field);
  });
});

describe('entityDataFacts', () => {
  test('serializes a character sheet in dossier order', () => {
    const facts = entityDataFacts({
      status: 'alive',
      age: '28',
      appearance: 'Tall, weather-worn, a burn scar across the left hand.',
      personality: 'Guarded with strangers, blunt with friends.'
    });
    expect(facts).toBe([
      'status: alive',
      'age: 28',
      'appearance: Tall, weather-worn, a burn scar across the left hand.',
      'personality: Guarded with strangers, blunt with friends.'
    ].join('; '));
  });

  test('skips empty, blank, and unknown keys', () => {
    expect(entityDataFacts({ status: 'alive', age: '', appearance: '   ', role: null, notAField: 'x' }))
      .toBe('status: alive');
  });

  test('tolerates a missing or non-object data blob', () => {
    expect(entityDataFacts(null)).toBe('');
    expect(entityDataFacts('nope')).toBe('');
    expect(entityDataFacts({})).toBe('');
  });
});

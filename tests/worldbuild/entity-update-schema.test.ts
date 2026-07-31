import Ajv from 'ajv';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildEntityLoreSchema, buildEntityUpdateSchema } = require('../../src/main/features/worldbuild/entity-update-schema');
const { decodeEntityUpdate } = require('../../src/main/features/worldbuild/entity-update-protocol');

describe('entity update structured schemas', () => {
  const ajv = new Ajv({ strict: false });

  test('accepts the provider-independent data and links contract', () => {
    const validate = ajv.compile(buildEntityUpdateSchema());
    expect(validate({ data: {}, links: {} })).toBe(true);
    expect(decodeEntityUpdate({ data: { age: { value: '34' } }, links: {} }))
      .toEqual({ data: { age: { value: '34' } }, links: {} });
  });

  test('rejects missing or extra top-level sections', () => {
    const validate = ajv.compile(buildEntityUpdateSchema());
    expect(validate({ data: {} })).toBe(false);
    expect(validate({ data: {}, links: {}, lore: {} })).toBe(false);
  });

  test('keeps lore in a separate strict response', () => {
    const validate = ajv.compile(buildEntityLoreSchema());
    expect(validate({ lore: { value: 'Canonical lore', support: 'Direct evidence', evidence: ['E_1'] } })).toBe(true);
    expect(validate({ lore: { value: 'Canonical lore', support: 'Direct evidence', evidence: ['E_1'], summary: 'extra' } })).toBe(false);
  });
});

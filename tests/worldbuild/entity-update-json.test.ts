import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { parseEntityUpdateObject } = require('../../src/main/features/worldbuild/entity-update-json.js');

describe('entity update JSON recovery', () => {
  test('parses a valid fenced entity update', () => {
    expect(parseEntityUpdateObject('BEGIN\n{"data":{},"links":{}}\nEND'))
      .toEqual({ value: { data: {}, links: {} }, repaired: false });
  });

  test('repairs missing commas between array elements', () => {
    expect(parseEntityUpdateObject('{"links":{"relationships":[{"name":"Mara"} {"name":"Elias"}]}}'))
      .toEqual({ value: { links: { relationships: [{ name: 'Mara' }, { name: 'Elias' }] } }, repaired: true });
  });

  test('repairs trailing commas and rejects unrecoverable text', () => {
    expect(parseEntityUpdateObject('{"data":{"personality":{"value":"Calm",}},"links":{}}'))
      .toEqual({ value: { data: { personality: { value: 'Calm' } }, links: {} }, repaired: true });
    expect(parseEntityUpdateObject('not json')).toEqual({ value: null, repaired: false });
  });
});

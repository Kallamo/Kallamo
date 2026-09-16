import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { parseEntityUpdateObject } = require('../../src/main/features/worldbuild/entity-update-json.js');

describe('entity update JSON recovery', () => {
  test('parses a valid fenced entity update', () => {
    const result = parseEntityUpdateObject('BEGIN\n{"data":{},"links":{}}\nEND');
    expect(result).toEqual({ value: { data: {}, links: {} }, repaired: false });
  });

  test('repairs missing commas between array elements', () => {
    const result = parseEntityUpdateObject('{"links":{"relationships":[{"name":"Nora"} {"name":"Elias"}]}}');
    expect(result).toEqual({ value: { links: { relationships: [{ name: 'Nora' }, { name: 'Elias' }] } }, repaired: true });
  });

  test('repairs adjacent array elements without whitespace', () => {
    const result = parseEntityUpdateObject('{"evidence":["E1""E2"]}');
    expect(result.value).toEqual({ evidence: ['E1', 'E2'] });
  });

  test('repairs a trailing comma without changing values', () => {
    const result = parseEntityUpdateObject('{"data":{"personality":{"value":"Calm",}},"links":{}}');
    expect(result).toEqual({ value: { data: { personality: { value: 'Calm' } }, links: {} }, repaired: true });
  });

  test('rejects text that cannot be recovered as one object', () => {
    expect(parseEntityUpdateObject('not json')).toEqual({ value: null, repaired: false });
  });
});

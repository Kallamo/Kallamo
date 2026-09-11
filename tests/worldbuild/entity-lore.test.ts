import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { validateEntityLore, validateEntityLoreAppend } = require('../../src/main/features/worldbuild/entity-lore');
const evidence = new Set(['E_1']);

describe('entity lore validation', () => {
  test('rejects a single-event summary for an empty record', () => {
    expect(validateEntityLore({
      lore: { value: 'Kepler learned a custom in Zeth.', support: 'One passage.', evidence: ['E_1'] },
    }, '', evidence)).toBeNull();
  });

  test('rejects destructive compression of established lore', () => {
    const current = 'Established history. '.repeat(80);
    expect(validateEntityLore({
      lore: { value: 'A short replacement. '.repeat(20), support: 'New passage.', evidence: ['E_1'] },
    }, current, evidence)).toBeNull();
  });

  test('extends long lore with new paragraphs only', () => {
    const current = 'Established history. '.repeat(80).trim();
    expect(validateEntityLoreAppend({
      lore: { value: 'She took command of the Seventh Fleet.', support: 'E_1 states it.', evidence: ['E_1'] },
    }, current, evidence)).toEqual({
      value: `${current}\n\nShe took command of the Seventh Fleet.`,
      support: 'E_1 states it.',
      evidence: ['E_1']
    });
    expect(validateEntityLoreAppend({
      lore: { value: 'Established history.', support: 'Repeats it.', evidence: ['E_1'] },
    }, current, evidence)).toBeNull();
    expect(validateEntityLoreAppend({ lore: { value: '', support: '', evidence: [] } }, current, evidence)).toBeNull();
  });

  test('accepts grounded cumulative lore with valid evidence', () => {
    const value = 'Kaelen was a miner and Rowan was his daughter. '.repeat(14);
    expect(validateEntityLore({
      lore: { value, support: 'The cited records establish his history and relationships.', evidence: ['E_1'] },
    }, '', evidence)).toEqual({
      value: value.trim(),
      support: 'The cited records establish his history and relationships.',
      evidence: ['E_1']
    });
  });
});

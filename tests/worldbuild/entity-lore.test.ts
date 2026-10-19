import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildLorePrompt, validateEntityLore, validateEntityLoreAppend } = require('../../src/main/features/worldbuild/entity-lore');
const evidence = new Set(['E_1']);

describe('entity lore validation', () => {
  test('rejects single-event summaries for an empty record', () => {
    const result = validateEntityLore({
      lore: { value: 'Corwin learned a custom in Kesh.', support: 'One passage.', evidence: ['E_1'] },
    }, '', evidence);
    expect(result).toBeNull();
  });

  test('rejects destructive compression of established lore', () => {
    const current = 'Established history. '.repeat(80);
    const result = validateEntityLore({
      lore: { value: 'A short replacement.'.repeat(20), support: 'New passage.', evidence: ['E_1'] },
    }, current, evidence);
    expect(result).toBeNull();
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
    const value = 'Dorian was a miner and Tess’s father. '.repeat(14);
    expect(validateEntityLore({
      lore: { value, support: 'The cited records establish his history and relationships.', evidence: ['E_1'] },
    }, '', evidence)).toEqual({ value: value.trim(), support: 'The cited records establish his history and relationships.', evidence: ['E_1'] });
  });
});

describe('entity lore prompt', () => {
  const prompt = (entityType: string, skillsInUse: boolean) => buildLorePrompt({
    entityName: 'Corwin', entityType, currentLore: '', findings: [], evidence: '', skillsInUse,
  });

  test('keeps the sections a character sheet already has out of the lore', () => {
    expect(prompt('Characters', false)).toContain('physical appearance, clothing, temperament');
    expect(prompt('Characters', false)).not.toContain('fighting style');
    expect(prompt('Characters', true)).toContain('skills, techniques, magic and fighting style');
  });

  test('a type without those sections only gets the writing rules', () => {
    expect(prompt('Locations', true)).not.toContain('Its sheet keeps');
    expect(prompt('Locations', true)).toContain('Never mention documents');
    expect(prompt('Locations', true)).toContain('general traits of its race, species, people or culture');
  });
});

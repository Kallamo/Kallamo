import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { hiddenFields, missingSpoilers, parseSpoilers, stripSpoilerMarkers, withFieldHidden } from '../../src/shared/spoilers';

const require = createRequire(import.meta.url);
const { buildLoreAppendPrompt, buildLorePrompt, buildSpoilerRetryNote } = require('../../src/main/features/worldbuild/entity-lore');

describe('spoiler markers', () => {
  test('split text into plain and hidden spans', () => {
    expect(parseSpoilers('He left. ||He never came back.|| The end.')).toEqual([
      { type: 'text', value: 'He left. ' },
      { type: 'spoiler', value: 'He never came back.' },
      { type: 'text', value: ' The end.' },
    ]);
  });

  test('leave pipes that do not touch text alone', () => {
    expect(stripSpoilerMarkers('a || b || c')).toBe('a || b || c');
    expect(parseSpoilers('a || b || c')).toEqual([{ type: 'text', value: 'a || b || c' }]);
  });

  test('never span two lines', () => {
    expect(stripSpoilerMarkers('||first\nsecond||')).toBe('||first\nsecond||');
  });

  test('strip to the plain text the AI reads', () => {
    expect(stripSpoilerMarkers('Rue is ||not her real name||, and ||she saw it||.')).toBe('Rue is not her real name, and she saw it.');
  });

  test('find spans a rewrite dropped or changed, counting repeats', () => {
    const before = 'A ||one|| B ||two|| C ||one||';
    expect(missingSpoilers(before, 'A ||one|| B ||two|| C ||one|| D')).toEqual([]);
    expect(missingSpoilers(before, 'A ||one|| B two C')).toEqual(['||two||', '||one||']);
    expect(missingSpoilers(before, 'A ||one|| B ||Two|| C ||one||')).toEqual(['||two||']);
  });
});

describe('hidden fields', () => {
  test('are stored on the entity under a key a package keeps', () => {
    const hidden = withFieldHidden({ age: '20' }, 'birthDate', true);
    expect(hidden).toEqual({ age: '20', spoilers: ['birthDate'] });
    expect(hiddenFields(withFieldHidden(hidden, 'birthDate', false))).toEqual([]);
    expect(hiddenFields({ spoilers: 'birthDate' })).toEqual([]);
  });
});

describe('lore prompts', () => {
  const input = { entityName: 'Wren', entityType: 'Characters', currentLore: 'Found ||at seven||.', findings: [], evidence: '' };

  test('teach the model to keep spoilers in both rewrite and append', () => {
    for (const prompt of [buildLorePrompt(input), buildLoreAppendPrompt(input)]) {
      expect(prompt).toContain('between || and || is a spoiler');
      expect(prompt).toContain('Found ||at seven||.');
    }
  });

  test('name each lost spoiler when asking again', () => {
    expect(buildSpoilerRetryNote(['||at seven||'])).toContain('||at seven||');
  });
});

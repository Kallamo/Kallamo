import { describe, expect, test } from 'vitest';
import { buildNameIndex, collectLowercaseWords, findLiteralMentions } from '../../src/main/features/world-index/literal-mentions.js';
import { foldWithMap } from '../../src/main/features/world-index/text-fold.js';

const index = buildNameIndex([
  { id: 'gate', type: 'Locations', canonicalName: 'Harbor Gate' },
  { id: 'harbor', type: 'Locations', canonicalName: 'Harbor' },
  { id: 'kai', type: 'Characters', canonicalName: 'Kai' },
  { id: 'barnaby', type: 'Characters', canonicalName: '바나비' },
  { id: 'ivo', type: 'Characters', canonicalName: 'Ivo' },
  { id: 'elodie', type: 'Characters', canonicalName: 'Élodie' },
  { id: 'order', type: 'Factions', canonicalName: 'Ordem' },
]);

const found = (text: string, options = {}) =>
  findLiteralMentions(text, index, options).map(mention => [mention.entityId, mention.surface]);

describe('literal mentions', () => {
  test('a shorter name inside a longer one of the same kind is a fragment', () => {
    expect(found('They reached the Harbor Gate. Harbor was quiet.'))
      .toEqual([['gate', 'Harbor Gate'], ['harbor', 'Harbor']]);
  });

  test('finds a name written against an unspaced script', () => {
    expect(found('他叫Kai。')).toEqual([['kai', 'Kai']]);
  });

  test('finds a Korean name with an attached particle', () => {
    expect(found('바나비가 왔다')).toEqual([['barnaby', '바나비']]);
  });

  test('skips a name that is half of a hyphenated compound', () => {
    expect(found('The Ivo-born knight met Saint-Ivo and Ivo.')).toEqual([['ivo', 'Ivo']]);
  });

  test('matches across case and optional accents', () => {
    expect(found('ELODIE smiled at Elodie.')).toEqual([['elodie', 'ELODIE'], ['elodie', 'Elodie']]);
  });

  test('a name the text also writes in lowercase counts only away from a sentence start', () => {
    const opening = 'A ordem chegou. Ordem manda.';
    const inside = 'A ordem chegou, disse a Ordem.';
    expect(found(opening, { lowercaseWords: collectLowercaseWords([opening]) })).toEqual([]);
    expect(found(inside, { lowercaseWords: collectLowercaseWords([inside]) })).toEqual([['order', 'Ordem']]);
  });

  test('a folded text passed in gives the same mentions', () => {
    const text = 'They reached the Harbor Gate. Harbor was quiet.';
    expect(found(text, { folded: foldWithMap(text) })).toEqual(found(text));
  });

  test('collects each lowercase word once, folded', () => {
    expect([...collectLowercaseWords(['the Ordem and the ordem', 'Émile saw émile'])])
      .toEqual(['the', 'and', 'ordem', 'saw', 'emile']);
  });
});

import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { chunkContainsEvidence, matchedEvidence, evidenceText } = require('../src/main/features/world-index/evidence-match');

// A line of roleplay prose with everything a model tends to retype differently:
// em dashes, curly quotes and accents.
const CHUNK =
  '— Não tem de que, amigão. — Disse a ele — Aliás, corta essa de “Arquiteto”. ' +
  'Meu nome é Kepler, pode me chamar assim só.';

describe('evidence matching', () => {
  test('accepts an exact quote', () => {
    expect(chunkContainsEvidence(CHUNK, 'Meu nome é Kepler')).toBe(true);
  });

  test('accepts a quote retyped with a plain hyphen', () => {
    expect(chunkContainsEvidence(CHUNK, '- Não tem de que, amigão.')).toBe(true);
  });

  test('accepts a quote retyped with straight or single quotes', () => {
    expect(chunkContainsEvidence(CHUNK, 'corta essa de "Arquiteto"')).toBe(true);
    expect(chunkContainsEvidence(CHUNK, "corta essa de 'Arquiteto'")).toBe(true);
  });

  test('accepts a quote that dropped the accents', () => {
    expect(chunkContainsEvidence(CHUNK, 'Meu nome e Kepler')).toBe(true);
  });

  test('accepts decomposed accents', () => {
    // The same words with the accent stored as a combining mark rather than a
    // precomposed character, which is a different byte sequence from the chunk.
    expect(chunkContainsEvidence(CHUNK, 'Meu nome e Kepler'.normalize('NFD'))).toBe(true);
    expect(chunkContainsEvidence(CHUNK.normalize('NFD'), 'Meu nome e Kepler')).toBe(true);
  });

  test('accepts a quote wrapped in ellipsis', () => {
    expect(chunkContainsEvidence(CHUNK, '…Meu nome é Kepler…')).toBe(true);
  });

  test('accepts several excerpts when one of them is real', () => {
    expect(chunkContainsEvidence(CHUNK, ['Kepler comanda a Vanguarda', 'Meu nome é Kepler'])).toBe(true);
  });

  test('keeps only the excerpt the chunk supports', () => {
    expect(matchedEvidence(CHUNK, ['Kepler comanda a Vanguarda', 'Meu nome é Kepler']))
      .toBe('Meu nome é Kepler');
  });

  test('still rejects an invented quote', () => {
    expect(chunkContainsEvidence(CHUNK, 'Kepler comanda a Vanguarda de Lyren')).toBe(false);
    expect(matchedEvidence(CHUNK, 'Kepler comanda a Vanguarda de Lyren')).toBe('');
  });

  test('rejects empty or meaningless evidence', () => {
    expect(chunkContainsEvidence(CHUNK, '')).toBe(false);
    expect(chunkContainsEvidence(CHUNK, '—')).toBe(false);
    expect(chunkContainsEvidence('', 'Meu nome é Kepler')).toBe(false);
  });

  test('evidenceText keeps what the model sent, for display', () => {
    expect(evidenceText(['one', '', 'two'])).toBe('one two');
    expect(evidenceText('one')).toBe('one');
    expect(evidenceText(null)).toBe('');
  });
});

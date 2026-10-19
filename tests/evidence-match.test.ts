import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { chunkContainsEvidence, matchedEvidence, evidenceText } = require('../src/main/features/world-index/evidence-match');

// A line of roleplay prose with everything a model tends to retype differently:
// em dashes, curly quotes and accents.
const CHUNK =
  '— Don’t mention it, friend. — she told him — And drop the “Master”. ' +
  'My name is Corwin, and this is my café.';

describe('evidence matching', () => {
  test('accepts an exact quote', () => {
    expect(chunkContainsEvidence(CHUNK, 'My name is Corwin')).toBe(true);
  });

  test('accepts a quote retyped with a plain hyphen', () => {
    expect(chunkContainsEvidence(CHUNK, '- Don’t mention it, friend.')).toBe(true);
  });

  test('accepts a quote retyped with straight or single quotes', () => {
    expect(chunkContainsEvidence(CHUNK, 'drop the "Master"')).toBe(true);
    expect(chunkContainsEvidence(CHUNK, "drop the 'Master'")).toBe(true);
  });

  test('accepts a quote that dropped the accents', () => {
    expect(chunkContainsEvidence(CHUNK, 'this is my cafe')).toBe(true);
  });

  test('accepts decomposed accents', () => {
    // The same words with the accent stored as a combining mark rather than a
    // precomposed character, which is a different byte sequence from the chunk.
    expect(chunkContainsEvidence(CHUNK, 'this is my café'.normalize('NFD'))).toBe(true);
    expect(chunkContainsEvidence(CHUNK.normalize('NFD'), 'this is my cafe')).toBe(true);
  });

  test('accepts a quote wrapped in ellipsis', () => {
    expect(chunkContainsEvidence(CHUNK, '…My name is Corwin…')).toBe(true);
  });

  test('accepts several excerpts when one of them is real', () => {
    expect(chunkContainsEvidence(CHUNK, ['Corwin leads the Guard', 'My name is Corwin'])).toBe(true);
  });

  test('keeps only the excerpt the chunk supports', () => {
    expect(matchedEvidence(CHUNK, ['Corwin leads the Guard', 'My name is Corwin']))
      .toBe('My name is Corwin');
  });

  test('still rejects an invented quote', () => {
    expect(chunkContainsEvidence(CHUNK, 'Corwin leads the Guard of Morva')).toBe(false);
    expect(matchedEvidence(CHUNK, 'Corwin leads the Guard of Morva')).toBe('');
  });

  test('rejects empty or meaningless evidence', () => {
    expect(chunkContainsEvidence(CHUNK, '')).toBe(false);
    expect(chunkContainsEvidence(CHUNK, '—')).toBe(false);
    expect(chunkContainsEvidence('', 'My name is Corwin')).toBe(false);
  });

  test('evidenceText keeps what the model sent, for display', () => {
    expect(evidenceText(['one', '', 'two'])).toBe('one two');
    expect(evidenceText('one')).toBe('one');
    expect(evidenceText(null)).toBe('');
  });
});

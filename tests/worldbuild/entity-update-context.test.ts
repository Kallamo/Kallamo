import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { precedingPassageText, relatedCatalogSkills } = require('../../src/main/features/worldbuild/entity-update-context');

describe('preceding passage for list-shaped documents', () => {
  const sheet = 'Document: Cast\nContent: Name: Brann Holt\nRole: Irrigation engineer.\nRelations:';
  const statements = (row: { id: string; text: string } | null) => ({
    byOrdinal: { get: (...args: unknown[]) => (args[3] === 4 ? row : null) },
    byTime: { get: () => row },
  });

  test('shows whose section a relations list continues', () => {
    const chunk = { ownerType: 'document', ownerId: 'doc', source: 'Cast', ordinal: 5, createdAt: 10 };
    expect(precedingPassageText(statements({ id: 'c4', text: sheet }), chunk, new Set()))
      .toBe('«Name: Brann Holt Role: Irrigation engineer. Relations:»');
  });

  test('falls back to write order when the file kept no ordinal', () => {
    const chunk = { ownerType: 'chat_kb', ownerId: 'ws', source: 'Day 8.pdf', ordinal: null, createdAt: 10 };
    expect(precedingPassageText(statements({ id: 'c4', text: sheet }), chunk, new Set())).toContain('Brann Holt');
  });

  test('adds nothing when the passage is already evidence or comes from chat memory', () => {
    const chunk = { ownerType: 'document', ownerId: 'doc', source: 'Cast', ordinal: 5, createdAt: 10 };
    expect(precedingPassageText(statements({ id: 'c4', text: sheet }), chunk, new Set(['c4']))).toBe('');
    expect(precedingPassageText(statements({ id: 'c4', text: sheet }), { ...chunk, ownerType: 'chat_memory' }, new Set())).toBe('');
  });

  test('drops the overlap the passage shares with the start of the evidence', () => {
    const previous = 'Document: Day 8\nContent: The herald reads the names aloud. Seraphina stands alone in the middle of the sand.';
    const chunk = { ownerType: 'chat_kb', ownerId: 'ws', source: 'Day 8', ordinal: null, createdAt: 10, text: 'Document: Day 8\nContent: Seraphina stands alone in the middle of the sand. The crowd falls silent.' };
    expect(precedingPassageText(statements({ id: 'c4', text: previous }), chunk, new Set())).toBe('«The herald reads the names aloud.»');
  });

  test('keeps the start and the end of a long passage', () => {
    const long = `Document: Cast\nContent: Name: Brann Holt. ${'Filler sentence. '.repeat(60)}Relations:`;
    const result = precedingPassageText(statements({ id: 'c4', text: long }), { ownerType: 'document', ownerId: 'doc', source: 'Cast', ordinal: 5, createdAt: 10 }, new Set());
    expect(result.startsWith('«Name: Brann Holt.')).toBe(true);
    expect(result.endsWith('Relations:»')).toBe(true);
    expect(result).toContain(' … ');
  });
});

describe('catalog skills sent with an update', () => {
  const skill = (id: string, name: string, position = 0) => ({ id, name, position, key: id, description: '', parentId: null, status: 'confirmed' });
  const catalog = [
    skill('heavy', 'Heavy Weapons', 1),
    skill('fencing', 'Fencing', 2),
    skill('rapier', 'Rapier', 3),
    skill('mana-a', 'Mana Shaping', 4),
    skill('mana-b', 'Mana Grounding', 5),
    skill('mana-c', 'Mana Flow', 6),
  ];

  test('finds a skill by its name or a rare word, inflected or not', () => {
    const related = relatedCatalogSkills(catalog, new Set(), 'She fights with a rapier and swings a heavy weapon.');
    expect(related.map((entry: { id: string }) => entry.id)).toEqual(['rapier', 'heavy']);
  });

  test('a word many skills share is not enough on its own', () => {
    expect(relatedCatalogSkills(catalog, new Set(), 'His mana flared.')).toEqual([]);
  });

  test('never repeats a skill the character already holds', () => {
    expect(relatedCatalogSkills(catalog, new Set(['rapier']), 'A rapier duel.')).toEqual([]);
  });
});

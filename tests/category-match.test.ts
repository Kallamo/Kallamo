import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildCategoryResolver } = require('../src/main/features/world-index/category-match');

// The categories Kallamo seeds for a new workspace.
const CATEGORIES = [
  { name: 'Characters' },
  { name: 'Factions' },
  { name: 'Items' },
  { name: 'Locations' },
  { name: 'Races' },
  { name: 'Creatures' },
  { name: 'Events' },
  { name: 'System' }
];

const resolve = buildCategoryResolver(CATEGORIES);

describe('category matching', () => {
  test('resolves the exact name', () => {
    expect(resolve('Characters')).toBe('Characters');
    expect(resolve('System')).toBe('System');
  });

  test('resolves the singular a model tends to answer with', () => {
    expect(resolve('Character')).toBe('Characters');
    expect(resolve('Location')).toBe('Locations');
    expect(resolve('Item')).toBe('Items');
    expect(resolve('Creature')).toBe('Creatures');
    expect(resolve('Event')).toBe('Events');
    expect(resolve('Race')).toBe('Races');
  });

  test('resolves a plural of a singular category', () => {
    expect(resolve('Systems')).toBe('System');
  });

  test('ignores casing, spacing and accents', () => {
    expect(resolve('  CHARACTER ')).toBe('Characters');
    expect(resolve('personagens')).toBeNull();
    expect(resolve('Chàracters')).toBe('Characters');
  });

  test('never invents a category the workspace does not have', () => {
    expect(resolve('Personagens')).toBeNull();
    expect(resolve('Places')).toBeNull();
    expect(resolve('Vehicles')).toBeNull();
    expect(resolve('')).toBeNull();
    expect(resolve(null)).toBeNull();
  });

  test('keeps a singular and a plural category distinct from each other', () => {
    const both = buildCategoryResolver([{ name: 'Race' }, { name: 'Races' }]);
    expect(both('Race')).toBe('Race');
    expect(both('Races')).toBe('Races');
  });

  test('resolves custom category names too', () => {
    const custom = buildCategoryResolver([{ name: 'Prophecy' }, { name: 'Deities' }]);
    expect(custom('Prophecies')).toBe('Prophecy');
    expect(custom('Deity')).toBe('Deities');
  });
});

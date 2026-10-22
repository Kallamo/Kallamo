import { describe, expect, test } from 'vitest';
import {
  canonicalSectionId, normalizeTemplateSections, sheetSections, sheetTabs, tabLabel,
  TAB_ORDER, templateSections, TYPE_SECTIONS, variantsOf,
} from '../../src/renderer/features/worldbuild/worldbuildSections.js';

describe('Worldbuild sheet sections', () => {
  test('every declared section belongs to a known tab and has a unique id per type', () => {
    for (const [typeId, sections] of Object.entries(TYPE_SECTIONS)) {
      const ids = sections.map(section => section.id);
      expect(new Set(ids).size, `${typeId} repeats a section id`).toBe(ids.length);
      for (const section of sections) {
        expect(TAB_ORDER, `${typeId}.${section.id} has an unknown tab`).toContain(section.tab);
        expect(section.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('a creature sheet only carries the sections of its own shape', () => {
    const individual = sheetSections('Creatures', 'individual').map(section => section.id);
    const group = sheetSections('Creatures', 'group').map(section => section.id);

    expect(individual).toEqual(['details', 'appearance', 'personality', 'lore', 'inv', 'fac', 'loc', 'rels', 'knowledge']);
    // A species has a shared look worth describing, but no single temperament.
    expect(group).toEqual(['details', 'appearance', 'lore', 'members']);
    expect(variantsOf('Creatures')).toEqual(['individual', 'group']);
    expect(variantsOf('Characters')).toEqual([]);
  });

  test('tabs follow the sections a sheet actually has', () => {
    expect(sheetTabs('Characters', null)).toEqual(['data', 'inventory', 'connections', 'knowledge']);
    expect(sheetTabs('Factions', null)).toEqual(['data', 'connections', 'knowledge']);
    expect(sheetTabs('Events', null)).toEqual(['data', 'occurrences']);
    expect(sheetTabs('Creatures', 'individual')).toEqual(['data', 'inventory', 'connections', 'knowledge']);
    expect(sheetTabs('Creatures', 'group')).toEqual(['data']);
    expect(sheetTabs('Locations', null)).toEqual(['data']);
    // A Region or Area holds what its locals know; a place or a spot has nothing to share.
    expect(sheetTabs('Locations', 'shared')).toEqual(['data', 'knowledge']);
  });

  test('a tab named after its only section reads as that section', () => {
    expect(tabLabel('Creatures', 'individual', 'inventory')).toBe('Inventory');
    // A specific being can belong to a group, so its connections tab holds more than
    // relationships and takes the generic name the character sheet uses.
    expect(tabLabel('Creatures', 'individual', 'connections')).toBe('Connections');
    expect(tabLabel('Characters', null, 'connections')).toBe('Connections');
    expect(tabLabel('Characters', null, 'inventory')).toBe('Inventory');
    expect(tabLabel('Events', null, 'occurrences')).toBe('Occurrences');
  });

  test('only the authored first tab is templatable', () => {
    for (const typeId of Object.keys(TYPE_SECTIONS)) {
      expect(templateSections(typeId).every(section => section.tab === 'data'), typeId).toBe(true);
    }
    expect(templateSections('Characters').map(section => section.id)).toEqual(['identity', 'appearance', 'personality', 'lore']);
    expect(templateSections('Factions').map(section => section.id)).toEqual(['desc', 'lore']);
    expect(templateSections('Creatures').map(section => section.id)).toEqual(['details', 'appearance', 'personality', 'lore', 'members']);
  });

  test('templates saved against the old section ids keep pointing at a real section', () => {
    expect(canonicalSectionId('System', 'content')).toBe('concept');
    expect(canonicalSectionId('Creatures', 'overview')).toBe('details');
    expect(canonicalSectionId('Characters', 'identity')).toBe('identity');
    expect(canonicalSectionId('Locations', 'overview')).toBe('overview');
  });

  test('a stored layout is read through the registry, keeping order and dropping what is no longer templatable', () => {
    const stored = [
      { id: 'overview', label: 'Overview', kind: 'native' as const },
      { id: 'appearance', label: 'Looks', kind: 'native' as const },
      { id: 'inv', label: 'Gear', kind: 'native' as const },
      { id: 'custom-1', label: 'House rules', kind: 'custom' as const },
    ];
    const normalized = normalizeTemplateSections('Creatures', stored);

    // "overview" was the Creature details section under its former id: its place at the
    // top of the sheet survives instead of falling to the end as an unknown section.
    expect(normalized.map(section => section.id)).toEqual(['details', 'appearance', 'custom-1']);
    // It still carried the old editor's default name, so the sheet's own name wins.
    expect(normalized[0]).toMatchObject({ id: 'details', label: 'Details' });
    // A rename the user actually typed is kept.
    expect(normalized[1]).toMatchObject({ id: 'appearance', label: 'Looks' });
    // Inventory is systematic, so a layout that mentions it is ignored rather than obeyed.
    expect(normalized.some(section => section.id === 'inv')).toBe(false);
  });

  test('a deliberate rename of a legacy section survives the migration', () => {
    const [migrated] = normalizeTemplateSections('Creatures', [{ id: 'overview', label: 'Beast profile', kind: 'native' as const }]);
    expect(migrated).toMatchObject({ id: 'details', label: 'Beast profile' });
  });
});

import { describe, expect, test } from 'vitest';
import {
  buildNarrativeOptionPalette,
  resolveNarrativeOptionType
} from '../../src/main/features/worldbuild/narrative-options';

describe('controlled narrative options', () => {
  test('resolves localized category requests', () => {
    expect(resolveNarrativeOptionType('Raças | sentinels in the room')).toBe('Races');
    expect(resolveNarrativeOptionType('NPCs | possible identities')).toBe('Characters');
  });

  test('returns a bounded canon palette without entity dossier identifiers', () => {
    const listEntities = ({ type }: { type: string }) => [
      {
        id: 'race-human-id',
        type,
        canonicalName: 'Human',
        status: 'confirmed',
        data: { description: 'Adaptable people found across the region.' },
        lore: ''
      },
      {
        id: 'draft',
        type,
        canonicalName: 'Draft Race',
        status: 'proposed',
        data: {},
        lore: ''
      }
    ];

    const palette = buildNarrativeOptionPalette({
      workspaceId: 'workspace-one',
      query: 'Races | unnamed sentinels',
      listEntities
    });

    expect(palette).toMatchObject({
      type: 'Races',
      count: 1,
      source: 'Worldbuild options - Races'
    });
    expect(palette.content).toContain('- Human: Adaptable people found across the region.');
    expect(palette.content).not.toContain('race-human-id');
    expect(palette.content).not.toContain('Draft Race');
  });
});

import { describe, expect, test } from 'vitest';
import { firstFillFields } from '../../src/main/features/worldbuild/first-fill.js';

const field = (id: string, key: string, extra: Record<string, unknown> = {}) => ({ id, key, label: key, aiAccess: 'read-write', ...extra });

describe('What a new sheet is filled with at once', () => {
  test('a character gets its identity: status, gender and age, and the fields placed in identity or nowhere', () => {
    const fields = firstFillFields(
      { type: 'Characters', data: {} },
      {
        allowedNative: ['status', 'gender', 'age', 'appearance', 'personality'],
        customDefinitions: [field('f1', 'insightful'), field('f2', 'voice'), field('f3', 'title')],
        layout: { fieldSections: { f1: 'identity', f2: 'personality' } }
      }
    );
    expect(fields.native).toEqual(['status', 'gender', 'age']);
    expect(fields.custom.map(item => item.key)).toEqual(['insightful', 'title']);
  });

  test('what the sheet already holds is not asked again; an unknown state and a default value are', () => {
    const fields = firstFillFields(
      { type: 'Characters', data: { status: 'unknown', gender: 'Female', customFields: { insightful: 'no', rank: 'Captain' } } },
      {
        allowedNative: ['status', 'gender', 'age'],
        customDefinitions: [field('f1', 'insightful', { hasDefault: true, defaultValue: 'no' }), field('f2', 'rank')]
      }
    );
    expect(fields.native).toEqual(['status', 'age']);
    expect(fields.custom.map(item => item.key)).toEqual(['insightful']);
  });

  test('an item gets its details but never its description, and a field the AI may not write stays out', () => {
    const fields = firstFillFields(
      { type: 'Items', data: {} },
      {
        allowedNative: ['itemType', 'abundance', 'description'],
        customDefinitions: [field('f1', 'rarity'), field('f2', 'secret', { aiAccess: 'read-only' })],
        layout: { fieldSections: { f1: 'details', f2: 'details' } }
      }
    );
    expect(fields.native).toEqual(['itemType', 'abundance']);
    expect(fields.custom.map(item => item.key)).toEqual(['rarity']);
  });

  test('a species gets its details, a faction only the fields placed with its description, a system nothing', () => {
    expect(firstFillFields({ type: 'Creatures', data: { scope: 'group' } }, { allowedNative: ['nature', 'abundance', 'threat', 'abilities', 'appearance'] }).native)
      .toEqual(['nature', 'abundance', 'threat', 'abilities']);
    const faction = firstFillFields({ type: 'Factions', data: {} }, {
      allowedNative: ['description'],
      customDefinitions: [field('f1', 'motto'), field('f2', 'seat')],
      layout: { fieldSections: { f1: 'desc', f2: 'lore' } }
    });
    expect(faction).toEqual({ native: [], custom: [expect.objectContaining({ key: 'motto' })] });
    expect(firstFillFields({ type: 'System', data: {} }, { allowedNative: ['content'] })).toEqual({ native: [], custom: [] });
  });
});

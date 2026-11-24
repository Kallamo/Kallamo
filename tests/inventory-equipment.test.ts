import { describe, expect, test } from 'vitest';

const { isUnchangedEquipment } = require('../src/main/features/narrative/inventory-equipment');

const inventory = [
  { itemId: 'sword', holderId: 'hero', equipped: true },
  { itemId: 'shield', holderId: 'hero', equipped: false },
];

describe('isUnchangedEquipment', () => {
  test('drops an equip that restates the current state', () => {
    expect(isUnchangedEquipment({ itemId: 'sword', holderId: 'hero', equipped: true }, inventory)).toBe(true);
    expect(isUnchangedEquipment({ itemId: 'shield', holderId: 'hero', equipped: false }, inventory)).toBe(true);
  });

  test('keeps a real equip or unequip', () => {
    expect(isUnchangedEquipment({ itemId: 'sword', holderId: 'hero', equipped: false }, inventory)).toBe(false);
    expect(isUnchangedEquipment({ itemId: 'shield', holderId: 'hero', equipped: true }, inventory)).toBe(false);
  });

  test('keeps transfers and items the holder does not carry', () => {
    expect(isUnchangedEquipment({ itemId: 'sword', fromHolderId: 'hero', toHolderId: 'ally', holderId: 'hero', equipped: true }, inventory)).toBe(false);
    expect(isUnchangedEquipment({ itemId: 'sword', holderId: 'ally', equipped: true }, inventory)).toBe(false);
    expect(isUnchangedEquipment({ itemId: 'sword', holderId: 'hero' }, inventory)).toBe(false);
  });
});

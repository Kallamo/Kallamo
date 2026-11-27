import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { insertEntity, openEntityStore, type EntityStoreHarness } from './entity-store-harness';

describe('item links follow the nature on the sheet', () => {
  let harness: EntityStoreHarness;
  const relTypes = () => harness.db.prepare("SELECT relType FROM entity_links WHERE fromId = 'dish' ORDER BY relType").all().map((row: any) => row.relType);

  beforeEach(() => {
    harness = openEntityStore();
    insertEntity(harness.db, 'dish', { type: 'Items', data: { itemNature: 'unique' } });
    insertEntity(harness.db, 'tavern', { type: 'Locations' });
    insertEntity(harness.db, 'cook', { type: 'Characters' });
  });

  afterEach(() => harness.close());

  test('an unsaved switch to item type accepts where found and sold', () => {
    expect(() => harness.store.setLink({ workspaceId: 'ws', fromId: 'dish', relType: 'found_in', toId: 'tavern' })).toThrow();
    harness.store.setLink({ workspaceId: 'ws', fromId: 'dish', relType: 'found_in', toId: 'tavern', itemNature: 'type' });
    harness.store.setLink({ workspaceId: 'ws', fromId: 'dish', relType: 'sold_in', toId: 'tavern', itemNature: 'type' });
    expect(relTypes()).toEqual(['found_in', 'sold_in']);
  });

  test('saving a new nature carries over the links that have a match', () => {
    harness.store.setLink({ workspaceId: 'ws', fromId: 'dish', relType: 'owned_by', toId: 'cook' });
    harness.store.updateEntity('dish', { data: { itemNature: 'type' } });
    expect(relTypes()).toEqual(['carried_by']);

    harness.store.setLink({ workspaceId: 'ws', fromId: 'dish', relType: 'sold_in', toId: 'tavern' });
    harness.store.updateEntity('dish', { data: { itemNature: 'unique' } });
    expect(relTypes()).not.toContain('sold_in');
  });
});

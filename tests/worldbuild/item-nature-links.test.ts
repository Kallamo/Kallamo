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
    expect(relTypes()).toEqual(['owned_by']);
  });

  test('a type held in several inventories keeps only its first holder as a unique item', () => {
    harness.store.updateEntity('dish', { data: { itemNature: 'type' } });
    insertEntity(harness.db, 'baker', { type: 'Characters' });
    const insert = harness.db.prepare("INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, metadata_json, createdAt) VALUES (?, 'ws', 'dish', 'carried_by', ?, '{\"quantity\":3}', ?)");
    insert.run('first', 'cook', 1);
    insert.run('second', 'baker', 2);
    harness.store.updateEntity('dish', { data: { itemNature: 'unique' } });
    const rows = harness.db.prepare("SELECT relType, toId, metadata_json FROM entity_links WHERE fromId = 'dish'").all() as any[];
    expect(rows.map(row => [row.relType, row.toId])).toEqual([['owned_by', 'cook']]);
    expect(JSON.parse(rows[0].metadata_json).quantity).toBe(1);
  });
});

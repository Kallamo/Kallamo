import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { describeWorldChanges } from '../../src/renderer/features/worldbuild/worldChanges';
import { insertEntity, openEntityStore, type EntityStoreHarness } from './entity-store-harness';

const require = createRequire(import.meta.url);
const { editedParts, recordSheetEdit, listWorldChanges } = require('../../src/main/features/worldbuild/world-changes.js');

let harness: EntityStoreHarness;
beforeEach(() => { harness = openEntityStore(); });
afterEach(() => harness.close());

const run = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).run(...params);

function inventoryChange(id: string, patch: object, { status = 'applied', source = 'ai', provenance = 'turn-1', at = 1000 } = {}) {
  run(`INSERT INTO roleplay_inventory_changes (workspace_id, change_id, payload_json, status, source, provenance_id, created_at)
    VALUES ('w1', ?, ?, ?, ?, ?, ?)`, id, JSON.stringify(patch), status, source, provenance, at);
}

describe('recording sheet edits', () => {
  test('names the parts that changed and skips sheet settings', () => {
    const before = { canonicalName: 'Gold Crown', aliases: [], lore: '', data: { description: 'A coin.', aiPolicy: 'review', spoilers: {} } };
    const after = { canonicalName: 'Gold Crown', aliases: ['crown'], lore: '', data: { description: 'A heavy coin.', aiPolicy: 'locked', spoilers: { description: true }, customFields: { mint: 'Crownmoor' } } };
    expect(editedParts(before, after)).toEqual(['aliases', 'description', 'customFields.mint']);
  });

  test('folds edits close together into one, and starts a new one later', () => {
    recordSheetEdit(harness.db, { workspaceId: 'w1', entityId: 'e1', parts: ['description'], now: 1000 });
    recordSheetEdit(harness.db, { workspaceId: 'w1', entityId: 'e1', parts: ['appearance'], now: 2000 });
    recordSheetEdit(harness.db, { workspaceId: 'w1', entityId: 'e1', parts: ['age'], now: 2000 + 11 * 60 * 1000 });
    const edits = harness.db.prepare('SELECT fields_json FROM entity_sheet_edits ORDER BY created_at').all() as any[];
    expect(edits.map(edit => JSON.parse(edit.fields_json))).toEqual([['description', 'appearance'], ['age']]);
  });

  test('records nothing when nothing changed', () => {
    recordSheetEdit(harness.db, { workspaceId: 'w1', entityId: 'e1', parts: [] });
    expect(harness.db.prepare('SELECT COUNT(*) AS total FROM entity_sheet_edits').get()).toEqual({ total: 0 });
  });
});

describe('listing recent world changes', () => {
  test('merges sources newest first and leaves out rejected and seeded changes', () => {
    inventoryChange('kept', { itemId: 'coin', fromHolderId: 'a', toHolderId: 'b' }, { at: 3000 });
    inventoryChange('rejected', { itemId: 'coin' }, { status: 'rejected', at: 4000 });
    inventoryChange('seeded', { itemId: 'coin' }, { provenance: 'onboarding', at: 5000 });
    recordSheetEdit(harness.db, { workspaceId: 'w1', entityId: 'square', parts: ['description'], now: 2000 });
    run(`INSERT INTO roleplay_message_frames (workspace_id, origin_id, start_json, end_json, created_at, updated_at) VALUES ('w1', 'turn-0', '{}', '{}', 1, 1), ('w1', 'turn-1', '{}', '{}', 2, 2)`);

    const changes = listWorldChanges(harness.db, 'w1');
    expect(changes.map((change: any) => [change.kind, change.id, change.source, change.turnNumber])).toEqual([
      ['inventory', 'kept', 'turn', 2],
      ['edit', expect.any(String), 'you', null],
    ]);
  });

  test('groups one Update entities write into a single row', () => {
    const origin = (target: string, kind = 'field') => run(`INSERT INTO entity_update_origins
      (workspace_id, change_id, entity_id, kind, target, previous_json, next_json, applied_by, created_at)
      VALUES ('w1', ?, 'inn', ?, ?, NULL, '{}', 'review', 7000)`, `${kind}:${target}`, kind, target);
    origin('description');
    origin('lore', 'lore');
    origin('link-1', 'link');
    const [update] = listWorldChanges(harness.db, 'w1');
    expect(update).toMatchObject({ kind: 'update', entityId: 'inn', source: 'ai', detail: { parts: ['description', 'lore'], links: 1 } });
  });

  test('stays out of other workspaces', () => {
    inventoryChange('kept', { itemId: 'coin', toHolderId: 'b' });
    expect(listWorldChanges(harness.db, 'w2')).toEqual([]);
  });
});

describe('describing recent world changes', () => {
  const entities = [
    { id: 'coin', type: 'Items', canonicalName: 'Gold Crown', data: { itemType: 'Currency' } },
    { id: 'tonic', type: 'Items', canonicalName: 'Emberleaf Tonic', data: { itemType: 'Consumable' } },
    { id: 'rhona', type: 'Characters', canonicalName: 'Rhona Dunmore', data: {} },
    { id: 'edwin', type: 'Characters', canonicalName: 'Edwin Hale', data: {} },
    { id: 'square', type: 'Locations', canonicalName: 'Market Square', data: {} },
  ];
  const inventory = (patch: object) => ({ id: 'c', kind: 'inventory', entityId: (patch as any).itemId, status: 'applied', source: 'turn', turnNumber: 4, createdAt: 1, detail: { patch } });

  test('names each inventory move', () => {
    const rows = describeWorldChanges([
      inventory({ itemId: 'coin', fromHolderId: 'rhona', toHolderId: 'edwin', quantity: 2 }),
      inventory({ itemId: 'coin', fromLocationId: 'square', toHolderId: 'edwin' }),
      inventory({ itemId: 'coin', fromHolderId: 'edwin', locationId: 'square' }),
      inventory({ itemId: 'tonic', fromHolderId: 'rhona' }),
      inventory({ itemId: 'coin', fromHolderId: 'rhona' }),
      inventory({ itemId: 'coin', holderId: 'rhona', equipped: true }),
    ], entities);
    expect(rows.map(row => [row.label, row.text])).toEqual([
      ['Handed over', '2 × Gold Crown moved from Rhona Dunmore to Edwin Hale.'],
      ['Picked up', 'Gold Crown moved from Market Square to Edwin Hale.'],
      ['Dropped', 'Gold Crown moved from Edwin Hale to Market Square.'],
      ['Used up', 'Emberleaf Tonic removed from Rhona Dunmore.'],
      ['Lost', 'Gold Crown removed from Rhona Dunmore.'],
      ['Equipped', 'Gold Crown equipped by Rhona Dunmore.'],
    ]);
    expect(rows[0].sourceLabel).toBe('Turn 4');
  });

  test('lists edited parts by their sheet names', () => {
    const [edit] = describeWorldChanges([
      { id: 'e', kind: 'edit', entityId: 'square', status: 'applied', source: 'you', turnNumber: null, createdAt: 1, detail: { parts: ['description', 'canonicalName', 'itemNature', 'customFields.market_day'] } },
    ], entities);
    expect(edit).toMatchObject({ label: 'Edited', text: 'Description, Name and 2 more edited.', sourceLabel: 'You' });
  });

  test('drops changes to entities that are gone', () => {
    expect(describeWorldChanges([inventory({ itemId: 'missing', toHolderId: 'rhona' })], entities)).toEqual([]);
  });
});

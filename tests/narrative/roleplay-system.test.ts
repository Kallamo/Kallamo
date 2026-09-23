import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { RoleplaySystem } from '../../src/main/features/narrative/roleplay-system';
import { openTestDatabase } from '../sqlite-test-database';

describe('Kallamo roleplay system', () => {
  let directory: string;
  let db: Database.Database;
  let roleplay: RoleplaySystem;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-roleplay-'));
    db = openTestDatabase(join(directory, 'roleplay.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        canonicalName TEXT NOT NULL, data TEXT, status TEXT NOT NULL
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    seedEntities();
    roleplay = new RoleplaySystem(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('stores workspace roleplay identity, scenario, and default update policy', () => {
    const settings = roleplay.saveSettings('workspace-one', {
      playerEntityId: 'elias', locationEntityId: 'gate', scenarioName: 'Siege at Dawn',
      defaultUpdatePolicy: 'review'
    });

    expect(settings).toMatchObject({
      workspaceId: 'workspace-one', playerEntityId: 'elias', locationEntityId: 'gate',
      scenarioName: 'Siege at Dawn', defaultUpdatePolicy: 'review'
    });
    expect(roleplay.getSettings('workspace-two').defaultUpdatePolicy).toBe('review');
  });

  test('inherits a resource from race and permits an entity override', () => {
    const health = roleplay.saveDefinition('workspace-one', {
      name: 'Health', key: 'health', color: '#dc2626', minimum: 0,
      maximum: 100, initialValue: 100, appliesTo: ['Characters', 'Creatures'],
      updatePolicy: 'review'
    });
    roleplay.setTargetValue('workspace-one', health.id, 'race', 'human', { current: 120, maximum: 120 });

    expect(roleplay.listEntityResources('workspace-one', 'elias')[0]).toMatchObject({
      definitionId: health.id, current: 120, maximum: 120, inheritedFrom: 'human'
    });

    roleplay.setTargetValue('workspace-one', health.id, 'entity', 'elias', { current: 80, maximum: 100 });
    expect(roleplay.listEntityResources('workspace-one', 'elias')[0]).toMatchObject({
      current: 80, maximum: 100, inheritedFrom: null
    });
  });

  test('supports species defaults and independent values for individual creatures', () => {
    const stamina = roleplay.saveDefinition('workspace-one', {
      name: 'Stamina', key: 'stamina', color: '#16a34a', minimum: 0,
      maximum: 60, initialValue: 60, appliesTo: ['Creatures'], updatePolicy: 'manual'
    });
    roleplay.setTargetValue('workspace-one', stamina.id, 'species', 'wolves', { current: 75, maximum: 75 });
    roleplay.linkEntitySpecies('workspace-one', 'wolf-one', 'wolves');

    expect(roleplay.listEntityResources('workspace-one', 'wolf-one')[0]).toMatchObject({
      current: 75, maximum: 75, inheritedFrom: 'wolves'
    });
    roleplay.setTargetValue('workspace-one', stamina.id, 'entity', 'wolf-one', { current: 30, maximum: 75 });
    expect(roleplay.listEntityResources('workspace-one', 'wolf-one')[0].current).toBe(30);
  });

  test('review changes remain pending until explicitly resolved', () => {
    const health = createHealth('review');
    roleplay.setTargetValue('workspace-one', health.id, 'entity', 'elias', { current: 100, maximum: 100 });

    const change = roleplay.proposeChange({
      id: 'change-one', workspaceId: 'workspace-one', definitionId: health.id,
      entityId: 'elias', value: 80, source: 'ai', provenanceId: 'message-one'
    });

    expect(change.status).toBe('pending');
    expect(roleplay.listEntityResources('workspace-one', 'elias')[0].current).toBe(100);
    roleplay.resolveChange('workspace-one', change.id, 'approved');
    expect(roleplay.listEntityResources('workspace-one', 'elias')[0].current).toBe(80);
  });

  test('automatic changes apply once while manual resources reject AI proposals', () => {
    const automatic = createHealth('automatic');
    roleplay.setTargetValue('workspace-one', automatic.id, 'entity', 'elias', { current: 100, maximum: 100 });
    const input = {
      id: 'change-auto', workspaceId: 'workspace-one', definitionId: automatic.id,
      entityId: 'elias', value: 70, source: 'ai' as const, provenanceId: 'message-auto'
    };

    expect(roleplay.proposeChange(input).status).toBe('applied');
    expect(roleplay.proposeChange(input).status).toBe('applied');
    expect(roleplay.listEntityResources('workspace-one', 'elias')[0].current).toBe(70);

    const manual = roleplay.saveDefinition('workspace-one', {
      name: 'Mana', key: 'mana', color: '#2563eb', minimum: 0, maximum: 40,
      initialValue: 40, appliesTo: ['Characters'], updatePolicy: 'manual'
    });
    expect(() => roleplay.proposeChange({ ...input, id: 'manual-ai', definitionId: manual.id }))
      .toThrow('manual-only');
  });

  test('clamps values, preserves history, and isolates workspaces', () => {
    const health = createHealth('automatic');
    roleplay.setTargetValue('workspace-one', health.id, 'entity', 'elias', { current: 100, maximum: 100 });
    roleplay.proposeChange({
      id: 'overkill', workspaceId: 'workspace-one', definitionId: health.id,
      entityId: 'elias', value: -50, source: 'manual', provenanceId: 'configuration'
    });

    expect(roleplay.listEntityResources('workspace-one', 'elias')[0].current).toBe(0);
    expect(roleplay.listChanges('workspace-one', 'elias')).toEqual([
      expect.objectContaining({ previousValue: 100, nextValue: 0, status: 'applied' })
    ]);
    expect(roleplay.listChanges('workspace-two', 'elias')).toEqual([]);
  });

  test('extracts hidden AI state metadata without exposing it in narrative text', () => {
    const health = createHealth('automatic');
    roleplay.setTargetValue('workspace-one', health.id, 'entity', 'elias', { current: 100, maximum: 100 });

    const processed = roleplay.processAiResponse(
      'workspace-one', 'message-state',
      'The blade catches Elias across the shoulder.\n<!-- KALLAMO_ROLEPLAY_CHANGES [{"entityId":"elias","resourceKey":"health","value":82}] -->'
    );

    expect(processed.content).toBe('The blade catches Elias across the shoulder.');
    expect(processed.changes).toEqual([expect.objectContaining({ nextValue: 82, status: 'applied' })]);
    expect(roleplay.listEntityResources('workspace-one', 'elias')[0].current).toBe(82);
  });

  test('stores an active scene with participants, observers, and separate object presence', () => {
    roleplay.saveSettings('workspace-one', { playerEntityId: 'elias', defaultUpdatePolicy: 'review' });
    const scene = roleplay.saveScene('workspace-one', {
      locationId: 'gate', participantIds: ['elias', 'mara'],
      possibleObserverIds: ['mara'], objectIds: ['sword']
    });

    expect(scene).toMatchObject({
      locationId: 'gate', participantIds: ['elias', 'mara'],
      possibleObserverIds: [], objectIds: ['sword'],
      perspective: { access: 'subjective', focalSubjectId: 'elias' }
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM entity_links WHERE relType = 'owned_by'").get())
      .toEqual({ count: 0 });
    roleplay.saveSettings('workspace-one', { playerEntityId: 'mara' });
    expect(roleplay.getScene('workspace-one')?.perspective).toEqual({ access: 'subjective', focalSubjectId: 'mara' });
    expect(roleplay.getScene('workspace-one')?.participantIds).toEqual(['mara', 'elias']);
  });

  test('keeps the player in the scene and clears unsupported presence on location changes', () => {
    roleplay.saveSettings('workspace-one', { playerEntityId: 'elias' });
    roleplay.saveScene('workspace-one', { locationId: 'gate', participantIds: ['mara'], possibleObserverIds: ['elias'], objectIds: ['sword'] });
    expect(roleplay.getScene('workspace-one')).toMatchObject({ participantIds: ['elias', 'mara'], possibleObserverIds: [] });

    db.prepare("INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES ('tower', 'workspace-one', 'Locations', 'Tower', '{}', 'confirmed')").run();
    roleplay.saveScene('workspace-one', { locationId: 'tower' });
    expect(roleplay.getScene('workspace-one')).toMatchObject({ participantIds: ['elias'], possibleObserverIds: [], objectIds: [] });
  });

  test('stores nearby presence separately from participants and observers', () => {
    roleplay.saveSettings('workspace-one', { playerEntityId: 'elias' });
    const scene = roleplay.saveScene('workspace-one', {
      locationId: 'gate',
      participantIds: ['mara'],
      possibleObserverIds: [],
      nearbyIds: ['wolf-one']
    });

    expect(scene).toMatchObject({
      participantIds: ['elias', 'mara'],
      possibleObserverIds: [],
      nearbyIds: ['wolf-one']
    });
    roleplay.saveScene('workspace-one', { possibleObserverIds: ['wolf-one'], nearbyIds: ['wolf-one'] });
    expect(roleplay.getScene('workspace-one')).toMatchObject({
      possibleObserverIds: ['wolf-one'],
      nearbyIds: []
    });
  });

  test('inherits the nearest Location background through Inside links', () => {
    db.prepare("INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES ('kingdom', 'workspace-one', 'Locations', 'Kingdom', '{}', 'confirmed')").run();
    db.prepare("INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES ('tavern', 'workspace-one', 'Locations', 'Tavern', '{}', 'confirmed')").run();
    db.prepare("INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES ('room', 'workspace-one', 'Locations', 'Room', '{}', 'confirmed')").run();
    db.prepare("INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, createdAt) VALUES ('tavern-inside', 'workspace-one', 'tavern', 'inside', 'kingdom', 1)").run();
    db.prepare("INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, createdAt) VALUES ('room-inside', 'workspace-one', 'room', 'inside', 'tavern', 1)").run();

    roleplay.setLocationBackground('workspace-one', 'kingdom', 'C:\\art\\kingdom.png');
    expect(roleplay.getLocationBackground('workspace-one', 'room')).toEqual({
      locationId: 'room',
      imagePath: 'C:\\art\\kingdom.png',
      sourceLocationId: 'kingdom',
      inherited: true
    });

    roleplay.setLocationBackground('workspace-one', 'tavern', 'C:\\art\\tavern.png');
    expect(roleplay.getLocationBackground('workspace-one', 'room')).toMatchObject({
      imagePath: 'C:\\art\\tavern.png',
      sourceLocationId: 'tavern',
      inherited: true
    });
  });

  test('reviews atomic unique-item movement and quantity-bearing item-type transfers', () => {
    roleplay.saveSettings('workspace-one', { defaultUpdatePolicy: 'review' });
    db.prepare("INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, metadata_json, createdAt) VALUES ('owner-sword', 'workspace-one', 'unique-sword', 'owned_by', 'elias', '{\"quantity\":1}', 1)").run();
    db.prepare("INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, metadata_json, createdAt) VALUES ('potions-elias', 'workspace-one', 'potion', 'carried_by', 'elias', '{\"quantity\":3}', 1)").run();

    const unique = roleplay.proposeInventoryChange({
      id: 'move-sword', workspaceId: 'workspace-one', source: 'ai',
      patch: { itemId: 'unique-sword', fromHolderId: 'elias', toHolderId: 'mara' }
    });
    expect(unique.status).toBe('pending');
    roleplay.resolveInventoryChange('workspace-one', unique.id, 'approved');
    expect(db.prepare("SELECT toId FROM entity_links WHERE fromId = 'unique-sword' AND relType = 'owned_by'").all()).toEqual([{ toId: 'mara' }]);

    const quantity = roleplay.proposeInventoryChange({
      id: 'give-potion', workspaceId: 'workspace-one', source: 'ai',
      patch: { itemId: 'potion', fromHolderId: 'elias', toHolderId: 'mara', quantity: 1 }
    });
    roleplay.resolveInventoryChange('workspace-one', quantity.id, 'approved');
    const rows = db.prepare("SELECT toId, metadata_json FROM entity_links WHERE fromId = 'potion' AND relType = 'carried_by' ORDER BY toId").all() as Array<{ toId: string; metadata_json: string }>;
    expect(rows.map(row => ({ holder: row.toId, quantity: JSON.parse(row.metadata_json).quantity }))).toEqual([
      { holder: 'elias', quantity: 2 }, { holder: 'mara', quantity: 1 }
    ]);
  });

  test('tracks equipment and permits dropping item quantities at a Location', () => {
    roleplay.saveSettings('workspace-one', { defaultUpdatePolicy: 'automatic' });
    db.prepare("INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, metadata_json, createdAt) VALUES ('potions-elias', 'workspace-one', 'potion', 'carried_by', 'elias', '{\"quantity\":3}', 1)").run();

    expect(roleplay.setEquipped('workspace-one', 'elias', 'potion', true)[0]).toMatchObject({
      itemId: 'potion',
      quantity: 3,
      equipped: true
    });
    roleplay.proposeInventoryChange({
      id: 'unequip-potions',
      workspaceId: 'workspace-one',
      source: 'ai',
      patch: { itemId: 'potion', holderId: 'elias', equipped: false }
    });
    expect(roleplay.listInventory('workspace-one', 'elias')[0]).toMatchObject({ quantity: 3, equipped: false });
    roleplay.setEquipped('workspace-one', 'elias', 'potion', true);
    roleplay.proposeInventoryChange({
      id: 'drop-potions',
      workspaceId: 'workspace-one',
      source: 'manual',
      patch: { itemId: 'potion', fromHolderId: 'elias', locationId: 'gate', quantity: 2, equipped: false }
    });

    expect(roleplay.listInventory('workspace-one', 'elias')[0]).toMatchObject({ quantity: 1, equipped: false });
    expect(db.prepare("SELECT quantity FROM roleplay_location_inventory WHERE workspace_id = 'workspace-one' AND location_id = 'gate' AND item_id = 'potion'").get())
      .toEqual({ quantity: 2 });
    roleplay.proposeInventoryChange({
      id: 'pick-up-potions',
      workspaceId: 'workspace-one',
      source: 'manual',
      patch: { itemId: 'potion', fromLocationId: 'gate', toHolderId: 'elias', quantity: 2 }
    });
    expect(roleplay.listInventory('workspace-one', 'elias')[0]).toMatchObject({ quantity: 3 });
    expect(db.prepare("SELECT quantity FROM roleplay_location_inventory WHERE workspace_id = 'workspace-one' AND location_id = 'gate' AND item_id = 'potion'").get())
      .toBeUndefined();
  });

  test('consolidates duplicate inventory relations by item identity without merging different items by name', () => {
    db.prepare("INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES ('unique-sword-copy', 'workspace-one', 'Items', 'Moonblade', ?, 'confirmed')")
      .run(JSON.stringify({ itemNature: 'unique', itemType: 'Weapon' }));
    const insert = db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, metadata_json, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insert.run('unique-sword-a', 'workspace-one', 'unique-sword', 'owned_by', 'elias', '{"quantity":1}', 1);
    insert.run('unique-sword-b', 'workspace-one', 'unique-sword', 'owned_by', 'elias', '{"quantity":1}', 2);
    insert.run('unique-copy', 'workspace-one', 'unique-sword-copy', 'owned_by', 'elias', '{"quantity":1}', 3);
    insert.run('potions-a', 'workspace-one', 'potion', 'carried_by', 'elias', '{"quantity":2}', 4);
    insert.run('potions-b', 'workspace-one', 'potion', 'carried_by', 'elias', '{"quantity":3}', 5);

    expect(roleplay.listInventory('workspace-one', 'elias')).toEqual([
      expect.objectContaining({ itemId: 'potion', quantity: 5 }),
      expect.objectContaining({ itemId: 'unique-sword', name: 'Moonblade', quantity: 1 }),
      expect.objectContaining({ itemId: 'unique-sword-copy', name: 'Moonblade', quantity: 1 })
    ]);
  });

  test('reviews AI scene changes and applies batch resource assignments', () => {
    roleplay.saveSettings('workspace-one', { playerEntityId: 'elias', defaultUpdatePolicy: 'review' });
    roleplay.saveScene('workspace-one', { participantIds: ['elias'] });
    const sceneChange = roleplay.proposeSceneChange({
      id: 'scene-change', workspaceId: 'workspace-one', source: 'ai',
      provenanceId: 'message-scene', patch: { locationId: 'gate', participantIds: ['elias', 'mara'] }
    });
    expect(sceneChange.status).toBe('pending');
    expect(roleplay.getScene('workspace-one')?.participantIds).toEqual(['elias']);
    roleplay.resolveSceneChange('workspace-one', sceneChange.id, 'approved');
    expect(roleplay.getScene('workspace-one')).toMatchObject({ locationId: 'gate', participantIds: ['elias', 'mara'] });

    const health = createHealth('review');
    roleplay.setTargetValues('workspace-one', health.id, 'entity', ['elias', 'mara'], { current: 70, maximum: 100 });
    expect(roleplay.listAssignments('workspace-one')).toHaveLength(2);
  });

  test('deletes a resource together with its value history', () => {
    const health = createHealth('automatic');
    roleplay.proposeChange({
      id: 'history-entry', workspaceId: 'workspace-one', definitionId: health.id,
      entityId: 'elias', value: 75, source: 'manual'
    });

    expect(() => roleplay.deleteDefinition('workspace-one', health.id)).not.toThrow();
    expect(roleplay.listDefinitions('workspace-one')).toEqual([]);
    expect(roleplay.listChanges('workspace-one')).toEqual([]);
  });

  function createHealth(updatePolicy: 'manual' | 'review' | 'automatic') {
    return roleplay.saveDefinition('workspace-one', {
      name: 'Health', key: 'health', color: '#dc2626', minimum: 0,
      maximum: 100, initialValue: 100, appliesTo: ['Characters'], updatePolicy
    });
  }

  function seedEntities() {
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('elias', 'workspace-one', 'Characters', 'Elias', '{}', 'confirmed');
    insert.run('mara', 'workspace-one', 'Characters', 'Mara', '{}', 'confirmed');
    insert.run('human', 'workspace-one', 'Races', 'Human', '{}', 'confirmed');
    insert.run('gate', 'workspace-one', 'Locations', 'Northern Gate', '{}', 'confirmed');
    insert.run('sword', 'workspace-one', 'Items', 'Iron Sword', '{}', 'confirmed');
    insert.run('unique-sword', 'workspace-one', 'Items', 'Moonblade', JSON.stringify({ itemNature: 'unique', itemType: 'Weapon' }), 'confirmed');
    insert.run('potion', 'workspace-one', 'Items', 'Healing Potion', JSON.stringify({ itemNature: 'type', itemType: 'Consumable' }), 'confirmed');
    insert.run('wolf-one', 'workspace-one', 'Creatures', 'Ash Wolf', JSON.stringify({ scope: 'individual' }), 'confirmed');
    insert.run('wolves', 'workspace-one', 'Creatures', 'Ash Wolves', JSON.stringify({ scope: 'group' }), 'confirmed');
    db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId) VALUES (?, ?, ?, ?, ?)')
      .run('race-elias', 'workspace-one', 'elias', 'is_race', 'human');
  }
});

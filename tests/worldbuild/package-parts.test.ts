import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { EventOccurrenceService } from '../../src/main/features/worldbuild/event-occurrences';
import * as calendarService from '../../src/main/features/worldbuild/calendar-service.js';
import { openEntityStore, type EntityStoreHarness } from './entity-store-harness';

const require = createRequire(import.meta.url);
const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');
const parts = require('../../src/main/features/worldbuild/package-parts.js');

let harness: EntityStoreHarness;
let worldbuild: any;
beforeEach(() => {
  harness = openEntityStore();
  worldbuild = createWorldbuildDataService(harness.db);
});
afterEach(() => harness.close());

const make = (workspaceId: string, name: string, type = 'Characters') => harness.store.createEntity({ workspaceId, type, canonicalName: name }).id;
const portable = (value: unknown) => JSON.parse(JSON.stringify(value));
const writing = (db: any) => ({
  createFolder: ({ workspaceId, name }: any) => {
    const id = `folder-${name}`;
    db.prepare('INSERT INTO folders (id, workspaceId, name, parentId, position, createdAt, last_modified) VALUES (?, ?, ?, NULL, 0, 0, 0)').run(id, workspaceId, name);
    return { id };
  },
  createDocument: ({ workspaceId, folderId, title, content }: any) => {
    const id = `doc-${title}`;
    db.prepare('INSERT INTO documents (id, workspaceId, folderId, title, content) VALUES (?, ?, ?, ?, ?)').run(id, workspaceId, folderId, title, content);
    return { id };
  },
});

describe('a Worldbuild package', () => {
  test('carries templates and custom fields, and their entity references point at the new entities', () => {
    const { db, store } = harness;
    const edwin = make('source', 'Edwin');
    const harrow = make('source', 'Harrow');
    const field = worldbuild.saveFieldDefinition({ projectId: 'source', typeId: 'Characters', label: 'Oldest friend', valueType: 'entity-reference' });
    worldbuild.saveEntityTemplate({ workspaceId: 'source', typeId: 'Characters', displayName: 'Villagers', layout: { sections: [{ id: 'past', title: 'Past', kind: 'custom' }], fieldSections: { [field.id]: 'past' } } });
    store.updateEntity(edwin, { data: { customFields: { [field.key]: harrow } } });

    const pkg = portable(store.exportWorldbuild('source'));
    const templates = portable(parts.exportTemplates(db, 'source'));
    const { idMap } = store.importWorldbuild('target', pkg);
    expect(parts.importTemplates({ db, worldbuildData: worldbuild, workspaceId: 'target', templates, idMap })).toEqual({ templatesAdded: 1, fieldsAdded: 1, fieldsKept: 0 });

    const [template] = worldbuild.listEntityTemplates('target');
    expect(template.layout.fieldSections).toEqual({ [field.id]: 'past' });
    const copy = JSON.parse((db.prepare('SELECT data FROM entities WHERE id = ?').get(idMap.get(edwin)) as any).data);
    expect(copy.customFields[field.key]).toBe(idMap.get(harrow));

    // A second import keeps the field the world now has instead of adding it twice.
    const again = store.importWorldbuild('target', pkg);
    expect(parts.importTemplates({ db, worldbuildData: worldbuild, workspaceId: 'target', templates, idMap: again.idMap })).toMatchObject({ fieldsAdded: 0, fieldsKept: 1 });
  });

  test('carries occurrences the author recorded, with their memories, without applying their consequences again', () => {
    const { db, store } = harness;
    const fair = make('source', 'Harvest Fair', 'Events');
    const wren = make('source', 'Wren');
    const service = new EventOccurrenceService(db, calendarService as never);
    service.createManual({
      workspaceId: 'source', eventEntityId: fair, title: 'Fair of 61', summary: 'Wren won the race.', startDate: null, endDate: null,
      participants: [{ entityId: wren, role: 'Runner', remember: true, memoryAccessibility: 'available', audienceType: 'all-members', selectedMemberIds: [] }],
      locationIds: [], relatedEntityIds: [],
    });

    const pkg = portable(store.exportWorldbuild('source'));
    const occurrences = portable(parts.exportOccurrences(db, 'source', pkg.entities.map((entity: any) => entity.ref)));
    const { idMap } = store.importWorldbuild('target', pkg);
    const importing = new EventOccurrenceService(db, calendarService as never, { includeProposed: true });
    expect(parts.importOccurrences({ db, service: importing, workspaceId: 'target', occurrences, idMap })).toEqual({ occurrencesAdded: 1, occurrencesSkipped: 0 });

    const memories = db.prepare("SELECT subject_id FROM narrative_records WHERE workspace_id = 'target' AND record_type = 'memory'").all() as Array<{ subject_id: string }>;
    expect(memories.map(row => row.subject_id)).toEqual([idMap.get(wren)]);
  });

  test('carries background chapters and links them to their sheets again', () => {
    const { db, store } = harness;
    db.exec(`
      CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, name TEXT, parentId TEXT, position INTEGER, createdAt INTEGER, last_modified INTEGER);
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, folderId TEXT, title TEXT NOT NULL, content TEXT);
    `);
    const harrow = make('source', 'Harrow');
    db.prepare("INSERT INTO documents (id, workspaceId, title, content) VALUES ('chapter', 'source', 'The cabin', '{}')").run();
    store.updateEntity(harrow, { data: { loreDocumentIds: ['chapter'] } });

    const pkg = portable(store.exportWorldbuild('source'));
    const chapters = portable(parts.exportChapters(db, 'source', pkg.entities.map((entity: any) => entity.ref)));
    const { idMap } = store.importWorldbuild('target', pkg);
    expect(parts.importChapters({ db, workspaceId: 'target', chapters, idMap, ...writing(db) })).toEqual({ chaptersAdded: 1 });

    const copy = JSON.parse((db.prepare('SELECT data FROM entities WHERE id = ?').get(idMap.get(harrow)) as any).data);
    expect(copy.loreDocumentIds).toEqual(['doc-The cabin']);
    expect((db.prepare("SELECT folderId FROM documents WHERE id = 'doc-The cabin'").get() as any).folderId).toBe(`folder-${parts.CHAPTERS_FOLDER}`);
  });

  test('carries what characters wear and what lies in places', () => {
    const { db, store } = harness;
    const rhona = make('source', 'Rhona');
    const sword = make('source', 'Duskweaver', 'Items');
    const camp = make('source', 'The Camp', 'Locations');
    const pages = make('source', 'The Pages', 'Items');
    db.prepare("INSERT INTO roleplay_equipment (workspace_id, entity_id, item_id, equipped_at) VALUES ('source', ?, ?, 0)").run(rhona, sword);
    db.prepare("INSERT INTO roleplay_location_inventory (workspace_id, location_id, item_id, quantity, updated_at) VALUES ('source', ?, ?, 3, 0)").run(camp, pages);

    const pkg = portable(store.exportWorldbuild('source'));
    const placement = portable(parts.exportPlacement(db, 'source', pkg.entities.map((entity: any) => entity.ref)));
    const { idMap } = store.importWorldbuild('target', pkg);
    expect(parts.importPlacement({ db, workspaceId: 'target', placement, idMap })).toEqual({ equippedAdded: 1, placedAdded: 1 });
    expect(db.prepare("SELECT entity_id, item_id FROM roleplay_equipment WHERE workspace_id = 'target'").get()).toEqual({ entity_id: idMap.get(rhona), item_id: idMap.get(sword) });
    expect(db.prepare("SELECT quantity FROM roleplay_location_inventory WHERE workspace_id = 'target'").get()).toEqual({ quantity: 3 });
  });
});

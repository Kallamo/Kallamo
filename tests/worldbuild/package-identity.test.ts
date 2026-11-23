import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { EventOccurrenceService } from '../../src/main/features/worldbuild/event-occurrences';
import * as calendarService from '../../src/main/features/worldbuild/calendar-service.js';
import { openEntityStore, type EntityStoreHarness } from './entity-store-harness';
import { createPackageFlow } from './package-flow';

const require = createRequire(import.meta.url);
const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');
const inWorldTexts = require('../../src/main/features/worldbuild/in-world-texts.js');
const identity = require('../../src/main/features/worldbuild/package-identity.js');
const { IDENTIFIED } = require('../../src/main/features/worldbuild/package-coverage.js');

let harness: EntityStoreHarness;
let worldbuild: any;
let db: any;
let store: any;
let buildPackage: (workspaceId: string) => any;
let exportPackage: (workspaceId: string) => any;
let importPackage: (workspaceId: string, payload: any) => any;

beforeEach(() => {
  harness = openEntityStore();
  ({ db, store } = harness);
  worldbuild = createWorldbuildDataService(db);
  ({ buildPackage, exportPackage, importPackage } = createPackageFlow({ db, store, worldbuild }));
});
afterEach(() => harness.close());

// A world with one record of every part that has an id of its own.
function authorWorld(workspaceId = 'author') {
  const make = (name: string, type = 'Characters') => store.createEntity({ workspaceId, type, canonicalName: name }).id;
  const wren = make('Wren');
  const harrow = make('Harrow');
  const fair = make('Harvest Fair', 'Events');
  const pages = make('The Pages', 'Items');
  worldbuild.saveSubjectEntry({ workspaceId, subjectId: wren, kind: 'knowledge', entry: { aboutId: harrow, statement: 'Harrow keeps the ledger.', acquisition: 'witness' } });
  worldbuild.saveWorldFact({ workspaceId, entry: { title: 'The well', statement: 'It never runs dry.', relatedEntityIds: [harrow] } });
  new EventOccurrenceService(db, calendarService as never).createManual({
    workspaceId, eventEntityId: fair, title: 'Fair of 61', summary: 'Wren won the race.', startDate: null, endDate: null,
    participants: [{ entityId: wren, role: 'Runner', remember: false, memoryAccessibility: 'available', audienceType: 'all-members', selectedMemberIds: [] }],
    locationIds: [], relatedEntityIds: [],
  });
  db.prepare("INSERT INTO documents (id, workspaceId, title, content) VALUES ('author-chapter', ?, 'The cabin', '{}')").run(workspaceId);
  store.updateEntity(harrow, { data: { loreDocumentIds: ['author-chapter'] } });
  db.prepare("INSERT INTO documents (id, workspaceId, title, content) VALUES ('author-page', ?, 'Page one', '{}')").run(workspaceId);
  inWorldTexts.setInWorldText(db, { documentId: 'author-page', itemId: pages, authorId: wren });
  return { wren, harrow, fair, pages };
}

const uidsOf = (payload: any) => Object.fromEntries(IDENTIFIED.map((part: any) => [part.part, (part.records(payload) || []).map((record: any) => record.uid).sort()]));

describe('a Worldbuild package identity', () => {
  test('every part with an id of its own carries a uid, and it holds through an import and an export from the importing world', () => {
    authorWorld();
    const first = exportPackage('author');
    const uids = uidsOf(first);
    for (const part of IDENTIFIED) {
      const records = part.records(first) || [];
      expect(records.length, part.part).toBeGreaterThan(0);
      expect(records.every((record: any) => typeof record.uid === 'string' && record.uid), part.part).toBe(true);
    }

    importPackage('player', first);
    const again = exportPackage('player');
    expect(uidsOf(again)).toEqual(uids);
    // The refs are the importing world's own ids; only the uids say where each part came from.
    expect(again.entities.map((entity: any) => entity.ref)).not.toEqual(first.entities.map((entity: any) => entity.ref));
    // A world that re-exports what it imported is its own package, not a version of the author's.
    expect(again.packageId).not.toBe(first.packageId);
  });

  test('keeps its id through exports, and moves the version only when the content changes', () => {
    const { wren } = authorWorld();
    const first = exportPackage('author');
    const same = exportPackage('author');
    expect([same.packageId, same.packageVersion, same.packageHash]).toEqual([first.packageId, 1, first.packageHash]);

    store.updateEntity(wren, { lore: 'Fastest runner in the valley.' });
    const changed = exportPackage('author');
    expect([changed.packageId, changed.packageVersion]).toEqual([first.packageId, 2]);
    expect(changed.packageHash).not.toBe(first.packageHash);
  });

  test('a package built for a copy has no identity and leaves the version as it was', () => {
    authorWorld();
    exportPackage('author');
    const built = buildPackage('author');
    expect(built.packageId).toBeUndefined();
    expect(db.prepare("SELECT version FROM worldbuild_package_identity WHERE workspace_id = 'author'").get().version).toBe(1);
  });

  test('an import records the package it came from, with the package kept as its base', () => {
    authorWorld();
    const pkg = exportPackage('author');
    const { recorded, idMap } = importPackage('player', pkg);

    expect(identity.listOrigins(db, 'player')).toEqual([
      { importId: recorded.importId, packageId: pkg.packageId, version: 1, hash: pkg.packageHash, importedAt: expect.any(Number) },
    ]);
    const base = db.prepare("SELECT base_json FROM worldbuild_package_origins WHERE workspace_id = 'player'").get().base_json;
    expect(JSON.parse(base)).toEqual(pkg);
    const wren = pkg.entities.find((entity: any) => entity.canonicalName === 'Wren');
    expect(db.prepare("SELECT package_uid FROM worldbuild_package_uids WHERE workspace_id = 'player' AND part = 'entities' AND local_id = ?").get(idMap.get(wren.ref)).package_uid)
      .toBe(wren.uid);
  });

  test('a package from before identities imports as before and records nothing', () => {
    authorWorld();
    const legacy = JSON.parse(JSON.stringify(store.exportWorldbuild('author')));
    const { idMap, recorded } = importPackage('player', legacy);
    expect(idMap.size).toBe(4);
    expect(recorded).toEqual({ importId: null, uids: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM worldbuild_package_uids WHERE workspace_id = 'player'").get().count).toBe(0);
    expect(identity.listOrigins(db, 'player')).toEqual([]);
  });

  test('importing the same package twice still lands two copies, each with its own origin', () => {
    authorWorld();
    const pkg = exportPackage('author');
    importPackage('player', pkg);
    importPackage('player', pkg);
    expect(db.prepare("SELECT COUNT(*) AS count FROM entities WHERE workspaceId = 'player'").get().count).toBe(8);
    expect(identity.listOrigins(db, 'player')).toHaveLength(2);
  });

  test('merging away or deleting an imported entity ends its uid', () => {
    authorWorld();
    const pkg = exportPackage('author');
    const { idMap } = importPackage('player', pkg);
    const ref = (name: string) => idMap.get(pkg.entities.find((entity: any) => entity.canonicalName === name).ref);
    const uidOf = (id: string) => db.prepare("SELECT package_uid FROM worldbuild_package_uids WHERE workspace_id = 'player' AND part = 'entities' AND local_id = ?").get(id);

    store.mergeEntity(ref('Harrow'), ref('Wren'));
    expect(uidOf(ref('Harrow'))).toBeUndefined();
    expect(uidOf(ref('Wren'))).toBeDefined();
    store.deleteEntity(ref('Wren'));
    expect(uidOf(ref('Wren'))).toBeUndefined();
  });
});

import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openEntityStore, type EntityStoreHarness } from '../worldbuild/entity-store-harness';
import { createPackageFlow } from '../worldbuild/package-flow';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const story = require('../../src/main/features/onboarding/evenwell-story.js');
const { createEvenwellOnboarding } = require('../../src/main/features/onboarding/evenwell-seed.js');
const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');

const PACKAGE = require.resolve('../../src/assets/onboarding/evenwell.klwb');
// The package as beta.2 shipped it, before it had an identity.
const bundled = () => JSON.parse(new AdmZip(PACKAGE).readAsText('worldbuild.json'));
const ROOMS = ['The Common Room', 'The Kitchen', 'The Gallery', 'Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6'];

let harness: EntityStoreHarness;
let db: any;
let store: any;
let worldbuild: any;
let flow: ReturnType<typeof createPackageFlow>;

beforeEach(() => {
  harness = openEntityStore();
  ({ db, store } = harness);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS workspace_ui_state (
      workspaceId TEXT NOT NULL, scope TEXT NOT NULL, valueJson TEXT, updatedAt INTEGER, PRIMARY KEY (workspaceId, scope)
    );
  `);
  worldbuild = createWorldbuildDataService(db);
  flow = createPackageFlow({ db, store, worldbuild });
});
afterEach(() => harness.close());

// The package beta.1 shipped: beta.2's without the inn's rooms and the links that place them.
function beta1() {
  const payload = bundled();
  const rooms = new Set(payload.entities.filter((entity: any) => entity.type === 'Locations' && ROOMS.includes(entity.canonicalName)).map((entity: any) => entity.ref));
  payload.entities = payload.entities.filter((entity: any) => !rooms.has(entity.ref));
  payload.links = payload.links.filter((link: any) => !rooms.has(link.fromRef) && !rooms.has(link.toRef));
  return payload;
}

/** A player's Evenwell, seeded by an app from before package identities. */
function seeded(workspaceId: string, payload = bundled()) {
  flow.importPackage(workspaceId, payload, { record: false });
  db.prepare("INSERT INTO workspace_ui_state (workspaceId, scope, valueJson, updatedAt) VALUES (?, 'onboarding', ?, 0)")
    .run(workspaceId, JSON.stringify({ story: story.STORY_ID, stage: 'playing' }));
}

/** Evenwell re-exported from a world that imported the bundled package, as its author will do. */
function firstVersion() {
  flow.importPackage('author', bundled(), { record: false });
  return flow.exportPackage('author');
}

const onboardingWith = (payload: any) => createEvenwellOnboarding({
  db, readPackage: () => payload, importPayload: () => ({ success: true }), roleplay: () => ({}), calendar: {},
  setExperienceMode: () => {}, purgeWorkspace: () => {}, worldbuildData: worldbuild,
});

// Every row outside the origin tables, so the test can show the world itself is untouched.
function worldRows() {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'worldbuild_package_%'").all() as any[])
    .map(row => row.name);
  return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM "${table}"`).all()]));
}

const uidCount = (workspaceId: string, part: string) => db.prepare('SELECT COUNT(*) AS count FROM worldbuild_package_uids WHERE workspace_id = ? AND part = ?').get(workspaceId, part).count;
const baseOf = (workspaceId: string) => JSON.parse(db.prepare('SELECT base_json FROM worldbuild_package_origins WHERE workspace_id = ?').get(workspaceId).base_json);

describe('an Evenwell seeded before packages had an identity', { timeout: 60_000 }, () => {
  test('finds every packaged part in a world seeded on beta.2, and changes nothing in the world', () => {
    const v1 = firstVersion();
    seeded('player');
    const before = worldRows();

    const [adopted] = onboardingWith(v1).adoptOrigins();
    expect(adopted).toMatchObject({ workspaceId: 'player', entities: 71, knowledge: v1.knowledge.entries.length, facts: v1.facts.entries.length, texts: 12 });
    expect(adopted.packaged).toEqual({ entities: 71, knowledge: v1.knowledge.entries.length, facts: v1.facts.entries.length, texts: 12 });
    expect(worldRows()).toEqual(before);
    expect(db.prepare("SELECT package_id, version FROM worldbuild_package_origins WHERE workspace_id = 'player'").get()).toEqual({ package_id: v1.packageId, version: 1 });
    expect(baseOf('player')).toEqual(v1);
  });

  test('keeps for a world seeded on beta.1 a base without the rooms it never had', () => {
    const v1 = firstVersion();
    seeded('player', beta1());

    const [adopted] = onboardingWith(v1).adoptOrigins();
    expect(adopted.entities).toBe(62);
    const base = baseOf('player');
    expect(base.entities).toHaveLength(62);
    expect(base.links).toHaveLength(v1.links.length - 9);
    expect(base.entities.some((entity: any) => ROOMS.includes(entity.canonicalName))).toBe(false);
  });

  test('follows a rename by the story, and leaves out what was deleted and what the story made', () => {
    const v1 = firstVersion();
    seeded('player');
    const id = (name: string) => db.prepare("SELECT id FROM entities WHERE workspaceId = 'player' AND canonicalName = ?").get(name)?.id;
    const odris = id('Odris');
    store.updateEntity(odris, { canonicalName: 'Old Odris' });
    db.prepare(`
      INSERT INTO roleplay_entity_changes (workspace_id, change_id, entity_id, created_entity, payload_json, status, provenance_id, created_at)
      VALUES ('player', 'rename', ?, 0, ?, 'applied', 'turn-1', 1)
    `).run(odris, JSON.stringify({ identityUpdate: { entityId: odris, canonicalName: 'Old Odris', previousCanonicalName: 'Odris', previousAliases: [] } }));
    store.deleteEntity(id('Rue'));
    const stranger = store.createEntity({ workspaceId: 'player', type: 'Characters', canonicalName: 'Rue' }).id;
    db.prepare(`
      INSERT INTO roleplay_entity_changes (workspace_id, change_id, entity_id, created_entity, payload_json, status, provenance_id, created_at)
      VALUES ('player', 'made', ?, 1, '{}', 'applied', 'turn-2', 2)
    `).run(stranger);

    const [adopted] = onboardingWith(v1).adoptOrigins();
    expect(adopted.entities).toBe(70);
    const uid = (local: string) => db.prepare("SELECT package_uid FROM worldbuild_package_uids WHERE workspace_id = 'player' AND part = 'entities' AND local_id = ?").get(local)?.package_uid;
    expect(uid(odris)).toBe(v1.entities.find((entity: any) => entity.canonicalName === 'Odris').uid);
    expect(uid(stranger)).toBeUndefined();
    // Rue stays in the base, so a later version sees it was removed here rather than bringing it back.
    expect(baseOf('player').entities.some((entity: any) => entity.canonicalName === 'Rue')).toBe(true);
  });

  test('runs once per world, and not at all while the bundled package has no identity', () => {
    seeded('player');
    expect(onboardingWith(bundled()).adoptOrigins()).toEqual([]);
    expect(uidCount('player', 'entities')).toBe(0);

    const v1 = firstVersion();
    expect(onboardingWith(v1).adoptOrigins()).toHaveLength(1);
    expect(onboardingWith(v1).adoptOrigins()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM worldbuild_package_origins WHERE workspace_id = 'player'").get().count).toBe(1);
  });
});

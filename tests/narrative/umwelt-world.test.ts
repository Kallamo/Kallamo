import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getUmweltBridge, UmweltRequestError } from '../../src/main/features/narrative/umwelt/bridge';
import { NarrativeWorld, STORY_PROJECT, storyEntityType } from '../../src/main/features/narrative/umwelt/narrative-world';
import {
  listWorldFiles,
  packWorldFiles,
  removeOrphanWorldFiles,
  unpackWorldFiles,
  worldFile,
  worldFileName
} from '../../src/main/features/narrative/umwelt/world-files';
import { openTestDatabase } from '../sqlite-test-database';
import { openFullSchemaDatabase, type FullSchemaDatabase } from '../database/full-schema-harness';

const require = createRequire(import.meta.url);
const { purgeWorkspace } = require('../../src/main/features/workspace/workspace-ownership.js');

let harness: FullSchemaDatabase;
let db: any;

beforeEach(() => {
  harness = openFullSchemaDatabase();
  db = harness.db;
  db.prepare(`INSERT INTO chats (id, title, description, memoryBlocks, knowledgeFiles, activeProfiles, activeWorkflows) VALUES ('ws', 'Story', '', '[]', '[]', '[]', '[]')`).run();
});
afterEach(() => harness.close());

function entity(id: string, type: string, workspaceId = 'ws') {
  db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt) VALUES (?, ?, ?, ?, '[]', '', '{}', 'confirmed', 1)`)
    .run(id, workspaceId, type, id.toUpperCase());
}

describe('Umwelt story files', () => {
  test('maps Worldbuild types to who can hold knowledge', () => {
    expect(storyEntityType('Characters')).toBe('agent');
    expect(storyEntityType('Creatures')).toBe('agent');
    expect(storyEntityType('Factions')).toBe('group');
    expect(storyEntityType('Locations')).toBe('group');
    expect(storyEntityType('Items')).toBe('thing');
    expect(storyEntityType('Events')).toBe('thing');
  });

  test('registers the entities a write names and leaves out ids with no entity', () => {
    entity('ana', 'Characters');
    entity('guild', 'Factions');
    entity('lamp', 'Items');
    entity('elsewhere', 'Characters', 'other-workspace');
    const world = NarrativeWorld.of(db, 'ws');
    const known = world.ensureEntities(['ana', 'guild', 'lamp', 'ghost', 'elsewhere']);
    expect([...known.entries()]).toEqual([['ana', 'agent'], ['guild', 'group'], ['lamp', 'thing']]);
    const stored = world.call<{ typeId: string; name: string }>('entity.get', { entityId: 'ana' });
    expect(stored).toMatchObject({ typeId: 'agent', name: 'ANA' });
    expect(() => world.call('entity.get', { entityId: 'ghost' })).toThrow(UmweltRequestError);
  });

  test('keeps the first kind of an entity whose Worldbuild type changed', () => {
    entity('ana', 'Characters');
    const world = NarrativeWorld.of(db, 'ws');
    world.ensureEntities(['ana']);
    db.prepare("UPDATE entities SET type = 'Items' WHERE id = 'ana'").run();
    // As after a restart: nothing is cached, and the stored kind wins over the new Worldbuild type.
    (world as any).known.clear();
    expect(world.typeOf('ana')).toBe('agent');
  });

  test('deleting a workspace deletes its story file', () => {
    entity('ana', 'Characters');
    const world = NarrativeWorld.of(db, 'ws');
    world.ensureEntities(['ana']);
    expect(existsSync(world.file)).toBe(true);
    purgeWorkspace(db, 'ws');
    expect(existsSync(world.file)).toBe(false);
    expect(getUmweltBridge().isOpen(world.file)).toBe(false);
  });

  test('removes story files whose workspace is gone', () => {
    entity('ana', 'Characters');
    entity('bo', 'Characters', 'gone');
    NarrativeWorld.of(db, 'ws').ensureEntities(['ana']);
    NarrativeWorld.of(db, 'gone').ensureEntities(['bo']);
    expect(listWorldFiles(db).sort()).toEqual([worldFileName('gone'), worldFileName('ws')]);
    expect(removeOrphanWorldFiles(db, ['ws'])).toBe(1);
    expect(listWorldFiles(db)).toEqual([worldFileName('ws')]);
  });

  test('file names stay unique for workspace ids a file name cannot hold', () => {
    expect(worldFileName('ws-1_a')).toBe('ws-1_a.umw');
    expect(worldFileName('a/b')).not.toBe(worldFileName('a:b'));
    expect(worldFileName('a/b')).toMatch(/^a_b-[0-9a-f]{8}\.umw$/);
  });

  test('a backup carries the story files and a restore brings them back', () => {
    entity('ana', 'Characters');
    NarrativeWorld.of(db, 'ws').ensureEntities(['ana']);
    const directory = mkdtempSync(join(tmpdir(), 'kallamo-backup-'));
    try {
      const backupPath = join(directory, 'backup.db');
      db.prepare('VACUUM INTO ?').run(backupPath);
      expect(packWorldFiles(db, backupPath, path => openTestDatabase(path))).toBe(1);

      const restored = openTestDatabase(backupPath);
      try {
        const file = worldFile(restored, 'ws');
        expect(existsSync(file)).toBe(false);
        expect(unpackWorldFiles(restored)).toBe(1);
        expect(existsSync(file)).toBe(true);
        expect(restored.prepare("SELECT 1 FROM sqlite_master WHERE name = 'narrative_world_files'").get()).toBeUndefined();
        const stored = getUmweltBridge().call<{ id: string }>(file, 'entity.get', { projectId: STORY_PROJECT, entityId: 'ana' });
        expect(stored.id).toBe('ana');
      } finally {
        getUmweltBridge().closeAll();
        restored.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

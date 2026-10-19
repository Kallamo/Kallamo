import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openTestDatabase } from './sqlite-test-database';

const require = createRequire(import.meta.url);
const { runDatabaseMigrations } = require('../src/main/database/migrations.js');

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function database() {
  const directory = mkdtempSync(join(tmpdir(), 'kallamo-migration-order-'));
  directories.push(directory);
  return openTestDatabase(join(directory, 'order.db'));
}

const BASE_TABLES = `
  CREATE TABLE knowledge_chunks (id TEXT PRIMARY KEY, ownerId TEXT, ownerType TEXT, source TEXT, text TEXT, vector TEXT, createdAt INTEGER);
  CREATE TABLE entities (id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL, aliases TEXT, lore TEXT, loreDocumentId TEXT, data TEXT, status TEXT, createdAt INTEGER, last_modified INTEGER);
  CREATE TABLE entity_links (id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT NOT NULL, relType TEXT NOT NULL, toId TEXT NOT NULL, label TEXT, createdAt INTEGER);
`;

const names = (db: any, type: string) => db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type).map((row: any) => row.name);

describe('migrations and the base schema', () => {
  test('a database whose migrations ran before its base tables existed is repaired', () => {
    const db = database();
    runDatabaseMigrations(db);
    db.exec(BASE_TABLES);
    db.prepare("DELETE FROM schema_migrations WHERE id = 'worldbuild_base_schema_repair_v1'").run();
    runDatabaseMigrations(db);

    expect(db.prepare('PRAGMA table_info(entity_links)').all().map((column: any) => column.name)).toContain('metadata_json');
    expect(names(db, 'index')).toEqual(expect.arrayContaining(['idx_unique_item_owner', 'idx_unique_item_location', 'idx_item_type_inventory']));
    expect(names(db, 'trigger')).toEqual(expect.arrayContaining(['trg_entity_update_evidence_chunk_gc', 'trg_entity_update_evidence_entity_gc']));
    db.close();
  });

  test('database.js runs the versioned migrations after it creates the base tables', () => {
    const source = readFileSync(require.resolve('../src/main/database.js'), 'utf8');
    const schema = readFileSync(require.resolve('../src/main/database/base-schema.js'), 'utf8');
    const createsBase = source.indexOf('runSchemaStep(() => db.exec(BASE_SCHEMA))');
    const migrates = source.indexOf('runDatabaseMigrations(db)');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS entities');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS entity_links');
    expect(createsBase).toBeGreaterThan(0);
    expect(migrates).toBeGreaterThan(createsBase);
  });

  test('database.js copies the database before any schema change and records the version after every one', () => {
    const source = readFileSync(require.resolve('../src/main/database.js'), 'utf8');
    const opens = source.indexOf('new Database(dbPath)');
    const backs = source.indexOf('createPreMigrationBackup(db,');
    const firstSchema = source.indexOf('db.exec(BASE_SCHEMA)');
    const firstAlter = source.indexOf('ALTER TABLE');
    const migrates = source.indexOf('runSchemaStep(() => runDatabaseMigrations(db))');
    const records = source.indexOf('writeSchemaAppVersion(db, appVersion)');

    expect(backs).toBeGreaterThan(opens);
    expect(firstSchema).toBeGreaterThan(backs);
    expect(firstAlter).toBeGreaterThan(backs);
    expect(source).toContain('runSchemaStep(() => db.exec(BASE_SCHEMA))');
    expect(migrates).toBeGreaterThan(firstAlter);
    expect(records).toBeGreaterThan(migrates);
  });
});

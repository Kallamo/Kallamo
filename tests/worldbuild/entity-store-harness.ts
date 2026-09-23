import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openTestDatabase } from '../sqlite-test-database';

const require = createRequire(import.meta.url);
const { runDatabaseMigrations } = require('../../src/main/database/migrations.js');

const DATABASE_MODULE = require.resolve('../../src/main/database.js');
const STORE_MODULES = [require.resolve('../../src/main/entities.js')];

// The subset of database.js the Worldbuild store touches, including its cleanup triggers.
const BASE_SCHEMA = `
  CREATE TABLE knowledge_chunks (
    id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, ownerType TEXT NOT NULL, source TEXT NOT NULL,
    text TEXT NOT NULL, vector TEXT NOT NULL, createdAt INTEGER NOT NULL, enabled INTEGER DEFAULT 1,
    manuallyEdited INTEGER DEFAULT 0, memoryBlockId TEXT
  );
  CREATE TABLE chunk_tags (chunkId TEXT NOT NULL, tag TEXT NOT NULL, entity TEXT, PRIMARY KEY (chunkId, tag, entity));
  CREATE TABLE chunk_tag_suppressions (chunkId TEXT NOT NULL, tag TEXT NOT NULL, entity TEXT NOT NULL, PRIMARY KEY (chunkId, tag, entity));
  CREATE TABLE entities (
    id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL, aliases TEXT,
    lore TEXT, loreDocumentId TEXT, data TEXT, status TEXT NOT NULL DEFAULT 'confirmed', createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );
  CREATE TABLE entity_links (
    id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT NOT NULL, relType TEXT NOT NULL, toId TEXT NOT NULL,
    label TEXT, createdAt INTEGER
  );
  CREATE TABLE entity_enrichment_chunks (
    entityId TEXT NOT NULL, chunkId TEXT NOT NULL, contentHash TEXT NOT NULL DEFAULT '', processedAt INTEGER NOT NULL,
    PRIMARY KEY (entityId, chunkId)
  );
  CREATE TABLE entity_enrichment_errors (
    id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, entityId TEXT NOT NULL, entityName TEXT NOT NULL,
    entityType TEXT NOT NULL, error TEXT NOT NULL, createdAt INTEGER NOT NULL, dismissedAt INTEGER,
    UNIQUE(workspaceId, entityId)
  );
  CREATE TRIGGER trg_entity_links_gc AFTER DELETE ON entities FOR EACH ROW
  BEGIN DELETE FROM entity_links WHERE fromId = OLD.id OR toId = OLD.id; END;
  CREATE TRIGGER trg_chunk_tags_entity_gc AFTER DELETE ON entities FOR EACH ROW
  BEGIN DELETE FROM chunk_tags WHERE entity = OLD.id; END;
  CREATE TRIGGER trg_entity_enrichment_chunks_entity_gc AFTER DELETE ON entities FOR EACH ROW
  BEGIN
    DELETE FROM entity_enrichment_chunks WHERE entityId = OLD.id;
    DELETE FROM entity_enrichment_errors WHERE entityId = OLD.id;
  END;
`;

export interface EntityStoreHarness {
  db: Database.Database;
  store: any;
  close(): void;
}

// Loads the real entities store against a temporary database with every migration applied.
export function openEntityStore(): EntityStoreHarness {
  const directory = mkdtempSync(join(tmpdir(), 'kallamo-entity-store-'));
  const db = openTestDatabase(join(directory, 'store.db'));
  db.pragma('foreign_keys = ON');
  db.exec(BASE_SCHEMA);
  runDatabaseMigrations(db);
  for (const path of [DATABASE_MODULE, ...STORE_MODULES]) delete require.cache[path];
  require.cache[DATABASE_MODULE] = { id: DATABASE_MODULE, filename: DATABASE_MODULE, loaded: true, exports: db } as any;
  const store = require('../../src/main/entities.js');
  return {
    db,
    store,
    close() {
      for (const path of [DATABASE_MODULE, ...STORE_MODULES]) delete require.cache[path];
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

export function insertEntity(db: Database.Database, id: string, fields: Record<string, unknown> = {}) {
  const row = {
    workspaceId: 'ws', type: 'Characters', canonicalName: id, aliases: '[]', lore: '', loreDocumentId: null,
    data: '{}', status: 'confirmed', ...fields
  };
  db.prepare(`
    INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, loreDocumentId, data, status, createdAt, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
  `).run(id, row.workspaceId, row.type, row.canonicalName, row.aliases, row.lore, row.loreDocumentId,
    typeof row.data === 'string' ? row.data : JSON.stringify(row.data), row.status);
}

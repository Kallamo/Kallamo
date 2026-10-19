import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openTestDatabase } from '../sqlite-test-database';

const require = createRequire(import.meta.url);
const { BASE_SCHEMA, TOKEN_CALIBRATION_SCHEMA, WORLD_INDEX_SCHEMA } = require('../../src/main/database/base-schema.js');
const { runDatabaseMigrations } = require('../../src/main/database/migrations.js');

// Columns database.js still adds with ALTER on boot; a fresh table needs them too.
const BOOT_COLUMNS = `
  ALTER TABLE messages ADD COLUMN alternatives TEXT;
  ALTER TABLE messages ADD COLUMN excluded INTEGER DEFAULT 0;
  ALTER TABLE knowledge_chunks ADD COLUMN tokenCount INTEGER DEFAULT 0;
  ALTER TABLE knowledge_chunks ADD COLUMN content_hash TEXT;
  ALTER TABLE knowledge_chunks ADD COLUMN ordinal INTEGER;
  ALTER TABLE chunk_tags ADD COLUMN manual INTEGER DEFAULT 0;
  ALTER TABLE chunk_tags ADD COLUMN origin TEXT;
  ALTER TABLE world_index_chunk_status ADD COLUMN rejectedMentions INTEGER NOT NULL DEFAULT 0;
`;

export interface FullSchemaDatabase {
  db: Database.Database;
  close(): void;
}

// A temporary database built the way the app builds one: base tables, then every migration.
export function openFullSchemaDatabase(): FullSchemaDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'kallamo-full-schema-'));
  const db = openTestDatabase(join(directory, 'app.db'));
  db.pragma('foreign_keys = ON');
  db.exec(BASE_SCHEMA);
  db.exec(TOKEN_CALIBRATION_SCHEMA);
  db.exec(WORLD_INDEX_SCHEMA);
  db.exec(BOOT_COLUMNS);
  runDatabaseMigrations(db);
  return {
    db,
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

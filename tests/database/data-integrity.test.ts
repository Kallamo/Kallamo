import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeEntitySystem } from '../../src/main/features/narrative/narrative-entities';
import { openTestDatabase } from '../sqlite-test-database';
import { insertEntity, openEntityStore } from '../worldbuild/entity-store-harness';
import { openFullSchemaDatabase } from './full-schema-harness';

// Edits that must not duplicate data, and deletes that must not leave it behind.

describe('data integrity', () => {
  test('saving a sheet keeps the Update entities review staged in the background', () => {
    const harness = openEntityStore();
    try {
      insertEntity(harness.db, 'nora', { data: { description: 'A ferry pilot.', _enrichPending: { data: { age: '30' } } } });
      // The sheet was opened before the review was staged, so its copy of data has no review.
      harness.store.updateEntityFromEditor('nora', { data: { description: 'A ferry pilot from the north.', _enrichPending: null } });
      expect(harness.store.getEntity('nora').data._enrichPending).toEqual({ data: { age: '30' } });
    } finally {
      harness.close();
    }
  });

  test('a linked chapter that was deleted is not offered as lore', () => {
    const harness = openEntityStore();
    try {
      harness.db.exec('CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL)');
      harness.db.prepare("INSERT INTO documents (id, workspaceId) VALUES ('chapter-two', 'ws')").run();
      insertEntity(harness.db, 'nora', { data: { loreDocumentIds: ['chapter-one', 'chapter-two'] } });
      expect(harness.store.linkedLoreDocIds(harness.store.getEntity('nora'))).toEqual(['chapter-two']);
    } finally {
      harness.close();
    }
  });

  test('rewriting a passage keeps one keyword-search row for it', () => {
    const { db, close } = openFullSchemaDatabase();
    try {
      const write = db.prepare("INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt) VALUES ('memory-1', 'ws', 'chat_memory', 'Memory', ?, '[]', 1)");
      write.run('The ferry left at dawn.');
      write.run('The ferry left at dusk.');
      expect(db.prepare("SELECT text FROM knowledge_chunks_fts WHERE chunkId = 'memory-1'").all())
        .toEqual([{ text: 'The ferry left at dusk.' }]);
    } finally {
      close();
    }
  });

  test('a regenerated reply that brings back the same new character does not create a second one', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kallamo-known-gaps-'));
    const db = openTestDatabase(join(directory, 'twin.db'));
    try {
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE entities (
          id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT, canonicalName TEXT, aliases TEXT, lore TEXT,
          loreDocumentId TEXT, data TEXT, status TEXT, createdAt INTEGER, last_modified INTEGER
        );
        CREATE TABLE entity_links (
          id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT, toId TEXT, label TEXT,
          metadata_json TEXT, createdAt INTEGER
        );
      `);
      runDatabaseMigrations(db);
      const system = new NarrativeEntitySystem(db);
      const proposal = {
        referenceId: 'new:selka', name: 'Selka', type: 'Characters' as const, aliases: [],
        description: 'A pilot.', excerpt: 'Selka steps aboard.', confidence: 0.98,
        decision: 'new' as const, identityEstablished: true
      };

      const first = system.resolveOrPropose('ws', 'reply-one', proposal);
      system.markOrigin('ws', 'reply-one', 'superseded');
      const second = system.resolveOrPropose('ws', 'reply-two', proposal);

      expect(second.entityId).toBe(first.entityId);
      expect(db.prepare('SELECT COUNT(*) AS count FROM entities').get()).toEqual({ count: 1 });
      // Deleting the reverted reply later does not take the character from the reply that kept it.
      system.markOrigin('ws', 'reply-one', 'deleted');
      expect(db.prepare('SELECT status FROM entities').get()).toEqual({ status: 'confirmed' });
      system.markOrigin('ws', 'reply-two', 'superseded');
      expect(db.prepare('SELECT status FROM entities').get()).toEqual({ status: 'proposed' });
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const { runDatabaseMigrations } = require('../../src/main/database/migrations.js');

let harness: FullSchemaDatabase;
beforeEach(() => { harness = openFullSchemaDatabase(); });
afterEach(() => harness.close());

const run = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).run(...params);
const values = (sql: string, ...params: unknown[]) => (harness.db.prepare(sql).all(...params) as any[]).map(row => Object.values(row)[0]);

// Re-runs one migration on data written as older builds left it.
function rerun(id: string) {
  run('DELETE FROM schema_migrations WHERE id = ?', id);
  runDatabaseMigrations(harness.db);
}

const addChunk = (id: string, ownerId: string, ownerType: string) =>
  run("INSERT INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt) VALUES (?, ?, ?, 'Source', 'Text', '[]', 1)", id, ownerId, ownerType);

describe('knowledge_chunk_sync_v1', () => {
  test('rebuilds a keyword index that drifted and keeps it in step afterwards', () => {
    addChunk('kept', 'ws', 'chat_memory');
    run("INSERT INTO knowledge_chunks_fts (chunkId, text) VALUES ('kept', 'Text'), ('gone', 'Old')");
    run("INSERT INTO chunk_tag_suppressions (chunkId, tag, entity) VALUES ('gone', 'Characters', 'nora')");
    rerun('knowledge_chunk_sync_v1');

    expect(values('SELECT chunkId FROM knowledge_chunks_fts')).toEqual(['kept']);
    expect(values('SELECT chunkId FROM chunk_tag_suppressions')).toEqual([]);

    run("UPDATE knowledge_chunks SET text = 'New text' WHERE id = 'kept'");
    expect(values("SELECT text FROM knowledge_chunks_fts WHERE chunkId = 'kept'")).toEqual(['New text']);
    run("DELETE FROM knowledge_chunks WHERE id = 'kept'");
    expect(values('SELECT chunkId FROM knowledge_chunks_fts')).toEqual([]);
  });
});

describe('data_integrity_repair_v1', () => {
  beforeEach(() => {
    run("INSERT INTO chats (id, title) VALUES ('live', 'Story')");
    run("INSERT INTO writing_profiles (id, name) VALUES ('editor', 'Editing')");
    // A workspace deleted by an older build, which left its chapter, entity and view state.
    run("INSERT INTO documents (id, workspaceId, title) VALUES ('old-chapter', 'gone', 'Chapter')");
    addChunk('old-passage', 'old-chapter', 'document');
    addChunk('old-memory', 'gone', 'chat_memory');
    run("INSERT INTO entities (id, workspaceId, type, canonicalName) VALUES ('old-nora', 'gone', 'Characters', 'Nora')");
    run("INSERT INTO workspace_ui_state (workspaceId, scope, valueJson, updatedAt) VALUES ('gone', 'worldbuild', '{}', 1)");
    // A chapter deleted from a live workspace, which left notes and lore links.
    run("INSERT INTO documents (id, workspaceId, title) VALUES ('kept-chapter', 'live', 'Chapter')");
    run("INSERT INTO document_notes (id, documentId, workspaceId, body) VALUES ('note', 'deleted-chapter', 'live', 'Body')");
    addChunk('deleted-passage', 'deleted-chapter', 'document');
    run(`INSERT INTO entities (id, workspaceId, type, canonicalName, loreDocumentId, data)
         VALUES ('nora', 'live', 'Characters', 'Nora', 'deleted-chapter', ?)`,
    JSON.stringify({ loreDocumentIds: ['deleted-chapter', 'kept-chapter'] }));
    // An AI Profile deleted by an older build.
    addChunk('old-profile-passage', 'deleted-profile', 'profile_kb');
    addChunk('profile-passage', 'editor', 'profile_kb');
    run("INSERT INTO constant_memory (id, ownerId, ownerType, content) VALUES ('old-snippet', 'deleted-profile', 'profile', 'Text'), ('snippet', 'editor', 'profile', 'Text')");
  });

  test('removes what deleted workspaces, chapters and profiles left behind', () => {
    rerun('data_integrity_repair_v1');

    expect(values('SELECT id FROM documents')).toEqual(['kept-chapter']);
    expect(values('SELECT id FROM knowledge_chunks ORDER BY id')).toEqual(['profile-passage']);
    expect(values('SELECT id FROM entities')).toEqual(['nora']);
    expect(values('SELECT workspaceId FROM workspace_ui_state')).toEqual([]);
    expect(values('SELECT id FROM document_notes')).toEqual([]);
    expect(values('SELECT id FROM constant_memory')).toEqual(['snippet']);
    const nora = harness.db.prepare("SELECT loreDocumentId, data FROM entities WHERE id = 'nora'").get() as any;
    expect(nora.loreDocumentId).toBe('kept-chapter');
    expect(JSON.parse(nora.data)).toEqual({ loreDocumentIds: ['kept-chapter'] });
  });

  test('leaves workspace rows alone when no workspace exists at all', () => {
    run("DELETE FROM chats WHERE id = 'live'");
    rerun('data_integrity_repair_v1');

    expect(values("SELECT id FROM entities WHERE workspaceId = 'gone'")).toEqual(['old-nora']);
    expect(values("SELECT id FROM documents WHERE id = 'old-chapter'")).toEqual(['old-chapter']);
  });
});

test('drop_deleted_records_v1 removes the unused delete log', () => {
  expect(values("SELECT name FROM sqlite_master WHERE name LIKE '%deleted_records%' OR name LIKE '%_delete_trigger'")).toEqual([]);
});

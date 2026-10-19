import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const { DOCUMENT_REFERENCE_COLUMNS, purgeDocuments, purgeFolder } = require('../../src/main/features/workspace/document-ownership.js');

const LOOKS_LIKE_A_DOCUMENT_COLUMN = /^(documentId|document_id|loreDocumentIds?)$/;

let harness: FullSchemaDatabase;
beforeEach(() => { harness = openFullSchemaDatabase(); });
afterEach(() => harness.close());

const rows = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).all(...params) as any[];
const run = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).run(...params);
const ids = (sql: string, ...params: unknown[]) => rows(sql, ...params).map(row => row.id ?? row.chunkId);

test('every column that can hold a document id is declared', () => {
  const declared = new Set(DOCUMENT_REFERENCE_COLUMNS.map((entry: any) => `${entry.table}.${entry.column}`));
  const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map(row => row.name);
  const missing = tables.flatMap(table => rows(`PRAGMA table_info("${table}")`)
    .filter(column => LOOKS_LIKE_A_DOCUMENT_COLUMN.test(column.name) && !declared.has(`${table}.${column.name}`))
    .map(column => `${table}.${column.name}`));
  expect(missing).toEqual([]);
});

function seedChapter(id: string, folderId: string | null = null) {
  run("INSERT INTO documents (id, workspaceId, folderId, title) VALUES (?, 'ws', ?, 'Chapter')", id, folderId);
  run("INSERT INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt) VALUES (?, ?, 'document', 'Chapter', 'Text', '[]', 1)", `${id}-passage`, id);
  run("INSERT INTO chunk_tag_suppressions (chunkId, tag, entity) VALUES (?, 'Characters', 'nora')", `${id}-passage`);
  run("INSERT INTO world_index_chunk_status (chunkId, status, updatedAt) VALUES (?, 'tagged', 1)", `${id}-passage`);
  run("INSERT INTO document_notes (id, documentId, workspaceId, body) VALUES (?, ?, 'ws', 'Check the date.')", `${id}-note`, id);
  run("INSERT INTO document_analyses (id, documentId, workspaceId, body, createdAt) VALUES (?, ?, 'ws', 'Consistent.', 1)", `${id}-analysis`, id);
  run("INSERT INTO pending_suggestions (id, documentId, workspaceId, fromPos, toPos) VALUES (?, ?, 'ws', 1, 2)", `${id}-suggestion`, id);
}

describe('deleting chapters', () => {
  beforeEach(() => {
    seedChapter('one');
    seedChapter('two');
    run(`INSERT INTO entities (id, workspaceId, type, canonicalName, loreDocumentId, data)
         VALUES ('nora', 'ws', 'Characters', 'Nora', 'one', ?)`,
    JSON.stringify({ loreDocumentIds: ['one', 'two'], _enrichPending: { chapters: [{ id: 'one', title: 'Chapter' }] } }));
  });

  test('removes what hangs off the chapter and unlinks it from entities', () => {
    purgeDocuments(harness.db, ['one']);

    expect(ids('SELECT id FROM documents')).toEqual(['two']);
    expect(ids('SELECT id FROM knowledge_chunks')).toEqual(['two-passage']);
    for (const table of ['knowledge_chunks_fts', 'chunk_tag_suppressions', 'world_index_chunk_status']) {
      expect(ids(`SELECT chunkId FROM ${table}`)).toEqual(['two-passage']);
    }
    for (const table of ['document_notes', 'document_analyses', 'pending_suggestions']) {
      expect(rows(`SELECT documentId FROM ${table}`).map(row => row.documentId)).toEqual(['two']);
    }
    const nora = rows("SELECT loreDocumentId, data FROM entities WHERE id = 'nora'")[0];
    expect(nora.loreDocumentId).toBe('two');
    expect(JSON.parse(nora.data)).toEqual({ loreDocumentIds: ['two'], _enrichPending: {} });
  });

  test('a folder takes its subfolders and their chapters with it', () => {
    run("INSERT INTO folders (id, workspaceId, name, parentId) VALUES ('part-one', 'ws', 'Part one', NULL), ('drafts', 'ws', 'Drafts', 'part-one'), ('part-two', 'ws', 'Part two', NULL)");
    seedChapter('inside', 'part-one');
    seedChapter('nested', 'drafts');
    seedChapter('elsewhere', 'part-two');

    expect(purgeFolder(harness.db, 'part-one')).toEqual({ folders: 2, documents: 2 });
    expect(ids('SELECT id FROM folders')).toEqual(['part-two']);
    expect(ids('SELECT id FROM documents ORDER BY id')).toEqual(['elsewhere', 'one', 'two']);
    expect(rows("SELECT COUNT(*) AS count FROM document_notes WHERE documentId IN ('inside', 'nested')")[0].count).toBe(0);
  });
});

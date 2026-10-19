import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const {
  WORKSPACE_OWNED_COLUMNS,
  WORKSPACE_OWNED_THROUGH,
  NOT_WORKSPACE_TABLES,
  purgeWorkspace
} = require('../../src/main/features/workspace/workspace-ownership.js');

const LOOKS_LIKE_A_WORKSPACE_COLUMN = /^(workspace_id|workspaceId|chatId)$/;

let harness: FullSchemaDatabase;
beforeEach(() => { harness = openFullSchemaDatabase(); });
afterEach(() => harness.close());

const rows = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).all(...params) as any[];
const count = (sql: string, ...params: unknown[]) => (harness.db.prepare(sql).get(...params) as any).count as number;
const columnsOf = (table: string) => rows(`PRAGMA table_info("${table}")`);
// FTS5 keeps its index in shadow tables named after the virtual table.
const schemaTables = () => rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .map(table => table.name as string)
  .filter(name => !name.startsWith('knowledge_chunks_fts_'));

describe('the registry of workspace-owned tables', () => {
  test('declares every table in the schema exactly once', () => {
    const declared = [
      ...WORKSPACE_OWNED_COLUMNS.map((entry: any) => entry.table),
      ...WORKSPACE_OWNED_THROUGH.map((entry: any) => entry.table),
      ...NOT_WORKSPACE_TABLES.map((entry: any) => entry.table)
    ];
    const duplicated = declared.filter((table, index) => declared.indexOf(table) !== index);
    const missing = schemaTables().filter(table => !declared.includes(table));
    expect(duplicated).toEqual([]);
    expect(missing).toEqual([]);
  });

  test('every table with a workspace column is owned by the workspace', () => {
    const shared = new Set(NOT_WORKSPACE_TABLES.map((entry: any) => entry.table));
    const leaking = schemaTables().filter(table => shared.has(table)
      && columnsOf(table).some(column => LOOKS_LIKE_A_WORKSPACE_COLUMN.test(column.name)));
    expect(leaking).toEqual([]);
  });

  test('names only columns the schema really has', () => {
    const unknown = WORKSPACE_OWNED_COLUMNS.filter((entry: any) => {
      const columns = columnsOf(entry.table).map(column => column.name);
      return columns.length > 0 && !columns.includes(entry.column);
    });
    expect(unknown).toEqual([]);
  });
});

// Columns that point at a parent under another name.
const PARENT_COLUMN: Record<string, string> = { narrative_event_id: 'event_id', source_event_id: 'event_id' };

// One row per owned table for each workspace. Values are named after their column, so a child
// row's event_id or card_id matches its parent's and the foreign keys hold.
function seedWorkspace(workspaceId: string) {
  const { db } = harness;
  db.prepare("INSERT INTO chats (id, title) VALUES (?, 'Story')").run(workspaceId);
  db.prepare("INSERT INTO messages (id, chatId, role, content, createdAt) VALUES (?, ?, 'user', 'Hello', 1)")
    .run(`message-${workspaceId}`, workspaceId);
  db.pragma('ignore_check_constraints = ON');
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    for (const { table, column } of WORKSPACE_OWNED_COLUMNS) {
      const columns = columnsOf(table);
      if (!columns.length) continue;
      const values = columns.map(info => {
        if (info.name === column) return workspaceId;
        if (/(_json|Json)$|^(data|aliases)$/.test(info.name)) return '{}';
        return /INT|REAL/i.test(info.type) ? 1 : `${PARENT_COLUMN[info.name] ?? info.name}-${workspaceId}`;
      });
      db.prepare(`INSERT INTO ${table} (${columns.map(info => `"${info.name}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...values);
    }
  })();
  db.pragma('ignore_check_constraints = OFF');

  const chapterId = `id-${workspaceId}`;
  const addChunk = (id: string, ownerId: string, ownerType: string) => {
    db.prepare("INSERT INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt) VALUES (?, ?, ?, 'Source', 'Text', '[]', 1)")
      .run(id, ownerId, ownerType);
    db.prepare("INSERT INTO chunk_tags (chunkId, tag, entity) VALUES (?, 'Characters', 'someone')").run(id);
    db.prepare("INSERT INTO chunk_tag_suppressions (chunkId, tag, entity) VALUES (?, 'Characters', 'someone')").run(id);
    db.prepare("INSERT INTO world_index_chunk_status (chunkId, status, updatedAt) VALUES (?, 'tagged', 1)").run(id);
  };
  addChunk(`memory-${workspaceId}`, workspaceId, 'chat_memory');
  addChunk(`file-${workspaceId}`, workspaceId, 'chat_kb');
  addChunk(`chapter-${workspaceId}`, chapterId, 'document');
}

describe('purgeWorkspace', () => {
  test('removes every row the workspace owns and leaves other workspaces alone', () => {
    seedWorkspace('ws');
    seedWorkspace('other');
    harness.db.prepare("INSERT INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt) VALUES ('profile-chunk', 'profile', 'profile_kb', 'Source', 'Text', '[]', 1)").run();

    purgeWorkspace(harness.db, 'ws');

    const left: string[] = [];
    const lost: string[] = [];
    for (const { table, column } of WORKSPACE_OWNED_COLUMNS) {
      if (!columnsOf(table).length) continue;
      if (count(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = 'ws'`)) left.push(table);
      if (!count(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = 'other'`)) lost.push(table);
    }
    expect(left).toEqual([]);
    expect(lost).toEqual([]);

    expect(rows('SELECT id FROM chats').map(row => row.id)).toEqual(['other']);
    expect(count("SELECT COUNT(*) AS count FROM messages WHERE chatId = 'ws'")).toBe(0);
    expect(rows('SELECT id FROM knowledge_chunks ORDER BY id').map(row => row.id))
      .toEqual(['chapter-other', 'file-other', 'memory-other', 'profile-chunk']);
    expect(rows('SELECT chunkId FROM knowledge_chunks_fts ORDER BY chunkId').map(row => row.chunkId))
      .toEqual(['chapter-other', 'file-other', 'memory-other', 'profile-chunk']);
    for (const table of ['chunk_tags', 'chunk_tag_suppressions', 'world_index_chunk_status']) {
      expect(rows(`SELECT chunkId FROM ${table} ORDER BY chunkId`).map(row => row.chunkId))
        .toEqual(['chapter-other', 'file-other', 'memory-other']);
    }
    expect(rows('PRAGMA foreign_key_check')).toEqual([]);
  });

  test('a failure leaves the workspace untouched', () => {
    seedWorkspace('ws');
    harness.db.exec(`
      CREATE TRIGGER fail_on_chat_delete BEFORE DELETE ON chats
      BEGIN SELECT RAISE(ABORT, 'disk full'); END;
    `);

    expect(() => purgeWorkspace(harness.db, 'ws')).toThrow('disk full');
    expect(count("SELECT COUNT(*) AS count FROM documents WHERE workspaceId = 'ws'")).toBe(1);
    expect(count("SELECT COUNT(*) AS count FROM knowledge_chunks WHERE ownerId = 'ws'")).toBe(2);
  });
});

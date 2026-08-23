import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const store = require('../src/main/features/chat/archive-store');
const { selectActiveMessages } = require('../src/main/features/chat/archive-coverage');

// better-sqlite3 is built against Electron's ABI, so the suite runs the same SQL
// through node:sqlite behind the small surface archive-store actually uses.
function createDatabase() {
  const raw = new DatabaseSync(':memory:');
  const database: any = {
    prepare: (sql: string) => {
      const statement = raw.prepare(sql);
      return {
        run: (...args: any[]) => ({ changes: Number(statement.run(...args).changes) }),
        get: (...args: any[]) => statement.get(...args),
        all: (...args: any[]) => statement.all(...args)
      };
    },
    transaction: (fn: any) => (...args: any[]) => fn(...args),
    exec: (sql: string) => raw.exec(sql)
  };

  database.exec(`
    CREATE TABLE chats (id TEXT PRIMARY KEY, summarizedIndex INTEGER DEFAULT 0, memoryBlocks TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, chatId TEXT, role TEXT, content TEXT, createdAt INTEGER, excluded INTEGER DEFAULT 0);
    CREATE TABLE knowledge_chunks (id TEXT PRIMARY KEY, ownerId TEXT, ownerType TEXT, source TEXT, text TEXT, tokenCount INTEGER, memoryBlockId TEXT);
    CREATE TABLE knowledge_chunks_fts (chunkId TEXT, text TEXT);
    CREATE TABLE chunk_tags (chunkId TEXT, tag TEXT, entity TEXT);
  `);
  return database;
}

function summaryBlock(id: string, from: number, to: number) {
  return {
    id,
    type: 'summarized',
    title: id,
    messages: Array.from({ length: to - from + 1 }, (_, index) => ({ id: `m${from + index}` }))
  };
}

function seed(database: any) {
  database.prepare('INSERT INTO chats VALUES (?, ?, ?)').run('c1', 0, '[]');
  for (let i = 1; i <= 90; i += 1) {
    database.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, 0)').run(`m${i}`, 'c1', 'user', `line ${i}`, i);
  }
  const blocks = [summaryBlock('A', 1, 30), summaryBlock('B', 31, 60), summaryBlock('C', 61, 90)];
  database.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(blocks), 'c1');

  for (const blockId of ['A', 'B', 'C']) {
    for (let k = 0; k < 3; k += 1) {
      database
        .prepare('INSERT INTO knowledge_chunks VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(`chunk_${blockId}${k}`, 'c1', 'chat_memory', 'Chat Archive', 'text', 100, blockId);
      database.prepare('INSERT INTO knowledge_chunks_fts VALUES (?, ?)').run(`chunk_${blockId}${k}`, 'text');
      database.prepare('INSERT INTO chunk_tags VALUES (?, ?, ?)').run(`chunk_${blockId}${k}`, 'tag', 'e1');
    }
  }
  return database;
}

function activeIds(database: any) {
  const messages = database.prepare('SELECT id, excluded FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all('c1');
  const blocks = database.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get('c1').memoryBlocks;
  return selectActiveMessages(messages, blocks).map((message: any) => message.id);
}

let db: any;
beforeEach(() => {
  db = seed(createDatabase());
});

describe('archive store', () => {
  test('a fully archived history derives the whole length', () => {
    expect(store.syncSummarizedIndex(db, 'c1')).toBe(90);
    expect(activeIds(db)).toEqual([]);
  });

  test('rebuilding the middle summary only restores its own messages', () => {
    store.syncSummarizedIndex(db, 'c1');
    const result = store.rebuildSummaryBlock(db, 'c1', 'B');

    expect(result.restoredMessages).toBe(30);
    expect(result.summarizedIndex).toBe(30);

    const active = activeIds(db);
    expect(active).toHaveLength(30);
    expect(active[0]).toBe('m31');
    expect(active.at(-1)).toBe('m60');
  });

  test('removing a summary clears its chunks, index rows and tags', () => {
    const result = store.rebuildSummaryBlock(db, 'c1', 'B');

    expect(result.removedChunks).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get().c).toBe(6);
    expect(db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks_fts').get().c).toBe(6);
    expect(db.prepare('SELECT COUNT(*) AS c FROM chunk_tags').get().c).toBe(6);
  });

  test('rebuilding the only summary unlocks the chat instead of stranding it', () => {
    store.rebuildSummaryBlock(db, 'c1', 'A');
    store.rebuildSummaryBlock(db, 'c1', 'B');
    const result = store.rebuildSummaryBlock(db, 'c1', 'C');

    expect(result.summarizedIndex).toBe(0);
    expect(activeIds(db)).toHaveLength(90);
  });

  test('token totals report stored history, grouped per summary', () => {
    expect(store.archiveTokenTotals(db, 'c1')).toEqual({
      A: { chunks: 3, tokens: 300 },
      B: { chunks: 3, tokens: 300 },
      C: { chunks: 3, tokens: 300 }
    });
  });

  test('dropping a message takes it out of live history', () => {
    store.rebuildSummaryBlock(db, 'c1', 'B');
    const result = store.setMessagesExcluded(db, 'c1', ['m40', 'm41'], true);

    expect(result.updated).toBe(2);
    expect(activeIds(db)).not.toContain('m40');
    expect(activeIds(db)).toHaveLength(28);
  });

  test('a dropped message can be restored', () => {
    store.rebuildSummaryBlock(db, 'c1', 'B');
    store.setMessagesExcluded(db, 'c1', ['m40'], true);
    store.setMessagesExcluded(db, 'c1', ['m40'], false);

    expect(activeIds(db)).toContain('m40');
  });

  test('rebuilding drops every summary and its chunks', () => {
    const result = store.resetSummaries(db, 'c1');

    expect(result).toEqual({ removedSummaries: 3, removedChunks: 9, restoredDropped: 0, summarizedIndex: 0 });
    expect(db.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks').get().c).toBe(0);
    expect(activeIds(db)).toHaveLength(90);
  });

  test('rebuilding leaves custom memory snippets alone', () => {
    const blocks = [
      summaryBlock('A', 1, 30),
      { id: 'manual_1', type: 'manual', title: 'note', summary: 'keep me' }
    ];
    db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(blocks), 'c1');

    store.resetSummaries(db, 'c1');
    const remaining = JSON.parse(db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get('c1').memoryBlocks);

    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('manual_1');
  });

  test('deleting a summary drops its messages instead of returning them', () => {
    const result = store.deleteSummaryBlock(db, 'c1', 'B');

    expect(result.droppedMessages).toBe(30);
    expect(activeIds(db)).toEqual([]);
    const excluded = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE excluded = 1').get().c;
    expect(excluded).toBe(30);
  });

  test('a full rebuild brings back messages dropped by a delete', () => {
    store.deleteSummaryBlock(db, 'c1', 'B');
    const result = store.resetSummaries(db, 'c1');

    expect(result.restoredDropped).toBe(30);
    expect(activeIds(db)).toHaveLength(90);
    expect(db.prepare('SELECT COUNT(*) AS c FROM messages WHERE excluded = 1').get().c).toBe(0);
  });

  test('a full rebuild also restores messages the user dropped by hand', () => {
    store.rebuildSummaryBlock(db, 'c1', 'B');
    store.setMessagesExcluded(db, 'c1', ['m40'], true);
    store.resetSummaries(db, 'c1');

    expect(activeIds(db)).toContain('m40');
  });

  test('deleting a message keeps the derived index truthful', () => {
    store.rebuildSummaryBlock(db, 'c1', 'B');
    db.prepare('DELETE FROM messages WHERE id = ?').run('m5');

    expect(store.syncSummarizedIndex(db, 'c1')).toBe(29);
  });
});

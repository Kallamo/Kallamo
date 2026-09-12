import { DatabaseSync } from 'node:sqlite';

// A better-sqlite3 shaped wrapper over node:sqlite, so modules that take `db` run in tests.
export function createTestDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE entities (id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL,
      aliases TEXT, lore TEXT, loreDocumentId TEXT, data TEXT, status TEXT NOT NULL DEFAULT 'confirmed', createdAt INTEGER, last_modified INTEGER DEFAULT 0);
    CREATE TABLE documents (id TEXT PRIMARY KEY, workspaceId TEXT);
    CREATE TABLE knowledge_chunks (id TEXT PRIMARY KEY, ownerId TEXT, ownerType TEXT, source TEXT, text TEXT, createdAt INTEGER, enabled INTEGER DEFAULT 1);
    CREATE TABLE chunk_tags (chunkId TEXT NOT NULL, tag TEXT NOT NULL, entity TEXT, manual INTEGER DEFAULT 0, origin TEXT, PRIMARY KEY (chunkId, tag, entity));
    CREATE TABLE chunk_tag_suppressions (chunkId TEXT NOT NULL, tag TEXT NOT NULL, entity TEXT NOT NULL, PRIMARY KEY (chunkId, tag, entity));
    CREATE TABLE world_index_chunk_status (chunkId TEXT PRIMARY KEY, status TEXT NOT NULL, tagCount INTEGER NOT NULL DEFAULT 0,
      lastRunId TEXT, error TEXT, updatedAt INTEGER NOT NULL, rejectedMentions INTEGER NOT NULL DEFAULT 0);
  `);
  let depth = 0;
  return {
    raw,
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction: <T extends unknown[], R>(fn: (...args: T) => R) => (...args: T): R => {
      if (depth > 0) return fn(...args);
      depth++;
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      } finally {
        depth--;
      }
    },
  };
}

export function addEntity(db: ReturnType<typeof createTestDb>, entity: { id: string; workspaceId?: string; type: string; canonicalName: string; aliases?: string[]; status?: string }) {
  db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, data, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(entity.id, entity.workspaceId || 'ws', entity.type, entity.canonicalName, JSON.stringify(entity.aliases || []), '{}', entity.status || 'confirmed');
}

export function addChunk(db: ReturnType<typeof createTestDb>, chunk: { id: string; text: string; ownerId?: string; ownerType?: string; createdAt?: number }) {
  db.prepare('INSERT INTO knowledge_chunks (id, ownerId, ownerType, source, text, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(chunk.id, chunk.ownerId || 'ws', chunk.ownerType || 'chat_memory', 'Chat Archive', chunk.text, chunk.createdAt || 0);
}

export function tagsOf(db: ReturnType<typeof createTestDb>, chunkId: string) {
  return db.prepare('SELECT tag, entity, manual, origin FROM chunk_tags WHERE chunkId = ? ORDER BY entity').all(chunkId) as Array<{ tag: string; entity: string; manual: number; origin: string | null }>;
}

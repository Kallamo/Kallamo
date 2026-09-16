// Tags written from registered names found in a chunk, without a model. Only rows with
// origin 'name' are ever pruned here; manual and model tags are left as they are.

const { buildNameIndex, literalEntityMentions, collectLowercaseWords } = require('./literal-mentions');
const { recountChunkStatus } = require('./chunk-status');

const NAME_TAG_MIGRATION_KEY = 'migration.nameTags.v1';

function parseAliases(raw) {
  try { const list = JSON.parse(raw || '[]'); return Array.isArray(list) ? list : []; } catch { return []; }
}

function loadWorkspaceEntities(db, workspaceId) {
  return db.prepare('SELECT id, type, canonicalName, aliases, status, data FROM entities WHERE workspaceId IS ?')
    .all(workspaceId || null)
    .map(row => ({ ...row, aliases: parseAliases(row.aliases) }));
}

// Chat memory and files belong to the workspace; chapters belong to a document of it.
function loadWorkspaceChunks(db, workspaceId) {
  return db.prepare(`
    SELECT kc.id, kc.text FROM knowledge_chunks kc
    WHERE (kc.ownerId = ? AND kc.ownerType IN ('chat_memory', 'chat_kb'))
       OR (kc.ownerType = 'document' AND kc.ownerId IN (SELECT id FROM documents WHERE workspaceId = ?))
    ORDER BY kc.createdAt ASC
  `).all(workspaceId, workspaceId);
}

function createNameMatcher(db, workspaceId, texts = null) {
  const entities = loadWorkspaceEntities(db, workspaceId);
  if (!entities.length) return { empty: true, entities };
  const corpus = texts || loadWorkspaceChunks(db, workspaceId).map(chunk => chunk.text);
  return { empty: false, entities, index: buildNameIndex(entities), lowercaseWords: collectLowercaseWords(corpus) };
}

// `detected` lists, per chunk id, the entities found by name, so the model is not asked for them again.
function applyNameTags(db, workspaceId, records, { entityIds = null, prune = false, matcher = null } = {}) {
  const detected = new Map();
  const list = Array.isArray(records) ? records.filter(record => record && record.id) : [];
  if (!workspaceId || !list.length) return { rows: 0, pruned: 0, detected };
  const names = matcher || createNameMatcher(db, workspaceId);
  if (names.empty && !prune) return { rows: 0, pruned: 0, detected };

  const only = entityIds ? new Set(entityIds) : null;
  const insert = db.prepare("INSERT OR IGNORE INTO chunk_tags (chunkId, tag, entity, manual, origin) VALUES (?, ?, ?, 0, 'name')");
  const suppressed = db.prepare('SELECT 1 FROM chunk_tag_suppressions WHERE chunkId = ? AND entity = ?');
  const nameRows = db.prepare("SELECT tag, entity FROM chunk_tags WHERE chunkId = ? AND origin = 'name' AND (manual IS NULL OR manual = 0)");
  const remove = db.prepare("DELETE FROM chunk_tags WHERE chunkId = ? AND tag = ? AND entity = ? AND origin = 'name' AND (manual IS NULL OR manual = 0)");
  let rows = 0;
  let pruned = 0;
  db.transaction(() => {
    for (const record of list) {
      const found = names.empty ? [] : literalEntityMentions(record.text, names.index, { lowercaseWords: names.lowercaseWords })
        .filter(mention => (!only || only.has(mention.entityId)) && !suppressed.get(record.id, mention.entityId));
      detected.set(record.id, found);
      for (const mention of found) rows += insert.run(record.id, mention.type, mention.entityId).changes;
      if (!prune) continue;
      const keep = new Set(found.map(mention => `${mention.type}|${mention.entityId}`));
      for (const row of nameRows.all(record.id)) {
        if (only && !only.has(row.entity)) continue;
        if (!keep.has(`${row.tag}|${row.entity}`)) pruned += remove.run(record.id, row.tag, row.entity).changes;
      }
    }
  })();
  return { rows, pruned, detected };
}

// After names change: tags every chunk of the workspace that now names the entity,
// and drops name tags whose name is no longer in the chunk.
function refreshWorkspaceNameTags(db, workspaceId, { entityIds = null } = {}) {
  if (!workspaceId) return { rows: 0, pruned: 0, chunks: 0 };
  const chunks = loadWorkspaceChunks(db, workspaceId);
  if (!chunks.length) return { rows: 0, pruned: 0, chunks: 0 };
  const matcher = createNameMatcher(db, workspaceId, chunks.map(chunk => chunk.text));
  const result = applyNameTags(db, workspaceId, chunks, { entityIds, prune: true, matcher });
  if (result.rows || result.pruned) recountChunkStatus(db, chunks.map(chunk => chunk.id));
  return { rows: result.rows, pruned: result.pruned, chunks: chunks.length };
}

// One pass over existing data. Adds tags only, and brings stored counts in line with chunk_tags.
function migrateNameTags(db) {
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(NAME_TAG_MIGRATION_KEY)) return null;
  const workspaces = db.prepare('SELECT DISTINCT workspaceId FROM entities WHERE workspaceId IS NOT NULL').all().map(row => row.workspaceId);
  let rows = 0;
  for (const workspaceId of workspaces) rows += refreshWorkspaceNameTags(db, workspaceId).rows;
  const recounted = recountChunkStatus(db);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(NAME_TAG_MIGRATION_KEY, JSON.stringify({ workspaces: workspaces.length, rows, recounted, ts: Date.now() }));
  return { workspaces: workspaces.length, rows, recounted };
}

module.exports = {
  loadWorkspaceEntities,
  loadWorkspaceChunks,
  createNameMatcher,
  applyNameTags,
  refreshWorkspaceNameTags,
  migrateNameTags,
  NAME_TAG_MIGRATION_KEY,
};

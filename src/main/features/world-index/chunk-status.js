// Coverage per chunk. tagCount is read from chunk_tags at write time, so it never
// disagrees with the tags a chunk actually carries.

function saveChunkStatus(db, records, status, { runId = null, error = null, rejected = null } = {}) {
  const list = Array.isArray(records) ? records.filter(record => record && record.id) : [];
  if (!list.length) return;
  const save = db.prepare(`
    INSERT INTO world_index_chunk_status (chunkId, status, tagCount, lastRunId, error, rejectedMentions, updatedAt)
    VALUES (?, ?, (SELECT COUNT(*) FROM chunk_tags WHERE chunkId = ?), ?, ?, ?, ?)
    ON CONFLICT(chunkId) DO UPDATE SET
      status = excluded.status,
      tagCount = excluded.tagCount,
      lastRunId = excluded.lastRunId,
      error = excluded.error,
      rejectedMentions = excluded.rejectedMentions,
      updatedAt = excluded.updatedAt
  `);
  const now = Date.now();
  db.transaction(() => {
    for (const record of list) {
      const count = rejected instanceof Map ? (rejected.get(record.id) || 0) : 0;
      save.run(record.id, status, record.id, runId, error, count, now);
    }
  })();
}

function recountChunkStatus(db, chunkIds = null) {
  const recount = 'UPDATE world_index_chunk_status SET tagCount = (SELECT COUNT(*) FROM chunk_tags ct WHERE ct.chunkId = world_index_chunk_status.chunkId)';
  if (!chunkIds) return db.prepare(recount).run().changes;
  const update = db.prepare(`${recount} WHERE chunkId = ?`);
  let changes = 0;
  db.transaction(() => { for (const id of chunkIds) changes += update.run(id).changes; })();
  return changes;
}

module.exports = { saveChunkStatus, recountChunkStatus };

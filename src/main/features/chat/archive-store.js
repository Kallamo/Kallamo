// Every mutation of live history goes through here so summarizedIndex and chunks can't drift.

const { parseMemoryBlocks, deriveSummarizedIndex } = require('./archive-coverage');
const { THREADS, normalizeThread, threadOfBlock, threadSummaryBlocks, readThreadMessages, writeThreadState } = require('./threads');

function readMemoryBlocks(database, chatId) {
  const row = database.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(chatId);
  return parseMemoryBlocks(row && row.memoryBlocks);
}

function writeMemoryBlocks(database, chatId, blocks) {
  database.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(blocks), chatId);
}

const hasRoleplayState = (database, chatId) => Boolean(
  database.prepare("SELECT 1 FROM workspace_threads WHERE workspace_id = ? AND thread = 'roleplay'").get(chatId)
  || database.prepare("SELECT 1 FROM messages WHERE chatId = ? AND thread = 'roleplay' LIMIT 1").get(chatId)
);

// Keeps the legacy marker equal to what coverage already says. Call after any
// change to summaries, to the excluded flag, or to the message list itself.
// Without a thread both conversations are synced; the Chat's index is returned.
function syncSummarizedIndex(database, chatId, thread) {
  const blocks = readMemoryBlocks(database, chatId);
  const targets = thread ? [normalizeThread(thread)] : THREADS;
  const indexes = {};
  for (const target of targets) {
    if (target === 'roleplay' && !hasRoleplayState(database, chatId)) continue;
    const index = deriveSummarizedIndex(readThreadMessages(database, chatId, target), threadSummaryBlocks(blocks, target));
    writeThreadState(database, chatId, target, { summarizedIndex: index });
    indexes[target] = index;
  }
  return thread ? (indexes[normalizeThread(thread)] ?? 0) : (indexes.chat ?? 0);
}

// Chunks belong to a block through memoryBlockId; their own ids are chunk ids.
function deleteBlockChunks(database, blockIds) {
  const ids = (Array.isArray(blockIds) ? blockIds : [blockIds]).filter(Boolean);
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const chunks = database
    .prepare(`SELECT id FROM knowledge_chunks WHERE memoryBlockId IN (${placeholders})`)
    .all(...ids);
  if (chunks.length === 0) return 0;

  const deleteChunk = database.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
  const deleteTags = database.prepare('DELETE FROM chunk_tags WHERE chunkId = ?');
  database.transaction(() => {
    for (const chunk of chunks) {
      deleteChunk.run(chunk.id);
      deleteTags.run(chunk.id);
    }
  })();
  return chunks.length;
}

// The ids a summary block claims, whether it stores whole messages or just ids.
function blockMessageIds(block) {
  const messages = block && Array.isArray(block.messages) ? block.messages : [];
  return messages
    .map(message => (typeof message === 'string' ? message : message && message.id))
    .filter(Boolean);
}

// Takes one summary out of the chat and returns the ids it covered.
function removeSummaryBlock(database, chatId, blockId) {
  const blocks = readMemoryBlocks(database, chatId);
  const target = blocks.find(block => block && block.id === blockId);
  writeMemoryBlocks(database, chatId, blocks.filter(block => !block || block.id !== blockId));
  const removedChunks = deleteBlockChunks(database, blockId);
  return { messageIds: blockMessageIds(target), removedChunks };
}

// Rebuild one summary: it disappears and its messages go back to the live
// conversation, ready to be archived again in a different shape.
function rebuildSummaryBlock(database, chatId, blockId) {
  const { messageIds, removedChunks } = removeSummaryBlock(database, chatId, blockId);
  const summarizedIndex = syncSummarizedIndex(database, chatId);
  return { removedChunks, restoredMessages: messageIds.length, summarizedIndex };
}

// Covered messages are dropped, not returned; only a full rebuild brings them back.
function deleteSummaryBlock(database, chatId, blockId) {
  const { messageIds, removedChunks } = removeSummaryBlock(database, chatId, blockId);
  const dropped = markExcluded(database, chatId, messageIds, true);
  const summarizedIndex = syncSummarizedIndex(database, chatId);
  return { removedChunks, droppedMessages: dropped, summarizedIndex };
}

// The one way out of any archive state, so it must leave nothing muted. Only the given conversation is reset.
function resetSummaries(database, chatId, thread = 'chat') {
  const target = normalizeThread(thread);
  const blocks = readMemoryBlocks(database, chatId);
  const ownSummary = block => block && block.type === 'summarized' && threadOfBlock(block) === target;
  const summaryIds = blocks.filter(ownSummary).map(block => block.id);
  writeMemoryBlocks(database, chatId, blocks.filter(block => !ownSummary(block)));
  const removedChunks = deleteBlockChunks(database, summaryIds);
  const restoredDropped = database
    .prepare('UPDATE messages SET excluded = 0 WHERE chatId = ? AND thread = ? AND excluded = 1')
    .run(chatId, target).changes;
  const summarizedIndex = syncSummarizedIndex(database, chatId, target);
  return { removedSummaries: summaryIds.length, removedChunks, restoredDropped, summarizedIndex };
}

/** What a move would do, read only: which messages go, where they land, which summaries follow. */
function planThreadMove(database, chatId, messageIds, toThread) {
  const target = normalizeThread(toThread);
  const ids = [...new Set((Array.isArray(messageIds) ? messageIds : [messageIds]).filter(Boolean))];
  const plan = { target, moving: [], movedSummaries: [], mixedSummaries: [], position: 'empty', before: null, after: null };
  if (!ids.length) return plan;
  const placeholders = ids.map(() => '?').join(',');
  const moving = database
    .prepare(`SELECT id, createdAt FROM messages WHERE chatId = ? AND thread != ? AND id IN (${placeholders}) ORDER BY createdAt ASC, id ASC`)
    .all(chatId, target, ...ids);
  plan.moving = moving.map(row => row.id);
  if (!moving.length) return plan;
  const movingIds = new Set(plan.moving);
  for (const block of readMemoryBlocks(database, chatId)) {
    if (!block || block.type !== 'summarized' || threadOfBlock(block) === target) continue;
    const covered = blockMessageIds(block);
    const touched = covered.filter(id => movingIds.has(id)).length;
    if (!touched) continue;
    const summary = { id: block.id, title: block.title || '' };
    if (touched === covered.length) plan.movedSummaries.push(summary);
    else plan.mixedSummaries.push({ ...summary, moving: touched });
  }
  // Where the first moved message lands among the messages already there, by when it was written.
  const first = moving[0];
  const neighbor = (sign, order) => database.prepare(`
    SELECT id, createdAt FROM messages WHERE chatId = ? AND thread = ?
      AND (createdAt ${sign} ? OR (createdAt = ? AND id ${sign} ?))
    ORDER BY createdAt ${order}, id ${order} LIMIT 1
  `).get(chatId, target, first.createdAt, first.createdAt, first.id);
  plan.before = neighbor('<', 'DESC') || null;
  plan.after = neighbor('>', 'ASC') || null;
  plan.position = !plan.before && !plan.after ? 'empty' : !plan.before ? 'start' : !plan.after ? 'end' : 'between';
  return plan;
}

// Only `thread` changes, so ids and everything tied to them stay. A summary that also covers
// messages left behind stays put; splitMixedSummary can replace it with one per side.
function moveMessagesToThread(database, chatId, messageIds, toThread) {
  const result = { moved: 0, movedSummaries: [], mixedSummaries: [] };
  database.transaction(() => {
    const plan = planThreadMove(database, chatId, messageIds, toThread);
    if (!plan.moving.length) return;
    const moved = new Set(plan.movedSummaries.map(summary => summary.id));
    const kept = readMemoryBlocks(database, chatId).map(block => {
      if (!block || !moved.has(block.id)) return block;
      return plan.target === 'chat' ? withoutThread(block) : { ...block, thread: plan.target };
    });
    result.movedSummaries = plan.movedSummaries;
    result.mixedSummaries = plan.mixedSummaries;
    writeMemoryBlocks(database, chatId, kept);
    const update = database.prepare('UPDATE messages SET thread = ? WHERE id = ? AND chatId = ?');
    for (const id of plan.moving) result.moved += update.run(plan.target, id, chatId).changes;
    syncSummarizedIndex(database, chatId);
  })();
  return result;
}

const withoutThread = block => {
  const { thread, ...rest } = block;
  return rest;
};

// A covered message can't be excluded: it is already out of the payload.
function markExcluded(database, chatId, messageIds, excluded) {
  const ids = (Array.isArray(messageIds) ? messageIds : [messageIds]).filter(Boolean);
  if (ids.length === 0) return 0;

  const update = database.prepare('UPDATE messages SET excluded = ? WHERE id = ? AND chatId = ?');
  const value = excluded ? 1 : 0;
  let updated = 0;
  database.transaction(() => {
    for (const id of ids) {
      updated += update.run(value, id, chatId).changes;
    }
  })();
  return updated;
}

function setMessagesExcluded(database, chatId, messageIds, excluded) {
  const updated = markExcluded(database, chatId, messageIds, excluded);
  return { updated, summarizedIndex: syncSummarizedIndex(database, chatId) };
}

// How many tokens of history each summary actually holds, which is what the
// memory view should show instead of the length of the recap text.
function archiveTokenTotals(database, chatId) {
  const rows = database
    .prepare(
      `SELECT memoryBlockId AS blockId, COUNT(*) AS chunks, COALESCE(SUM(tokenCount), 0) AS tokens
       FROM knowledge_chunks
       WHERE ownerId = ? AND ownerType = 'chat_memory' AND memoryBlockId IS NOT NULL
       GROUP BY memoryBlockId`
    )
    .all(chatId);

  const totals = {};
  for (const row of rows) {
    totals[row.blockId] = { chunks: row.chunks, tokens: row.tokens };
  }
  return totals;
}

module.exports = {
  readMemoryBlocks,
  syncSummarizedIndex,
  moveMessagesToThread,
  planThreadMove,
  blockMessageIds,
  deleteBlockChunks,
  deleteSummaryBlock,
  rebuildSummaryBlock,
  resetSummaries,
  setMessagesExcluded,
  archiveTokenTotals
};

// Database side of chat archiving. Every mutation that can change which
// messages are live history goes through here, so the derived summarizedIndex
// and the vectorized chunks can never drift away from the summary blocks.

const { parseMemoryBlocks, deriveSummarizedIndex } = require('./archive-coverage');

function readChatMessages(database, chatId) {
  return database
    .prepare('SELECT id, excluded FROM messages WHERE chatId = ? ORDER BY createdAt ASC, id ASC')
    .all(chatId);
}

function readMemoryBlocks(database, chatId) {
  const row = database.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(chatId);
  return parseMemoryBlocks(row && row.memoryBlocks);
}

function writeMemoryBlocks(database, chatId, blocks) {
  database.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(blocks), chatId);
}

// Keeps the legacy marker equal to what coverage already says. Call after any
// change to summaries, to the excluded flag, or to the message list itself.
function syncSummarizedIndex(database, chatId) {
  const messages = readChatMessages(database, chatId);
  const blocks = readMemoryBlocks(database, chatId);
  const index = deriveSummarizedIndex(messages, blocks);
  database.prepare('UPDATE chats SET summarizedIndex = ? WHERE id = ?').run(index, chatId);
  return index;
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
  const deleteFts = database.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
  const deleteTags = database.prepare('DELETE FROM chunk_tags WHERE chunkId = ?');
  database.transaction(() => {
    for (const chunk of chunks) {
      deleteChunk.run(chunk.id);
      deleteFts.run(chunk.id);
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

// Takes one summary out of the chat and returns the ids it covered. Shared by
// rebuild and delete, which differ only in what happens to those messages next.
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

// Delete one summary: the recap and the stored history both go, and the messages
// it covered are dropped rather than returned to the conversation. They stay in
// the log, and a full rebuild is what brings them back.
function deleteSummaryBlock(database, chatId, blockId) {
  const { messageIds, removedChunks } = removeSummaryBlock(database, chatId, blockId);
  const dropped = markExcluded(database, chatId, messageIds, true);
  const summarizedIndex = syncSummarizedIndex(database, chatId);
  return { removedChunks, droppedMessages: dropped, summarizedIndex };
}

// Full rebuild: every summary goes and the whole conversation comes back,
// including messages dropped by an earlier delete. This is the one way out of
// any archive state, so it must leave nothing muted behind. Custom memory
// snippets and uploaded files are left alone.
function resetSummaries(database, chatId) {
  const blocks = readMemoryBlocks(database, chatId);
  const summaryIds = blocks.filter(block => block && block.type === 'summarized').map(block => block.id);
  writeMemoryBlocks(database, chatId, blocks.filter(block => !block || block.type !== 'summarized'));
  const removedChunks = deleteBlockChunks(database, summaryIds);
  const restoredDropped = database
    .prepare('UPDATE messages SET excluded = 0 WHERE chatId = ? AND excluded = 1')
    .run(chatId).changes;
  const summarizedIndex = syncSummarizedIndex(database, chatId);
  return { removedSummaries: summaryIds.length, removedChunks, restoredDropped, summarizedIndex };
}

// Excluded messages stay visible in the log but leave the payload for good.
// A message that a summary already covers cannot be excluded: it is archived,
// and muting it would only hide it from a place it no longer occupies.
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
  deleteBlockChunks,
  deleteSummaryBlock,
  rebuildSummaryBlock,
  resetSummaries,
  setMessagesExcluded,
  archiveTokenTotals
};

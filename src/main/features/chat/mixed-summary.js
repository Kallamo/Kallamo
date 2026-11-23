// Replaces a summary that covers both conversations with one per side, each made the way Summarize
// makes it. The old one goes only after the new ones have their recap; any failure removes them and keeps it.
const { readMemoryBlocks, blockMessageIds, rebuildSummaryBlock } = require('./archive-store');
const { normalizeThread } = require('./threads');

async function replaceMixedSummary({ database, chatId, blockId, profileId, onProgress = null, summarize, finalize, recapFailed, describeError = error => error.message }) {
  const block = readMemoryBlocks(database, chatId).find(entry => entry && entry.id === blockId);
  if (!block) return { success: false, missing: true, blockId };
  const ids = blockMessageIds(block);
  const rows = ids.length
    ? database.prepare(`SELECT id, thread FROM messages WHERE chatId = ? AND id IN (${ids.map(() => '?').join(',')})`).all(chatId, ...ids)
    : [];
  const created = [];
  try {
    for (const thread of ['roleplay', 'chat']) {
      const sideIds = rows.filter(row => normalizeThread(row.thread) === thread).map(row => row.id);
      if (!sideIds.length) continue;
      const made = await summarize({
        chatId, thread, messageIds: sideIds, profileId, ignoreBlockIds: [blockId],
        customTitle: block.autoTitle ? undefined : block.title,
        onProgress
      });
      if (!made?.blockId) continue;
      created.push(made.blockId);
      const finished = await finalize({ chatId, blockId: made.blockId, onProgress });
      if (!finished?.success || recapFailed(finished.recapStatus)) {
        throw new Error(finished?.recapError || 'The recap could not be written.');
      }
    }
    if (!created.length) throw new Error('None of its messages could be summarized again.');
  } catch (error) {
    for (const id of created) rebuildSummaryBlock(database, chatId, id);
    console.error(`[Threads] Could not rebuild summary ${blockId}; it stays as it was:`, error);
    return { success: false, blockId, title: block.title || '', error: describeError(error) || error.message };
  }
  rebuildSummaryBlock(database, chatId, blockId);
  return { success: true, blockId, title: block.title || '', created };
}

module.exports = { replaceMixedSummary };

// The Chat's state lives on the `chats` row; the Roleplay's in `workspace_threads`, created on first
// write from the workspace's values. Read and write either only through this module.

const THREADS = Object.freeze(['chat', 'roleplay']);
const DEFAULT_ARCHIVE_THRESHOLD = 60000;

const normalizeThread = value => (value === 'roleplay' ? 'roleplay' : 'chat');

// A summary with no thread belongs to the Chat.
const threadOfBlock = block => normalizeThread(block && block.thread);

const isSummaryBlock = block => Boolean(block && block.type === 'summarized');

/** Summary blocks of one conversation; notes and files belong to the whole workspace. */
function threadSummaryBlocks(blocks, thread) {
  const wanted = normalizeThread(thread);
  return (Array.isArray(blocks) ? blocks : []).filter(block => isSummaryBlock(block) && threadOfBlock(block) === wanted);
}

/** Every block a conversation reads: shared notes and files, plus its own summaries. */
function blocksForThread(blocks, thread) {
  const wanted = normalizeThread(thread);
  return (Array.isArray(blocks) ? blocks : []).filter(block => !isSummaryBlock(block) || threadOfBlock(block) === wanted);
}

function readThreadMessages(db, workspaceId, thread, columns = 'id, excluded') {
  return db.prepare(`SELECT ${columns} FROM messages WHERE chatId = ? AND thread = ? ORDER BY createdAt ASC, id ASC`)
    .all(workspaceId, normalizeThread(thread));
}

function messageThread(db, messageId) {
  const row = db.prepare('SELECT thread FROM messages WHERE id = ?').get(messageId);
  return row ? normalizeThread(row.thread) : null;
}

function readRoleplayRow(db, workspaceId) {
  return db.prepare(`
    SELECT summarized_index, auto_summarize, archive_threshold, last_target_id
    FROM workspace_threads WHERE workspace_id = ? AND thread = 'roleplay'
  `).get(workspaceId);
}

function readThreadState(db, workspaceId, thread) {
  const chat = db.prepare('SELECT summarizedIndex, autoSummarize, archiveThreshold, lastTargetId FROM chats WHERE id = ?').get(workspaceId) || {};
  if (normalizeThread(thread) === 'chat') {
    return {
      summarizedIndex: chat.summarizedIndex || 0,
      autoSummarize: chat.autoSummarize || 0,
      archiveThreshold: chat.archiveThreshold || DEFAULT_ARCHIVE_THRESHOLD,
      lastTargetId: chat.lastTargetId || null
    };
  }
  const row = readRoleplayRow(db, workspaceId);
  return {
    summarizedIndex: row ? row.summarized_index : 0,
    autoSummarize: row ? row.auto_summarize : (chat.autoSummarize || 0),
    archiveThreshold: (row && row.archive_threshold) || chat.archiveThreshold || DEFAULT_ARCHIVE_THRESHOLD,
    lastTargetId: row ? row.last_target_id : null
  };
}

const CHAT_COLUMNS = {
  summarizedIndex: 'summarizedIndex',
  autoSummarize: 'autoSummarize',
  archiveThreshold: 'archiveThreshold',
  lastTargetId: 'lastTargetId'
};

function writeThreadState(db, workspaceId, thread, patch) {
  const keys = Object.keys(patch || {}).filter(key => key in CHAT_COLUMNS);
  if (!keys.length) return readThreadState(db, workspaceId, thread);
  if (normalizeThread(thread) === 'chat') {
    const sets = keys.map(key => `${CHAT_COLUMNS[key]} = ?`).join(', ');
    db.prepare(`UPDATE chats SET ${sets} WHERE id = ?`).run(...keys.map(key => patch[key]), workspaceId);
    return readThreadState(db, workspaceId, 'chat');
  }
  const next = { ...readThreadState(db, workspaceId, 'roleplay'), ...Object.fromEntries(keys.map(key => [key, patch[key]])) };
  db.prepare(`
    INSERT INTO workspace_threads (workspace_id, thread, summarized_index, auto_summarize, archive_threshold, last_target_id)
    VALUES (?, 'roleplay', ?, ?, ?, ?)
    ON CONFLICT(workspace_id, thread) DO UPDATE SET
      summarized_index = excluded.summarized_index,
      auto_summarize = excluded.auto_summarize,
      archive_threshold = excluded.archive_threshold,
      last_target_id = excluded.last_target_id
  `).run(workspaceId, next.summarizedIndex || 0, next.autoSummarize ? 1 : 0, next.archiveThreshold || DEFAULT_ARCHIVE_THRESHOLD, next.lastTargetId || null);
  return next;
}

// How much the Chat reads of the Roleplay, and what the Writing Desk reads. Workspace settings.
const SHARE_MIN = 10;
const SHARE_MAX = 90;
const clampShare = (value, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(SHARE_MAX, Math.max(SHARE_MIN, number)) : fallback;
};
const DESK_SOURCES = ['none', 'chat', 'roleplay', 'both'];

function readHistorySettings(chat) {
  const row = chat || {};
  // With no source chosen, wdUseChatHistory decides: on reads the Chat.
  const legacySource = row.wdUseChatHistory === 0 ? 'none' : 'chat';
  return {
    chatReadsRoleplay: row.chatReadsRoleplay !== 0,
    chatRoleplayShare: clampShare(row.chatRoleplayShare, 30),
    chatRoleplaySummaries: row.chatRoleplaySummaries !== 0,
    deskSource: DESK_SOURCES.includes(row.wdHistorySource) ? row.wdHistorySource : legacySource,
    deskShare: clampShare(row.wdHistoryShare, 25),
    deskRoleplaySplit: clampShare(row.wdHistorySplit, 60),
    deskSummaries: row.wdHistorySummaries !== 0
  };
}

module.exports = {
  THREADS,
  DESK_SOURCES,
  normalizeThread,
  threadOfBlock,
  threadSummaryBlocks,
  blocksForThread,
  readThreadMessages,
  messageThread,
  readThreadState,
  writeThreadState,
  readHistorySettings,
  clampShare
};

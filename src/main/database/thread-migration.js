// Splits each roleplay workspace's history into the Chat and the Roleplay. Nothing is deleted and
// no message id changes, so every table keyed by a turn's message id keeps pointing at it.
const { parseMemoryBlocks, deriveSummarizedIndex } = require('../features/chat/archive-coverage');

const hasTable = (db, name) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
);
const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);

// Tables that hold a roleplay turn under the reply's message id. User messages carry no mark.
const TURN_MARKS = ['roleplay_message_frames', 'roleplay_turn_snapshots', 'narrative_origin_lifecycle'];

const CHAT_SETTING_COLUMNS = [
  ['chatReadsRoleplay', 'INTEGER DEFAULT 1'],
  ['chatRoleplayShare', 'INTEGER DEFAULT 30'],
  ['chatRoleplaySummaries', 'INTEGER DEFAULT 1'],
  ['wdHistorySource', 'TEXT'],
  ['wdHistoryShare', 'INTEGER DEFAULT 25'],
  ['wdHistorySplit', 'INTEGER DEFAULT 60'],
  ['wdHistorySummaries', 'INTEGER DEFAULT 1']
];

// Idempotent: also run on every boot, since an old database may have recorded migrations before its base tables existed.
function ensureThreadSchema(db) {
  if (!hasTable(db, 'messages') || !hasTable(db, 'chats')) return false;
  if (!columnsOf(db, 'messages').includes('thread')) {
    db.exec("ALTER TABLE messages ADD COLUMN thread TEXT NOT NULL DEFAULT 'chat'");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (chatId, thread, createdAt, id);
    CREATE TABLE IF NOT EXISTS workspace_threads (
      workspace_id TEXT NOT NULL,
      thread TEXT NOT NULL CHECK (thread IN ('chat', 'roleplay')),
      summarized_index INTEGER NOT NULL DEFAULT 0,
      auto_summarize INTEGER NOT NULL DEFAULT 0,
      archive_threshold INTEGER NOT NULL DEFAULT 60000,
      last_target_id TEXT,
      PRIMARY KEY (workspace_id, thread)
    );
  `);
  const chatColumns = columnsOf(db, 'chats');
  for (const [name, type] of CHAT_SETTING_COLUMNS) {
    if (!chatColumns.includes(name)) db.exec(`ALTER TABLE chats ADD COLUMN ${name} ${type}`);
  }
  return true;
}

function markedOrigins(db, workspaceId) {
  const marked = new Set();
  for (const table of TURN_MARKS) {
    if (!hasTable(db, table)) continue;
    for (const row of db.prepare(`SELECT origin_id FROM ${table} WHERE workspace_id = ?`).all(workspaceId)) marked.add(row.origin_id);
  }
  return marked;
}

// From the user message before the first marked reply on, everything is the story, failed replies
// and lone messages included; before it, the Chat.
function campaignMessageIds(messages, marked) {
  const first = messages.findIndex(message => message.role !== 'user' && marked.has(message.id));
  if (first < 0) return [];
  const start = first > 0 && messages[first - 1].role === 'user' ? first - 1 : first;
  return messages.slice(start).map(message => message.id);
}

const blockIds = block => (Array.isArray(block.messages) ? block.messages : [])
  .map(message => (typeof message === 'string' ? message : message && message.id))
  .filter(Boolean);

function splitWorkspace(db, workspaceId, log) {
  const messages = db.prepare('SELECT id, role, excluded FROM messages WHERE chatId = ? ORDER BY createdAt ASC, id ASC').all(workspaceId);
  const roleplayIds = new Set(campaignMessageIds(messages, markedOrigins(db, workspaceId)));
  const chat = db.prepare('SELECT memoryBlocks, summarizedIndex, autoSummarize, archiveThreshold, lastTargetId FROM chats WHERE id = ?').get(workspaceId);
  if (!chat || !roleplayIds.size) return { workspaceId, roleplay: 0, chat: messages.length, mixedSummaries: [] };

  const setThread = db.prepare("UPDATE messages SET thread = 'roleplay' WHERE id = ? AND chatId = ?");
  for (const id of roleplayIds) setThread.run(id, workspaceId);

  // A summary follows the messages it covers; a mixed one follows the majority and is reported.
  const existing = new Set(messages.map(message => message.id));
  const mixedSummaries = [];
  const blocks = parseMemoryBlocks(chat.memoryBlocks).map(block => {
    if (!block || block.type !== 'summarized') return block;
    const ids = blockIds(block).filter(id => existing.has(id));
    const inRoleplay = ids.filter(id => roleplayIds.has(id)).length;
    if (!inRoleplay) return block;
    if (inRoleplay < ids.length) {
      mixedSummaries.push({ id: block.id, title: block.title || '', roleplay: inRoleplay, chat: ids.length - inRoleplay });
    }
    return inRoleplay * 2 >= ids.length ? { ...block, thread: 'roleplay' } : block;
  });
  db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(blocks), workspaceId);

  const threadMessages = thread => messages.filter(message => (thread === 'roleplay') === roleplayIds.has(message.id));
  const threadBlocks = thread => blocks.filter(block => block && block.type === 'summarized' && ((block.thread === 'roleplay') === (thread === 'roleplay')));
  db.prepare('UPDATE chats SET summarizedIndex = ? WHERE id = ?')
    .run(deriveSummarizedIndex(threadMessages('chat'), threadBlocks('chat')), workspaceId);
  // The reply target in use was the narrator's, so the Roleplay keeps it.
  db.prepare(`
    INSERT OR REPLACE INTO workspace_threads (workspace_id, thread, summarized_index, auto_summarize, archive_threshold, last_target_id)
    VALUES (?, 'roleplay', ?, ?, ?, ?)
  `).run(
    workspaceId,
    deriveSummarizedIndex(threadMessages('roleplay'), threadBlocks('roleplay')),
    chat.autoSummarize ? 1 : 0,
    chat.archiveThreshold || 60000,
    chat.lastTargetId || null
  );

  // The Chat starts on the workspace's default profile, and the Desk keeps reading the campaign it read before.
  db.prepare('UPDATE chats SET lastTargetId = NULL WHERE id = ?').run(workspaceId);
  if (columnsOf(db, 'chats').includes('wdUseChatHistory')) {
    db.prepare("UPDATE chats SET wdHistorySource = 'roleplay' WHERE id = ? AND wdHistorySource IS NULL AND COALESCE(wdUseChatHistory, 1) != 0").run(workspaceId);
  }

  for (const mixed of mixedSummaries) {
    log(`[Threads] Workspace ${workspaceId}: summary "${mixed.title}" covers ${mixed.roleplay} roleplay and ${mixed.chat} chat messages; it went to the ${mixed.roleplay * 2 >= mixed.roleplay + mixed.chat ? 'Roleplay' : 'Chat'}.`);
  }
  return { workspaceId, roleplay: roleplayIds.size, chat: messages.length - roleplayIds.size, mixedSummaries };
}

function splitConversationThreads(db, { log = message => console.log(message) } = {}) {
  if (!ensureThreadSchema(db) || !hasTable(db, 'workspace_experience_modes')) return [];
  const workspaces = db.prepare("SELECT workspace_id FROM workspace_experience_modes WHERE mode = 'roleplay'").all();
  const reports = workspaces.map(({ workspace_id: id }) => splitWorkspace(db, id, log));
  for (const report of reports) {
    if (report.roleplay) log(`[Threads] Workspace ${report.workspaceId}: ${report.roleplay} messages to the Roleplay, ${report.chat} stay in the Chat.`);
  }
  return reports;
}

module.exports = { splitConversationThreads, campaignMessageIds, ensureThreadSchema, markedOrigins };

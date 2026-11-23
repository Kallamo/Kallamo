const CHAT_MESSAGE_PAGE_SIZE = 50;

// A reply's diagnostics can hold megabytes of retrieval and request detail, read only when its
// panel opens. Pages carry a light copy: heavy parts become small stand-ins that keep each
// readout's tab, and `omitted` tells the panel to fetch the whole record.
const LIGHT_DEBUG_FROM = 16384;
const LIGHT_DEBUG_NOTICE = `CASE WHEN length(debugNotice) > ${LIGHT_DEBUG_FROM} AND json_valid(debugNotice)
  THEN json_set(json_replace(debugNotice,
    '$.retrieval', json('{}'),
    '$.agentic', json('{}'),
    '$.agenticTrajectory', json('{}'),
    '$.generation.requests', json('[0]'),
    '$.generation.scenePlan', '…',
    '$.narrativeCalls', json('[0]'),
    '$.standardRagContextGathered', '…',
    '$.agenticRagContextGathered', '…',
    '$.agenticRagResponse', '…',
    '$.legacyText', '…'
  ), '$.omitted', json('true'))
  ELSE debugNotice END`;
const PAGE_COLUMNS = `id, chatId, thread, role, content, aiName, aiColor, ${LIGHT_DEBUG_NOTICE} AS debugNotice,
  attachedFiles, alternatives, excluded, createdAt, last_modified`;

function normalizeMessage(row) {
  return {
    ...row,
    attachedFiles: JSON.parse(row.attachedFiles || '[]')
  };
}

function getMessagePage(db, { chatId, before, thread }) {
  const conversation = thread === 'roleplay' ? 'roleplay' : 'chat';
  const cursor = before && Number.isFinite(before.createdAt) && typeof before.id === 'string'
    ? before
    : null;
  const query = cursor
    ? `SELECT ${PAGE_COLUMNS} FROM messages
       WHERE chatId = ? AND thread = ?
         AND (createdAt < ? OR (createdAt = ? AND id < ?))
       ORDER BY createdAt DESC, id DESC
       LIMIT ?`
    : `SELECT ${PAGE_COLUMNS} FROM messages
       WHERE chatId = ? AND thread = ?
       ORDER BY createdAt DESC, id DESC
       LIMIT ?`;
  const params = cursor
    ? [chatId, conversation, cursor.createdAt, cursor.createdAt, cursor.id, CHAT_MESSAGE_PAGE_SIZE + 1]
    : [chatId, conversation, CHAT_MESSAGE_PAGE_SIZE + 1];
  const rows = db.prepare(query).all(...params);
  const hasMore = rows.length > CHAT_MESSAGE_PAGE_SIZE;
  const messages = rows.slice(0, CHAT_MESSAGE_PAGE_SIZE).reverse().map(normalizeMessage);
  const oldestMessage = messages[0];

  return {
    messages,
    hasMore,
    oldestCursor: oldestMessage
      ? { createdAt: oldestMessage.createdAt, id: oldestMessage.id }
      : null
  };
}

function getMessageDebugNotice(db, messageId) {
  return db.prepare('SELECT debugNotice FROM messages WHERE id = ?').get(messageId)?.debugNotice || '';
}

// Messages edited on screen come back with the light diagnostics they were shown with; the
// stored record is kept instead, so saving a message never loses its diagnostics. A reply saved
// under a new id names the row it was copied from in `debugNoticeFrom`.
function debugNoticeToSave(db, message) {
  const notice = message.debugNotice || '';
  if (!notice.includes('"omitted":true')) return notice;
  try {
    if (JSON.parse(notice)?.omitted !== true) return notice;
  } catch {
    return notice;
  }
  return getMessageDebugNotice(db, message.id)
    || (message.debugNoticeFrom ? getMessageDebugNotice(db, message.debugNoticeFrom) : '')
    || notice;
}

module.exports = { getMessagePage, getMessageDebugNotice, debugNoticeToSave, CHAT_MESSAGE_PAGE_SIZE };

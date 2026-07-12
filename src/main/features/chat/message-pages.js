const CHAT_MESSAGE_PAGE_SIZE = 50;

function normalizeMessage(row) {
  return {
    ...row,
    attachedFiles: JSON.parse(row.attachedFiles || '[]')
  };
}

function getMessagePage(db, { chatId, before }) {
  const cursor = before && Number.isFinite(before.createdAt) && typeof before.id === 'string'
    ? before
    : null;
  const query = cursor
    ? `SELECT * FROM messages
       WHERE chatId = ?
         AND (createdAt < ? OR (createdAt = ? AND id < ?))
       ORDER BY createdAt DESC, id DESC
       LIMIT ?`
    : `SELECT * FROM messages
       WHERE chatId = ?
       ORDER BY createdAt DESC, id DESC
       LIMIT ?`;
  const params = cursor
    ? [chatId, cursor.createdAt, cursor.createdAt, cursor.id, CHAT_MESSAGE_PAGE_SIZE + 1]
    : [chatId, CHAT_MESSAGE_PAGE_SIZE + 1];
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

module.exports = { getMessagePage, CHAT_MESSAGE_PAGE_SIZE };

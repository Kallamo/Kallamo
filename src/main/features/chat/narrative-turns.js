// Which story turns a generation replaces, and which turn still waits for Narrative State.

// Replies a regeneration or an edit replaces, newest first: reverting a turn requires every later one reverted.
function replacedReplyIds(messages, { historyEdit = null, regenerateMessageId = null } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  if (regenerateMessageId) {
    const target = list.find(message => message.id === regenerateMessageId);
    return target?.role === 'ai' ? [target.id] : [];
  }
  if (historyEdit?.messageId) {
    const index = list.findIndex(message => message.id === historyEdit.messageId);
    if (index < 0) return [];
    return list.slice(index + 1).filter(message => message.role === 'ai').map(message => message.id).reverse();
  }
  return [];
}

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/**
 * The latest reply that Narrative State never started on: an alternative chosen by switching
 * or regenerating. A failed or interrupted run has a job and is only reprocessed on request,
 * so this can never retry, and bill, the same turn on its own.
 */
function findPendingNarrativeTurn(db, chatId, excludedIds = []) {
  if (!chatId || !hasTable(db, 'kanora_narrative_state_jobs')) return null;
  const excluded = new Set(excludedIds);
  const latest = db.prepare("SELECT id FROM messages WHERE chatId = ? AND role = 'ai' ORDER BY createdAt DESC, id DESC LIMIT 25")
    .all(chatId)
    .find(message => !excluded.has(message.id));
  if (!latest) return null;
  const started = db.prepare('SELECT 1 FROM kanora_narrative_state_jobs WHERE workspace_id = ? AND origin_id = ?').get(chatId, latest.id);
  if (started) return null;
  const retired = hasTable(db, 'kanora_narrative_origin_lifecycle') && db.prepare(`
    SELECT 1 FROM kanora_narrative_origin_lifecycle WHERE workspace_id = ? AND origin_id = ? AND status != 'active'
  `).get(chatId, latest.id);
  return retired ? null : { originId: latest.id };
}

function deferredNarrativeState() {
  return {
    status: 'deferred',
    reason: 'This reply replaced or switched another one. Narrative State updates it once, when the story continues.',
    usage: {}
  };
}

module.exports = { deferredNarrativeState, findPendingNarrativeTurn, replacedReplyIds };

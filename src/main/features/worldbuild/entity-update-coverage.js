// Which update evidence the story pass already turned into memories, knowledge and relationships.
// A played turn has one author of its living state; Update entities only reads it for the sheet.

const ANALYZED_STATUSES = new Set(['completed', 'completed-with-warnings']);
const ARCHIVE_PREFIX = /^Document:[^\n]*\n+Content:\s*/;
// Under this share of analyzed replies a block is read as not yet covered.
const BLOCK_COVERED_SHARE = 0.9;

// Older signatures carried the sheet's empty fields, so filling a field re-read every passage.
function canonicalEvidenceSignature(signature) {
  const parts = String(signature || '').split(':');
  if (parts.length >= 4 && /^[0-9a-f]{16}$/.test(parts[1])) parts.splice(1, 1);
  return parts.join(':');
}

function parseObject(text) {
  try {
    const value = JSON.parse(text || '');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

// A skip with a triage means the turn was read and held nothing; a skip without one never ran.
function analyzedByNotice(notice) {
  const state = parseObject(notice)?.narrativeState;
  if (!state) return false;
  if (ANALYZED_STATUSES.has(state.status)) return true;
  return state.status === 'skipped' && Boolean(state.triage);
}

function readAnalyzedReplies(db, workspaceId) {
  const jobs = new Map(db.prepare(`
    SELECT origin_id AS id, status, error_message AS error FROM narrative_story_jobs WHERE workspace_id = ?
  `).all(workspaceId).map(row => [row.id, row]));
  const analyzed = new Set();
  for (const row of db.prepare("SELECT id, debugNotice FROM messages WHERE chatId = ? AND thread = 'roleplay' AND role = 'ai'").all(workspaceId)) {
    const job = jobs.get(row.id);
    if (job) {
      if (job.status === 'completed' || (job.status === 'skipped' && !job.error)) analyzed.add(row.id);
    } else if (analyzedByNotice(row.debugNotice)) {
      analyzed.add(row.id);
    }
  }
  return analyzed;
}

function archiveLayout(block, stripReasoning) {
  const turns = [];
  let offset = 0;
  const texts = [];
  for (const message of Array.isArray(block.messages) ? block.messages : []) {
    if (!message || !message.role) continue;
    const text = `${String(message.role).toUpperCase()}: ${stripReasoning(message.content)}`;
    turns.push({ id: message.id, role: message.role, start: offset, end: offset + text.length });
    texts.push(text);
    offset += text.length + 2;
  }
  return { raw: texts.join('\n\n'), turns };
}

function locateChunk(raw, text) {
  const content = String(text || '').replace(ARCHIVE_PREFIX, '');
  if (!content) return null;
  for (const [from, size] of [[0, 160], [0, 60], [40, 60]]) {
    const probe = content.slice(from, from + size);
    if (probe.length < 30) continue;
    const at = raw.indexOf(probe);
    if (at >= 0) return { start: at - from, end: at - from + content.length };
  }
  return null;
}

// The replies a passage belongs to: those it overlaps, or the reply that answered it when it holds
// only the person's own message.
function repliesFor(turns, span) {
  const overlapped = turns.filter(turn => turn.end > span.start && turn.start < span.end);
  const replies = overlapped.filter(turn => turn.role === 'ai');
  if (replies.length) return replies;
  const last = overlapped[overlapped.length - 1];
  const next = last ? turns.slice(turns.indexOf(last) + 1).find(turn => turn.role === 'ai') : null;
  return next ? [next] : [];
}

/**
 * Reads the chat once and answers, per passage: 'covered' (a played turn the story pass analyzed),
 * 'recap' (a summary the person wrote or the archive wrote, which retells the story) or 'open'.
 */
function createStoryCoverage(db, workspaceId, { stripReasoning = text => String(text || '') } = {}) {
  const chat = db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(workspaceId);
  const blocks = new Map();
  for (const block of Array.isArray(parseObject(chat?.memoryBlocks)) ? parseObject(chat.memoryBlocks) : []) {
    if (block?.id) blocks.set(block.id, block);
  }
  let analyzed = null;
  const layouts = new Map();
  const replyCoverage = new Map();

  const analyzedReplies = () => (analyzed ??= readAnalyzedReplies(db, workspaceId));
  const layoutOf = block => {
    if (!layouts.has(block.id)) layouts.set(block.id, archiveLayout(block, stripReasoning));
    return layouts.get(block.id);
  };
  const blockCovered = block => {
    if (!replyCoverage.has(block.id)) {
      const replies = layoutOf(block).turns.filter(turn => turn.role === 'ai');
      const done = replies.filter(turn => analyzedReplies().has(turn.id)).length;
      replyCoverage.set(block.id, replies.length > 0 && done / replies.length >= BLOCK_COVERED_SHARE);
    }
    return replyCoverage.get(block.id);
  };

  function classify(chunk) {
    if (!chunk) return 'open';
    if (chunk.isRecap) return 'recap';
    if (chunk.ownerType !== 'chat_memory') return 'open';
    const block = chunk.memoryBlockId ? blocks.get(chunk.memoryBlockId) : null;
    if (!block) return chunk.source === 'Chat Archive' ? 'open' : 'recap';
    if (block.type !== 'summarized') return 'recap';
    const layout = layoutOf(block);
    const span = locateChunk(layout.raw, chunk.text);
    if (!span) return blockCovered(block) ? 'covered' : 'open';
    const replies = repliesFor(layout.turns, span);
    if (!replies.length) return blockCovered(block) ? 'covered' : 'open';
    return replies.every(turn => analyzedReplies().has(turn.id)) ? 'covered' : 'open';
  }

  return { classify };
}

module.exports = { canonicalEvidenceSignature, createStoryCoverage, archiveLayout, locateChunk, repliesFor, analyzedByNotice };

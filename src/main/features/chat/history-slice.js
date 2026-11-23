// One conversation's history as reference text for another reader. Recent live messages come
// first; summaries of what was archived fill what is left of their share.
const { selectActiveMessages, parseMemoryBlocks } = require('./archive-coverage');
const { readThreadMessages, threadSummaryBlocks } = require('./threads');

// Summaries never take more than this share of the room, so the latest turns always fit.
const SUMMARY_SHARE = 0.35;

function loadThreadHistory(db, workspaceId, thread) {
  const row = db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(workspaceId);
  const blocks = threadSummaryBlocks(parseMemoryBlocks(row && row.memoryBlocks), thread);
  const messages = readThreadMessages(db, workspaceId, thread, 'id, role, content, aiName, excluded, createdAt');
  return {
    messages: selectActiveMessages(messages, blocks),
    summaries: blocks
      .filter(block => String(block.summary || '').trim())
      .map(block => ({ id: block.id, title: block.title || 'Summary', summary: String(block.summary).trim() }))
  };
}

const speaker = message => (message.role === 'user' ? 'USER' : String(message.aiName || 'AI').toUpperCase());

/**
 * Fits the newest messages, then the newest summaries, into `room` tokens. Returns empty text when
 * nothing fits. `strip` cleans a stored message (reasoning out) before it is measured.
 */
function renderHistorySlice({ history, room, includeSummaries = true, estimate, strip = text => text, heading, note }) {
  const empty = { text: '', tokens: 0, messages: 0, summaries: 0 };
  if (!history || !(room > 0)) return empty;
  const frame = [`--- ${heading} ---`, note || '', 'Most recent messages, oldest first:', 'Earlier, in summary:', `--- END ${heading} ---`];
  let left = room - estimate(frame.join('\n'));
  if (left <= 0) return empty;

  const useSummaries = includeSummaries && history.summaries.length > 0;
  let messageRoom = useSummaries ? left - Math.floor(left * SUMMARY_SHARE) : left;
  const recent = [];
  for (let index = history.messages.length - 1; index >= 0; index -= 1) {
    const message = history.messages[index];
    const line = `${speaker(message)}: ${strip(String(message.content || '')).trim()}`;
    const cost = estimate(line) + 1;
    if (cost > messageRoom) break;
    recent.unshift(line);
    messageRoom -= cost;
    left -= cost;
  }

  // Whatever the messages left over, the summaries may use.
  const summaries = [];
  if (useSummaries) {
    for (let index = history.summaries.length - 1; index >= 0; index -= 1) {
      const block = history.summaries[index];
      const line = `- ${block.title}: ${block.summary}`;
      const cost = estimate(line) + 1;
      if (cost > left) break;
      summaries.unshift(line);
      left -= cost;
    }
  }
  if (!recent.length && !summaries.length) return empty;

  const body = [
    ...(summaries.length ? ['Earlier, in summary:', ...summaries, ''] : []),
    ...(recent.length ? ['Most recent messages, oldest first:', ...recent] : [])
  ];
  const text = [`--- ${heading} ---`, ...(note ? [note] : []), '', ...body, `--- END ${heading} ---`].join('\n');
  return { text, tokens: estimate(text), messages: recent.length, summaries: summaries.length };
}

module.exports = { loadThreadHistory, renderHistorySlice, SUMMARY_SHARE };
